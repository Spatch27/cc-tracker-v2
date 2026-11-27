import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, isDatabaseConfigured, schema } from "@/db";
import { errorResponse } from "@/lib/api-auth";
import { requireFounderSession } from "@/lib/auth";
import { recordAuditEvent } from "@/lib/governance/audit";

export const dynamic = "force-dynamic";

const createSignalSchema = z.object({
  signalType: z.enum([
    "leadership_change",
    "funding",
    "consolidation",
    "integration",
    "acquisition",
    "other",
  ]),
  title: z.string().min(1).max(240),
  details: z.string().max(2000).nullable().optional(),
  factType: z.enum(["verified", "interpretation", "unknown"]).default("verified"),
  signalDate: z.string().nullable().optional(),
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
    const body = createSignalSchema.parse(await request.json());
    const db = getDb();

    const [created] = await db
      .insert(schema.buyingSignals)
      .values({
        goldAccountId,
        signalType: body.signalType,
        title: body.title.trim(),
        details: body.details?.trim() || null,
        factType: body.factType,
        signalDate: body.signalDate ? new Date(body.signalDate) : null,
        observedAt: new Date(),
        sourceUrl: body.sourceUrl?.trim() || null,
        sourceNote: body.sourceNote?.trim() || null,
        recordedByUserId: founder.userId,
      })
      .returning();

    await recordAuditEvent({
      actorType: "human",
      actorUserId: founder.userId,
      action: "gold_buying_signal_recorded",
      entityType: "buying_signal",
      entityId: created.id,
      newValue: body,
      evidenceDate: created.signalDate,
      outcome: "succeeded",
    });

    return Response.json({ signal: created }, { status: 201 });
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
    const signalId = searchParams.get("signalId");
    if (!signalId) {
      return Response.json(
        { error: "signalId is required" },
        { status: 400 },
      );
    }

    const db = getDb();
    const [deleted] = await db
      .delete(schema.buyingSignals)
      .where(
        and(
          eq(schema.buyingSignals.id, signalId),
          eq(schema.buyingSignals.goldAccountId, goldAccountId),
        ),
      )
      .returning();

    if (!deleted) {
      return Response.json(
        { error: "Buying signal not found" },
        { status: 404 },
      );
    }

    await recordAuditEvent({
      actorType: "human",
      actorUserId: founder.userId,
      action: "gold_buying_signal_deleted",
      entityType: "buying_signal",
      entityId: signalId,
      previousValue: { signalType: deleted.signalType, title: deleted.title },
      outcome: "succeeded",
    });

    return Response.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
