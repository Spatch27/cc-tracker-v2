import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, isDatabaseConfigured, schema } from "@/db";
import { snoozeFollowUpAction } from "@/lib/actions/follow-ups";
import { errorResponse } from "@/lib/api-auth";
import { requireFounderSession } from "@/lib/auth";
import { recordAuditEvent } from "@/lib/governance/audit";

export const dynamic = "force-dynamic";

const patchActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("complete") }),
  z.object({ action: z.literal("reopen") }),
  z.object({ action: z.literal("cancel") }),
  z.object({
    action: z.literal("snooze"),
    newDueDate: z.string().min(1),
    reason: z.string().max(300).optional(),
  }),
  z.object({
    action: z.literal("reassign"),
    ownerUserId: z.string().uuid(),
  }),
]);

export async function PATCH(
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

    const { id } = await context.params;
    const body = patchActionSchema.parse(await request.json());
    const db = getDb();

    const [existing] = await db
      .select()
      .from(schema.followUpActions)
      .where(eq(schema.followUpActions.id, id))
      .limit(1);

    if (!existing) {
      return Response.json(
        { error: "Follow-up action not found" },
        { status: 404 },
      );
    }

    let patch: Partial<typeof schema.followUpActions.$inferInsert> = {
      updatedAt: new Date(),
    };

    if (body.action === "complete") {
      patch.status = "completed";
      patch.completedAt = new Date();
    } else if (body.action === "reopen") {
      patch.status = "open";
      patch.completedAt = null;
    } else if (body.action === "cancel") {
      patch.status = "cancelled";
    } else if (body.action === "reassign") {
      patch.ownerUserId = body.ownerUserId;
    } else if (body.action === "snooze") {
      const snoozed = snoozeFollowUpAction(
        {
          ...existing,
          snoozeHistoryJson: existing.snoozeHistoryJson ?? [],
        },
        new Date(body.newDueDate),
        {
          snoozedByUserId: founder.userId ?? undefined,
          reason: body.reason,
        },
      );
      patch.dueDate = snoozed.dueDate;
      patch.snoozeHistoryJson = snoozed.snoozeHistoryJson;
    }

    const [updated] = await db
      .update(schema.followUpActions)
      .set(patch)
      .where(eq(schema.followUpActions.id, id))
      .returning();

    await recordAuditEvent({
      actorType: "human",
      actorUserId: founder.userId,
      action: `follow_up_action_${body.action}`,
      entityType: "follow_up_action",
      entityId: id,
      previousValue: { status: existing.status, dueDate: existing.dueDate },
      newValue: body,
      outcome: "succeeded",
    });

    return Response.json({ action: updated });
  } catch (err) {
    return errorResponse(err);
  }
}
