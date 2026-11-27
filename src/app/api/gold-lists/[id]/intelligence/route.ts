import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, isDatabaseConfigured, schema } from "@/db";
import { errorResponse } from "@/lib/api-auth";
import { requireFounderSession } from "@/lib/auth";
import { recordAuditEvent } from "@/lib/governance/audit";

export const dynamic = "force-dynamic";

const createIntelSchema = z.object({
  dimension: z.enum(["team", "process", "data", "tech"]),
  summary: z.string().min(1).max(2000),
  factType: z.enum(["verified", "interpretation", "unknown"]).default("verified"),
  evidenceDate: z.string().nullable().optional(),
  sourceUrl: z.string().max(500).nullable().optional(),
  sourceNote: z.string().max(500).nullable().optional(),
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

    const { id: goldAccountId } = await context.params;
    const body = createIntelSchema.parse(await request.json());
    const db = getDb();

    const [created] = await db
      .insert(schema.accountIntelligence)
      .values({
        goldAccountId,
        dimension: body.dimension,
        summary: body.summary.trim(),
        factType: body.factType,
        evidenceDate: body.evidenceDate ? new Date(body.evidenceDate) : null,
        observedAt: new Date(),
        sourceUrl: body.sourceUrl?.trim() || null,
        sourceNote: body.sourceNote?.trim() || null,
        recordedByUserId: founder.userId,
      })
      .returning();

    await recordAuditEvent({
      actorType: "human",
      actorUserId: founder.userId,
      action: "gold_intelligence_recorded",
      entityType: "account_intelligence",
      entityId: created.id,
      newValue: body,
      evidenceDate: created.evidenceDate,
      outcome: "succeeded",
    });

    return Response.json({ intelligence: created }, { status: 201 });
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
    const intelligenceId = searchParams.get("intelligenceId");
    if (!intelligenceId) {
      return Response.json(
        { error: "intelligenceId is required" },
        { status: 400 },
      );
    }

    const db = getDb();
    const [deleted] = await db
      .delete(schema.accountIntelligence)
      .where(
        and(
          eq(schema.accountIntelligence.id, intelligenceId),
          eq(schema.accountIntelligence.goldAccountId, goldAccountId),
        ),
      )
      .returning();

    if (!deleted) {
      return Response.json(
        { error: "Intelligence entry not found" },
        { status: 404 },
      );
    }

    await recordAuditEvent({
      actorType: "human",
      actorUserId: founder.userId,
      action: "gold_intelligence_deleted",
      entityType: "account_intelligence",
      entityId: intelligenceId,
      previousValue: { dimension: deleted.dimension, summary: deleted.summary },
      outcome: "succeeded",
    });

    return Response.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
