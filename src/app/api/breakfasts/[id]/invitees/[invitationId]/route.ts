import { and, asc, eq, gt, inArray } from "drizzle-orm";
import { z } from "zod";
import { getDb, isDatabaseConfigured, schema } from "@/db";
import { errorResponse } from "@/lib/api-auth";
import { requireFounderSession } from "@/lib/auth";
import { loadBreakfastCapacityForEvent } from "@/lib/breakfasts/queries";
import {
  BreakfastRuleError,
  evaluateCancellation,
  evaluateInvitationAcceptance,
  evaluateManualWaitlistConfirm,
  evaluateManualWaitlistOffer,
  normalizeLocale,
} from "@/lib/breakfasts/rules";
import { createFolkClientFromEnv } from "@/lib/folk/client";
import { recordAuditEvent } from "@/lib/governance/audit";

export const dynamic = "force-dynamic";

const relinkFolkPersonSchema = z.object({
  folkPersonId: z.string().min(1),
  fullName: z.string().min(1),
  email: z.string().nullable().optional(),
  jobTitle: z.string().nullable().optional(),
  folkCompanyId: z.string().nullable().optional(),
  companyName: z.string().nullable().optional(),
  linkedinUrl: z.string().nullable().optional(),
});

const patchInviteeSchema = z.object({
  responseStatus: z
    .enum(["provisional", "no_response", "accepted", "maybe", "declined"])
    .optional(),
  attendanceOutcome: z
    .enum(["pending", "attended", "cancelled_in_advance", "no_show"])
    .optional(),
  waitlistAction: z
    .enum(["offer_place", "confirm_replacement", "remove_from_waitlist"])
    .optional(),
  chaseStatus: z.string().max(80).optional(),
  dietaryNotes: z.string().max(1000).nullable().optional(),
  specialRequests: z.string().max(1000).nullable().optional(),
  earlyDepartureNote: z.string().max(500).nullable().optional(),
  contactSuppressed: z.boolean().optional(),
  suppressionReason: z.string().max(300).nullable().optional(),
  note: z.string().max(500).optional(),
  syncFromFolk: z.boolean().optional(),
  relinkFolkPerson: relinkFolkPersonSchema.optional(),
});

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string; invitationId: string }> },
) {
  try {
    const founder = await requireFounderSession();
    if (!isDatabaseConfigured()) {
      return Response.json(
        { error: "Database is not configured" },
        { status: 503 },
      );
    }

    const { id: eventId, invitationId } = await context.params;
    const body = patchInviteeSchema.parse(await request.json());
    const db = getDb();

    const { event, capacity, invitations } = await loadBreakfastCapacityForEvent(
      db,
      eventId,
    );
    const existing = invitations.find((i) => i.id === invitationId);
    if (!existing) {
      return Response.json(
        { error: "Invitation not found for this event" },
        { status: 404 },
      );
    }

    const [person] = await db
      .select()
      .from(schema.folkPeopleLink)
      .where(eq(schema.folkPeopleLink.id, existing.folkPersonLinkId))
      .limit(1);

    if (!person) {
      return Response.json({ error: "Linked person not found" }, { status: 404 });
    }

    if (body.syncFromFolk) {
      const folkClient = createFolkClientFromEnv();
      if (!folkClient) {
        return Response.json(
          { error: "FOLK_API_KEY is not configured" },
          { status: 503 },
        );
      }

      const live = await folkClient.getPerson(person.folkPersonId);
      const liveFullName =
        live.fullName?.trim() ||
        [live.firstName, live.lastName].filter(Boolean).join(" ").trim() ||
        person.fullName;
      const liveEmail = live.emails?.[0]?.trim() || null;
      const liveJobTitle = live.jobTitle?.trim() || null;
      const liveLinkedin =
        live.urls?.find((u) => u.toLowerCase().includes("linkedin.com")) ?? null;
      const liveCompany = live.companies?.[0];

      let folkCompanyLinkId = person.folkCompanyLinkId;
      if (liveCompany?.id && liveCompany?.name) {
        const [companyRow] = await db
          .insert(schema.folkCompaniesLink)
          .values({
            folkCompanyId: liveCompany.id,
            name: liveCompany.name,
            lastSyncedAt: new Date(),
            syncStatus: "linked",
          })
          .onConflictDoUpdate({
            target: schema.folkCompaniesLink.folkCompanyId,
            set: {
              name: liveCompany.name,
              lastSyncedAt: new Date(),
              updatedAt: new Date(),
            },
          })
          .returning({ id: schema.folkCompaniesLink.id });
        folkCompanyLinkId = companyRow?.id ?? folkCompanyLinkId;
      }

      await db
        .update(schema.folkPeopleLink)
        .set({
          fullName: liveFullName,
          email: liveEmail,
          jobTitle: liveJobTitle,
          linkedinUrl: liveLinkedin,
          folkCompanyLinkId,
          lastSyncedAt: new Date(),
          syncStatus: "linked",
          updatedAt: new Date(),
        })
        .where(eq(schema.folkPeopleLink.id, person.id));

      await recordAuditEvent({
        actorType: "human",
        actorUserId: founder.userId,
        action: "breakfast_invitee_synced_from_folk",
        entityType: "folk_person_link",
        entityId: person.id,
        newValue: {
          folkPersonId: person.folkPersonId,
          fullName: liveFullName,
          email: liveEmail,
          jobTitle: liveJobTitle,
        },
        outcome: "succeeded",
      });

      return Response.json({
        invitation: existing,
        syncedFromFolk: true,
      });
    }

    if (body.relinkFolkPerson) {
      const picked = body.relinkFolkPerson;
      let folkCompanyLinkId: string | null = null;
      if (picked.folkCompanyId && picked.companyName) {
        const [companyRow] = await db
          .insert(schema.folkCompaniesLink)
          .values({
            folkCompanyId: picked.folkCompanyId,
            name: picked.companyName,
            lastSyncedAt: new Date(),
            syncStatus: "linked",
          })
          .onConflictDoUpdate({
            target: schema.folkCompaniesLink.folkCompanyId,
            set: {
              name: picked.companyName,
              lastSyncedAt: new Date(),
              updatedAt: new Date(),
            },
          })
          .returning({ id: schema.folkCompaniesLink.id });
        folkCompanyLinkId = companyRow?.id ?? null;
      }

      const [newPerson] = await db
        .insert(schema.folkPeopleLink)
        .values({
          folkPersonId: picked.folkPersonId,
          folkCompanyLinkId,
          fullName: picked.fullName,
          email: picked.email ?? null,
          jobTitle: picked.jobTitle ?? null,
          linkedinUrl: picked.linkedinUrl ?? null,
          lastSyncedAt: new Date(),
          syncStatus: "linked",
        })
        .onConflictDoUpdate({
          target: schema.folkPeopleLink.folkPersonId,
          set: {
            ...(folkCompanyLinkId ? { folkCompanyLinkId } : {}),
            fullName: picked.fullName,
            email: picked.email ?? null,
            jobTitle: picked.jobTitle ?? null,
            linkedinUrl: picked.linkedinUrl ?? null,
            lastSyncedAt: new Date(),
            updatedAt: new Date(),
          },
        })
        .returning();

      if (newPerson.contactSuppressed) {
        return Response.json(
          {
            error: `${newPerson.fullName} is marked Do Not Contact and cannot be linked to this invite list.`,
          },
          { status: 409 },
        );
      }

      const duplicate = invitations.find(
        (i) => i.id !== invitationId && i.folkPersonLinkId === newPerson.id,
      );
      if (duplicate) {
        return Response.json(
          {
            error: `${newPerson.fullName} is already on this breakfast list. Remove the duplicate stub row or keep the existing entry.`,
          },
          { status: 409 },
        );
      }

      const [relinked] = await db
        .update(schema.breakfastInvitations)
        .set({
          folkPersonLinkId: newPerson.id,
          updatedAt: new Date(),
        })
        .where(eq(schema.breakfastInvitations.id, invitationId))
        .returning();

      await db.insert(schema.breakfastInvitationHistory).values({
        invitationId,
        changedByUserId: founder.userId,
        previousResponseStatus: existing.responseStatus,
        newResponseStatus: existing.responseStatus,
        previousAttendanceOutcome: existing.attendanceOutcome,
        newAttendanceOutcome: existing.attendanceOutcome,
        previousWaitlistStatus: existing.waitlistStatus,
        newWaitlistStatus: existing.waitlistStatus,
        note: `Changed linked Folk record from ${person.fullName} to ${newPerson.fullName} (${picked.folkPersonId})`,
      });

      await recordAuditEvent({
        actorType: "human",
        actorUserId: founder.userId,
        action: "breakfast_invitee_relinked_folk",
        entityType: "breakfast_invitation",
        entityId: invitationId,
        previousValue: {
          folkPersonLinkId: person.id,
          folkPersonId: person.folkPersonId,
        },
        newValue: {
          folkPersonLinkId: newPerson.id,
          folkPersonId: picked.folkPersonId,
        },
        outcome: "succeeded",
      });

      return Response.json({
        invitation: relinked,
        relinkedFolk: true,
      });
    }

    if (body.contactSuppressed !== undefined) {
      await db
        .update(schema.folkPeopleLink)
        .set({
          contactSuppressed: body.contactSuppressed,
          suppressionReason: body.contactSuppressed
            ? body.suppressionReason ?? person.suppressionReason ?? "Requested no contact"
            : null,
          suppressedAt: body.contactSuppressed ? new Date() : null,
          updatedAt: new Date(),
        })
        .where(eq(schema.folkPeopleLink.id, person.id));
    }

    let nextResponse = existing.responseStatus;
    let nextAttendance = existing.attendanceOutcome;
    let nextWaitlist = existing.waitlistStatus;
    let wasAutoWaitlisted = false;

    if (body.responseStatus !== undefined) {
      if (body.responseStatus === "accepted") {
        const evalRes = evaluateInvitationAcceptance(capacity, existing);
        nextResponse = evalRes.responseStatus;
        nextAttendance = evalRes.attendanceOutcome;
        nextWaitlist = evalRes.waitlistStatus;
        wasAutoWaitlisted = evalRes.wasWaitlisted;
      } else {
        nextResponse = body.responseStatus;
        if (
          body.responseStatus === "declined" ||
          body.responseStatus === "no_response" ||
          body.responseStatus === "provisional"
        ) {
          nextWaitlist = "none";
        }
      }
    }

    if (body.attendanceOutcome !== undefined) {
      if (body.attendanceOutcome === "cancelled_in_advance") {
        const cancelled = evaluateCancellation({
          responseStatus: nextResponse,
          attendanceOutcome: nextAttendance,
          waitlistStatus: nextWaitlist,
        });
        nextAttendance = cancelled.attendanceOutcome;
        nextWaitlist = cancelled.waitlistStatus;
      } else {
        nextAttendance = body.attendanceOutcome;
      }
    }

    if (body.waitlistAction !== undefined) {
      const currentState = {
        responseStatus: nextResponse,
        attendanceOutcome: nextAttendance,
        waitlistStatus: nextWaitlist,
      };
      if (body.waitlistAction === "offer_place") {
        const offered = evaluateManualWaitlistOffer(
          capacity,
          currentState,
          "human",
        );
        nextWaitlist = offered.waitlistStatus;
      } else if (body.waitlistAction === "confirm_replacement") {
        const confirmed = evaluateManualWaitlistConfirm(
          capacity,
          currentState,
          "human",
        );
        nextResponse = confirmed.responseStatus;
        nextAttendance = confirmed.attendanceOutcome;
        nextWaitlist = confirmed.waitlistStatus;
      } else if (body.waitlistAction === "remove_from_waitlist") {
        nextWaitlist = "none";
      }
    }

    const patch: Partial<typeof schema.breakfastInvitations.$inferInsert> = {
      responseStatus: nextResponse,
      attendanceOutcome: nextAttendance,
      waitlistStatus: nextWaitlist,
      updatedAt: new Date(),
    };

    if (body.chaseStatus !== undefined) patch.chaseStatus = body.chaseStatus;
    if (body.dietaryNotes !== undefined) {
      patch.dietaryNotes = body.dietaryNotes?.trim() || null;
    }
    if (body.specialRequests !== undefined) {
      patch.specialRequests = body.specialRequests?.trim() || null;
    }
    if (body.earlyDepartureNote !== undefined) {
      patch.earlyDepartureNote = body.earlyDepartureNote?.trim() || null;
    }

    const [updated] = await db
      .update(schema.breakfastInvitations)
      .set(patch)
      .where(eq(schema.breakfastInvitations.id, invitationId))
      .returning();

    const statusChanged =
      existing.responseStatus !== nextResponse ||
      existing.attendanceOutcome !== nextAttendance ||
      existing.waitlistStatus !== nextWaitlist;

    if (statusChanged || body.note) {
      await db.insert(schema.breakfastInvitationHistory).values({
        invitationId,
        changedByUserId: founder.userId,
        previousResponseStatus: existing.responseStatus,
        newResponseStatus: nextResponse,
        previousAttendanceOutcome: existing.attendanceOutcome,
        newAttendanceOutcome: nextAttendance,
        previousWaitlistStatus: existing.waitlistStatus,
        newWaitlistStatus: nextWaitlist,
        note:
          body.note ??
          (wasAutoWaitlisted
            ? "Event at guest capacity; placed on waitlist without overbooking"
            : null),
      });
    }

    // Automatic same-locale carry-forward when transitioning to `declined`
    let carryForwardAction: "carried_to_next_event" | "queued_for_locale" | "skipped_suppressed" | null =
      null;
    if (existing.responseStatus !== "declined" && nextResponse === "declined") {
      const effectiveSuppressed =
        body.contactSuppressed !== undefined
          ? body.contactSuppressed
          : person.contactSuppressed;

      if (effectiveSuppressed) {
        carryForwardAction = "skipped_suppressed";
      } else {
        const targetLocale = normalizeLocale(event.locale);
        const futureEvents = await db
          .select()
          .from(schema.breakfastEvents)
          .where(
            and(
              gt(schema.breakfastEvents.eventDate, event.eventDate),
              inArray(schema.breakfastEvents.status, ["planning", "inviting"]),
            ),
          )
          .orderBy(asc(schema.breakfastEvents.eventDate));

        const nextSameLocale = futureEvents.find(
          (fe) => normalizeLocale(fe.locale) === targetLocale,
        );

        if (nextSameLocale) {
          const insertedCarry = await db
            .insert(schema.breakfastInvitations)
            .values({
              eventId: nextSameLocale.id,
              folkPersonLinkId: person.id,
              responseStatus: "provisional",
              attendanceOutcome: "pending",
              waitlistStatus: "none",
              chaseStatus: "none",
              carriedForwardFromEventId: eventId,
              dietaryNotes: null,
              specialRequests: null,
              earlyDepartureNote: null,
            })
            .onConflictDoNothing()
            .returning({ id: schema.breakfastInvitations.id });

          if (insertedCarry[0]) {
            await db.insert(schema.breakfastInvitationHistory).values({
              invitationId: insertedCarry[0].id,
              changedByUserId: founder.userId,
              previousResponseStatus: null,
              newResponseStatus: "provisional",
              previousAttendanceOutcome: null,
              newAttendanceOutcome: "pending",
              previousWaitlistStatus: null,
              newWaitlistStatus: "none",
              note: `Automatically carried forward from ${event.title} (responded, could not attend)`,
            });
          }
          carryForwardAction = "carried_to_next_event";
        } else {
          await db
            .insert(schema.localeCarryForwardQueue)
            .values({
              locale: targetLocale,
              folkPersonLinkId: person.id,
              sourceEventId: eventId,
              reason: "responded_could_not_attend",
            })
            .onConflictDoNothing();
          carryForwardAction = "queued_for_locale";
        }
      }
    }

    await recordAuditEvent({
      actorType: "human",
      actorUserId: founder.userId,
      action: "breakfast_invitee_updated",
      entityType: "breakfast_invitation",
      entityId: invitationId,
      previousValue: {
        responseStatus: existing.responseStatus,
        attendanceOutcome: existing.attendanceOutcome,
        waitlistStatus: existing.waitlistStatus,
      },
      newValue: {
        responseStatus: nextResponse,
        attendanceOutcome: nextAttendance,
        waitlistStatus: nextWaitlist,
        carryForwardAction,
      },
      outcome: "succeeded",
    });

    return Response.json({
      invitation: updated,
      wasAutoWaitlisted,
      carryForwardAction,
    });
  } catch (err) {
    if (err instanceof BreakfastRuleError) {
      return Response.json({ error: err.message }, { status: err.status });
    }
    return errorResponse(err);
  }
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string; invitationId: string }> },
) {
  try {
    const founder = await requireFounderSession();
    if (!isDatabaseConfigured()) {
      return Response.json(
        { error: "Database is not configured" },
        { status: 503 },
      );
    }

    const { id: eventId, invitationId } = await context.params;
    const db = getDb();

    const [existing] = await db
      .select()
      .from(schema.breakfastInvitations)
      .where(
        and(
          eq(schema.breakfastInvitations.id, invitationId),
          eq(schema.breakfastInvitations.eventId, eventId),
        ),
      )
      .limit(1);

    if (!existing) {
      return Response.json(
        { error: "Invitation not found for this event" },
        { status: 404 },
      );
    }

    await db
      .delete(schema.breakfastInvitations)
      .where(
        and(
          eq(schema.breakfastInvitations.id, invitationId),
          eq(schema.breakfastInvitations.eventId, eventId),
        ),
      );

    await recordAuditEvent({
      actorType: "human",
      actorUserId: founder.userId,
      action: "breakfast_invitee_removed",
      entityType: "breakfast_invitation",
      entityId: invitationId,
      previousValue: {
        eventId,
        folkPersonLinkId: existing.folkPersonLinkId,
        responseStatus: existing.responseStatus,
        attendanceOutcome: existing.attendanceOutcome,
        waitlistStatus: existing.waitlistStatus,
      },
      outcome: "succeeded",
    });

    return Response.json({ ok: true, deletedId: invitationId });
  } catch (err) {
    return errorResponse(err);
  }
}
