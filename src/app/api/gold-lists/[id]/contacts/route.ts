import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, isDatabaseConfigured, schema } from "@/db";
import { errorResponse } from "@/lib/api-auth";
import { requireFounderSession } from "@/lib/auth";
import { recordAuditEvent } from "@/lib/governance/audit";

export const dynamic = "force-dynamic";

const createContactSchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("folk"),
    folkPersonId: z.string().min(1),
    fullName: z.string().min(1),
    email: z.string().nullable().optional(),
    jobTitle: z.string().nullable().optional(),
    linkedinUrl: z.string().nullable().optional(),
    roleCategory: z.enum([
      "cmo",
      "vp_marketing",
      "marketing_director",
      "marketing_ops",
      "other",
    ]),
    isPrimaryDecisionMaker: z.boolean().default(false),
    notes: z.string().max(1000).nullable().optional(),
  }),
  z.object({
    mode: z.literal("gap"),
    roleCategory: z.enum([
      "cmo",
      "vp_marketing",
      "marketing_director",
      "marketing_ops",
      "other",
    ]),
    notes: z.string().max(1000).nullable().optional(),
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

    const { id: goldAccountId } = await context.params;
    const body = createContactSchema.parse(await request.json());
    const db = getDb();

    const [account] = await db
      .select()
      .from(schema.goldAccounts)
      .where(eq(schema.goldAccounts.id, goldAccountId))
      .limit(1);

    if (!account) {
      return Response.json({ error: "Gold account not found" }, { status: 404 });
    }

    let folkPersonLinkId: string | null = null;
    if (body.mode === "folk") {
      const [personLink] = await db
        .insert(schema.folkPeopleLink)
        .values({
          folkPersonId: body.folkPersonId,
          folkCompanyLinkId: account.folkCompanyLinkId,
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
            folkCompanyLinkId: account.folkCompanyLinkId,
            fullName: body.fullName,
            email: body.email ?? null,
            jobTitle: body.jobTitle ?? null,
            linkedinUrl: body.linkedinUrl ?? null,
            lastSyncedAt: new Date(),
            updatedAt: new Date(),
          },
        })
        .returning();

      folkPersonLinkId = personLink.id;

      const [existingMapped] = await db
        .select({ id: schema.goldAccountContacts.id })
        .from(schema.goldAccountContacts)
        .where(
          and(
            eq(schema.goldAccountContacts.goldAccountId, goldAccountId),
            eq(schema.goldAccountContacts.folkPersonLinkId, folkPersonLinkId),
            eq(schema.goldAccountContacts.coverageStatus, "mapped"),
          ),
        )
        .limit(1);

      if (existingMapped) {
        return Response.json(
          { error: `${body.fullName} is already mapped to this Gold account.` },
          { status: 409 },
        );
      }
    }

    const [created] = await db
      .insert(schema.goldAccountContacts)
      .values({
        goldAccountId,
        folkPersonLinkId,
        roleCategory: body.roleCategory,
        isPrimaryDecisionMaker:
          body.mode === "folk" ? body.isPrimaryDecisionMaker : false,
        coverageStatus: body.mode === "folk" ? "mapped" : "gap",
        notes: body.notes?.trim() || null,
      })
      .returning();

    await recordAuditEvent({
      actorType: "human",
      actorUserId: founder.userId,
      action:
        body.mode === "folk"
          ? "gold_contact_mapped"
          : "gold_coverage_gap_recorded",
      entityType: "gold_account_contact",
      entityId: created.id,
      newValue: body,
      outcome: "succeeded",
    });

    return Response.json({ contact: created }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function DELETE(
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

    const { id: goldAccountId } = await context.params;
    const { searchParams } = new URL(request.url);
    const contactId = searchParams.get("contactId");
    if (!contactId) {
      return Response.json({ error: "contactId is required" }, { status: 400 });
    }

    const db = getDb();
    await db
      .delete(schema.goldAccountContacts)
      .where(
        and(
          eq(schema.goldAccountContacts.id, contactId),
          eq(schema.goldAccountContacts.goldAccountId, goldAccountId),
        ),
      );

    await recordAuditEvent({
      actorType: "human",
      actorUserId: founder.userId,
      action: "gold_contact_unlinked",
      entityType: "gold_account_contact",
      entityId: contactId,
      outcome: "succeeded",
    });

    return Response.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
