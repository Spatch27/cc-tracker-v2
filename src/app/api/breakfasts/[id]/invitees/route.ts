import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, isDatabaseConfigured, schema } from "@/db";
import { errorResponse } from "@/lib/api-auth";
import { requireFounderSession } from "@/lib/auth";
import { loadBreakfastCapacityForEvent } from "@/lib/breakfasts/queries";
import { evaluateInvitationAcceptance } from "@/lib/breakfasts/rules";
import { recordAuditEvent } from "@/lib/governance/audit";

export const dynamic = "force-dynamic";

const addInviteeSchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("folk"),
    folkPersonId: z.string().min(1),
    fullName: z.string().min(1),
    email: z.string().nullable().optional(),
    jobTitle: z.string().nullable().optional(),
    folkCompanyId: z.string().nullable().optional(),
    companyName: z.string().nullable().optional(),
    linkedinUrl: z.string().nullable().optional(),
    initialResponseStatus: z
      .enum(["provisional", "no_response", "accepted", "maybe", "declined"])
      .default("provisional"),
  }),
  z.object({
    mode: z.literal("existing_link"),
    folkPersonLinkId: z.string().uuid(),
    carriedForwardFromEventId: z.string().uuid().nullable().optional(),
    initialResponseStatus: z
      .enum(["provisional", "no_response", "accepted", "maybe", "declined"])
      .default("provisional"),
  }),
]);

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const founder = await requireFounderSession();
    if (!isDatabaseConfigured()) {
      return Response.json(
        { error: "Database is not configured" },
        { status: 503 },
      );
    }

    const { id: eventId } = await context.params;
    const body = addInviteeSchema.parse(await request.json());
    const db = getDb();

    const { capacity } = await loadBreakfastCapacityForEvent(db, eventId);

    let folkPersonLinkId: string;
    let carriedForwardFromEventId: string | null = null;

    if (body.mode === "folk") {
      let folkCompanyLinkId: string | null = null;
      if (body.folkCompanyId && body.companyName) {
        const [companyRow] = await db
          .insert(schema.folkCompaniesLink)
          .values({
            folkCompanyId: body.folkCompanyId,
            name: body.companyName,
            lastSyncedAt: new Date(),
            syncStatus: "linked",
          })
          .onConflictDoUpdate({
            target: schema.folkCompaniesLink.folkCompanyId,
            set: {
              name: body.companyName,
              lastSyncedAt: new Date(),
              updatedAt: new Date(),
            },
          })
          .returning({ id: schema.folkCompaniesLink.id });
        folkCompanyLinkId = companyRow?.id ?? null;
      }

      const [personRow] = await db
        .insert(schema.folkPeopleLink)
        .values({
          folkPersonId: body.folkPersonId,
          folkCompanyLinkId,
          fullName: body.fullName,
          email: body.email ?? null,
          jobTitle: body.jobTitle ?? null,
          linkedinUrl: body.linkedinUrl ?? null,
          lastSyncedAt: new Date(),
          syncStatus: "linked",
        })
        .onConflictDoUpdate({
          target: schema.folkPeopleLink.folkPersonId,
          set: {
            ...(folkCompanyLinkId ? { folkCompanyLinkId } : {}),
            fullName: body.fullName,
            email: body.email ?? null,
            jobTitle: body.jobTitle ?? null,
            linkedinUrl: body.linkedinUrl ?? null,
            lastSyncedAt: new Date(),
            updatedAt: new Date(),
          },
        })
        .returning();

      if (personRow.contactSuppressed) {
        return Response.json(
          {
            error: `${personRow.fullName} is marked Do Not Contact${personRow.suppressionReason ? ` (${personRow.suppressionReason})` : ""} and cannot be added to an invite list.`,
          },
          { status: 409 },
        );
      }

      folkPersonLinkId = personRow.id;
    } else {
      const [personRow] = await db
        .select()
        .from(schema.folkPeopleLink)
        .where(eq(schema.folkPeopleLink.id, body.folkPersonLinkId))
        .limit(1);

      if (!personRow) {
        return Response.json(
          { error: "Linked Folk person record not found" },
          { status: 404 },
        );
      }
      if (personRow.contactSuppressed) {
        return Response.json(
          {
            error: `${personRow.fullName} is marked Do Not Contact and cannot be carried forward.`,
          },
          { status: 409 },
        );
      }
      folkPersonLinkId = personRow.id;
      carriedForwardFromEventId = body.carriedForwardFromEventId ?? null;
    }

    const existingInvite = await db
      .select()
      .from(schema.breakfastInvitations)
      .where(
        and(
          eq(schema.breakfastInvitations.eventId, eventId),
          eq(schema.breakfastInvitations.folkPersonLinkId, folkPersonLinkId),
        ),
      )
      .limit(1);

    if (existingInvite[0]) {
      return Response.json(
        { error: "This contact is already on the event invitation list." },
        { status: 409 },
      );
    }

    let responseStatus = body.initialResponseStatus;
    let waitlistStatus: "none" | "waitlisted" = "none";

    if (responseStatus === "accepted") {
      const evalResult = evaluateInvitationAcceptance(capacity, null);
      responseStatus = evalResult.responseStatus;
      waitlistStatus = evalResult.waitlistStatus === "waitlisted" ? "waitlisted" : "none";
    }

    const [created] = await db
      .insert(schema.breakfastInvitations)
      .values({
        eventId,
        folkPersonLinkId,
        responseStatus,
        attendanceOutcome: "pending",
        waitlistStatus,
        chaseStatus: "none",
        carriedForwardFromEventId,
      })
      .returning();

    await db.insert(schema.breakfastInvitationHistory).values({
      invitationId: created.id,
      changedByUserId: founder.userId,
      previousResponseStatus: null,
      newResponseStatus: created.responseStatus,
      previousAttendanceOutcome: null,
      newAttendanceOutcome: created.attendanceOutcome,
      previousWaitlistStatus: null,
      newWaitlistStatus: created.waitlistStatus,
      note: carriedForwardFromEventId
        ? "Manually carried forward from previous same-locale breakfast"
        : "Added to breakfast invitation list",
    });

    await recordAuditEvent({
      actorType: "human",
      actorUserId: founder.userId,
      action: "breakfast_invitee_added",
      entityType: "breakfast_invitation",
      entityId: created.id,
      newValue: { eventId, folkPersonLinkId, responseStatus, waitlistStatus },
      outcome: "succeeded",
    });

    return Response.json({ invitation: created }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
