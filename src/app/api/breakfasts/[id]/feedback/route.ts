import { z } from "zod";
import { getDb, isDatabaseConfigured, schema } from "@/db";
import { errorResponse } from "@/lib/api-auth";
import { requireFounderSession } from "@/lib/auth";
import { recordAuditEvent } from "@/lib/governance/audit";

export const dynamic = "force-dynamic";

const createFeedbackSchema = z.object({
  category: z.enum(["event", "format", "venue", "attendee_mix", "content"]),
  summary: z.string().min(1).max(2000),
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
    const body = createFeedbackSchema.parse(await request.json());
    const db = getDb();

    const [created] = await db
      .insert(schema.breakfastFeedback)
      .values({
        eventId,
        recordedByUserId: founder.userId,
        category: body.category,
        summary: body.summary.trim(),
      })
      .returning();

    await recordAuditEvent({
      actorType: "human",
      actorUserId: founder.userId,
      action: "breakfast_feedback_recorded",
      entityType: "breakfast_feedback",
      entityId: created.id,
      newValue: body,
      outcome: "succeeded",
    });

    return Response.json({ feedback: created }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
