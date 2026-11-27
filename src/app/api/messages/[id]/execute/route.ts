import { z } from "zod";
import { getDb, isDatabaseConfigured, schema } from "@/db";
import { authenticateFounderOrAgent, errorResponse } from "@/lib/api-auth";
import { recordAuditEvent } from "@/lib/governance/audit";
import {
  createDrizzleMessageStore,
  MessageGovernanceService,
} from "@/lib/governance/messages";
import {
  ApprovalRequiredError,
  ForbiddenGovernanceActionError,
} from "@/lib/governance/proposals";

export const dynamic = "force-dynamic";

const executeSchema = z.object({
  approvalToken: z.string().min(1),
  executionIdempotencyKey: z.string().min(1),
  outcome: z.enum(["sent", "failed", "outcome_unknown"]),
  executionNote: z.string().nullable().optional(),
  logActivity: z.boolean().default(true),
});

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const actor = await authenticateFounderOrAgent(request, "report:execution");
    if (!isDatabaseConfigured()) {
      return Response.json(
        { error: "Database is not configured" },
        { status: 503 },
      );
    }

    const { id } = await context.params;
    const body = executeSchema.parse(await request.json());
    const store = createDrizzleMessageStore();
    const service = new MessageGovernanceService(store);

    let linkedActivityId: string | null = null;

    const result = await service.recordExecutionOutcome({
      messageId: id,
      approvalToken: body.approvalToken,
      executionIdempotencyKey: body.executionIdempotencyKey,
      outcome: body.outcome,
      executionNote: body.executionNote ?? null,
    });

    if (!result.replayed && body.outcome === "sent" && body.logActivity) {
      const db = getDb();
      const [activity] = await db
        .insert(schema.outreachActivities)
        .values({
          goldAccountId: result.message.goldAccountId,
          breakfastEventId: result.message.breakfastEventId,
          folkPersonLinkId: result.message.folkPersonLinkId,
          channel: result.message.channel,
          direction: "outbound",
          ownerUserId: result.message.senderUserId,
          actorAgentId: actor.kind === "agent" ? actor.agent.id : null,
          subject: result.message.subject,
          bodyPreview: result.message.body.slice(0, 500),
          sourceSystem: actor.kind === "agent" ? "agent" : "tracker_manual",
          idempotencyKey: `msg_exec:${body.executionIdempotencyKey}`,
          executionStatus: "sent",
          visibilityRestricted: false,
          occurredAt: result.message.executedAt ?? new Date(),
        })
        .onConflictDoNothing({ target: schema.outreachActivities.idempotencyKey })
        .returning({ id: schema.outreachActivities.id });

      if (activity) {
        linkedActivityId = activity.id;
        await store.update(result.message.id, { linkedActivityId });
        result.message.linkedActivityId = linkedActivityId;
      }
    }

    await recordAuditEvent({
      actorType: actor.kind,
      actorUserId: actor.kind === "human" ? actor.founder.userId : null,
      actorAgentId: actor.kind === "agent" ? actor.agent.id : null,
      action: "message_execution_reported",
      entityType: "message_approval",
      entityId: result.message.id,
      newValue: {
        outcome: body.outcome,
        replayed: result.replayed,
        linkedActivityId,
      },
      outcome: body.outcome === "failed" ? "failed" : "succeeded",
    });

    const { approvalTokenHash: _omitted, ...safeMessage } = result.message;
    void _omitted;

    return Response.json({
      message: safeMessage,
      replayed: result.replayed,
      linkedActivityId,
    });
  } catch (err) {
    if (err instanceof ApprovalRequiredError) {
      return Response.json({ error: err.message }, { status: 409 });
    }
    if (err instanceof ForbiddenGovernanceActionError) {
      return Response.json({ error: err.message }, { status: 403 });
    }
    return errorResponse(err);
  }
}
