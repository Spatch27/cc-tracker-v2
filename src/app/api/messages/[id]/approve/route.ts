import { z } from "zod";
import { isDatabaseConfigured } from "@/db";
import { errorResponse } from "@/lib/api-auth";
import { requireFounderSession } from "@/lib/auth";
import { recordAuditEvent } from "@/lib/governance/audit";
import {
  createDrizzleMessageStore,
  MessageGovernanceService,
} from "@/lib/governance/messages";
import {
  ApprovalRequiredError,
  ApprovalStaleError,
  ForbiddenGovernanceActionError,
} from "@/lib/governance/proposals";

export const dynamic = "force-dynamic";

const approveSchema = z.object({
  decision: z.enum(["approve", "reject"]),
  expectedContentHash: z.string().optional(),
  note: z.string().nullable().optional(),
});

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const founder = await requireFounderSession();
    if (!founder.userId || !isDatabaseConfigured()) {
      return Response.json(
        { error: "Database is not configured" },
        { status: 503 },
      );
    }

    const { id } = await context.params;
    const body = approveSchema.parse(await request.json());
    const service = new MessageGovernanceService(createDrizzleMessageStore());

    if (body.decision === "reject") {
      const message = await service.rejectMessage({
        messageId: id,
        reviewerUserId: founder.userId,
        actorType: "human",
        note: body.note ?? null,
      });

      await recordAuditEvent({
        actorType: "human",
        actorUserId: founder.userId,
        action: "message_rejected",
        entityType: "message_approval",
        entityId: message.id,
        outcome: "succeeded",
      });

      return Response.json({ message });
    }

    const result = await service.approveMessage({
      messageId: id,
      approverUserId: founder.userId,
      actorType: "human",
      expectedContentHash: body.expectedContentHash,
    });

    await recordAuditEvent({
      actorType: "human",
      actorUserId: founder.userId,
      action: "message_approved",
      entityType: "message_approval",
      entityId: result.message.id,
      outcome: "succeeded",
    });

    return Response.json(result);
  } catch (err) {
    if (
      err instanceof ApprovalRequiredError ||
      err instanceof ApprovalStaleError
    ) {
      return Response.json({ error: err.message }, { status: 409 });
    }
    if (err instanceof ForbiddenGovernanceActionError) {
      return Response.json({ error: err.message }, { status: 403 });
    }
    return errorResponse(err);
  }
}
