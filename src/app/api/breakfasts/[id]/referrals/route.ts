import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, isDatabaseConfigured, schema } from "@/db";
import { errorResponse } from "@/lib/api-auth";
import { requireFounderSession } from "@/lib/auth";
import { recordAuditEvent } from "@/lib/governance/audit";

export const dynamic = "force-dynamic";

const createReferralSchema = z.object({
  referredByFolkPersonLinkId: z.string().uuid().nullable().optional(),
  referredName: z.string().min(1).max(160),
  referredCompany: z.string().max(160).nullable().optional(),
  referredRole: z.string().max(160).nullable().optional(),
  referredEmail: z.string().max(200).nullable().optional(),
  notes: z.string().max(1000).nullable().optional(),
});

const patchReferralSchema = z.object({
  referralId: z.string().uuid(),
  status: z.enum(["new", "researching", "added_to_folk", "invited", "dismissed"]),
});

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
    const body = createReferralSchema.parse(await request.json());
    const db = getDb();

    const [created] = await db
      .insert(schema.breakfastReferrals)
      .values({
        eventId,
        referredByFolkPersonLinkId: body.referredByFolkPersonLinkId ?? null,
        referredName: body.referredName.trim(),
        referredCompany: body.referredCompany?.trim() || null,
        referredRole: body.referredRole?.trim() || null,
        referredEmail: body.referredEmail?.trim() || null,
        notes: body.notes?.trim() || null,
        createdByUserId: founder.userId,
      })
      .returning();

    await recordAuditEvent({
      actorType: "human",
      actorUserId: founder.userId,
      action: "breakfast_referral_created",
      entityType: "breakfast_referral",
      entityId: created.id,
      newValue: body,
      outcome: "succeeded",
    });

    return Response.json({ referral: created }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function PATCH(request: Request) {
  try {
    const founder = await requireFounderSession();
    if (!isDatabaseConfigured()) {
      return Response.json(
        { error: "Database is not configured" },
        { status: 503 },
      );
    }
    const body = patchReferralSchema.parse(await request.json());
    const db = getDb();

    const [updated] = await db
      .update(schema.breakfastReferrals)
      .set({ status: body.status, updatedAt: new Date() })
      .where(eq(schema.breakfastReferrals.id, body.referralId))
      .returning();

    if (!updated) {
      return Response.json({ error: "Referral not found" }, { status: 404 });
    }

    await recordAuditEvent({
      actorType: "human",
      actorUserId: founder.userId,
      action: "breakfast_referral_updated",
      entityType: "breakfast_referral",
      entityId: updated.id,
      newValue: { status: body.status },
      outcome: "succeeded",
    });

    return Response.json({ referral: updated });
  } catch (err) {
    return errorResponse(err);
  }
}
