import { z } from "zod";
import { isDatabaseConfigured } from "@/db";
import { authenticateFounderOrAgent, errorResponse } from "@/lib/api-auth";
import { recordAuditEvent } from "@/lib/governance/audit";
import {
  createDrizzleMessageStore,
  MessageGovernanceService,
  type MessageApprovalRecord,
} from "@/lib/governance/messages";
import { ApprovalRequiredError } from "@/lib/governance/proposals";

export const dynamic = "force-dynamic";

const editMessageSchema = z.object({
  senderUserId: z.string().uuid().optional(),
  recipientName: z.string().min(1).optional(),
  recipientAddress: z.string().min(1).optional(),
  channel: z.enum(["email", "linkedin", "other"]).optional(),
  subject: z.string().nullable().optional(),
  body: z.string().min(1).optional(),
});

function sanitizeMessageRecord(msg: MessageApprovalRecord) {
  const { approvalTokenHash: _omitted, ...safe } = msg;
  void _omitted;
  return safe;
}

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    await authenticateFounderOrAgent(request, "read:context");
    if (!isDatabaseConfigured()) {
      return Response.json(
        { error: "Database is not configured" },
        { status: 503 },
      );
    }

    const { id } = await context.params;
    const store = createDrizzleMessageStore();
    const message = await store.getById(id);
    if (!message) {
      return Response.json({ error: "Message draft not found" }, { status: 404 });
    }

    return Response.json({ message: sanitizeMessageRecord(message) });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const actor = await authenticateFounderOrAgent(request, "draft:message");
    if (!isDatabaseConfigured()) {
      return Response.json(
        { error: "Database is not configured" },
        { status: 503 },
      );
    }

    const { id } = await context.params;
    const body = editMessageSchema.parse(await request.json());
    const service = new MessageGovernanceService(createDrizzleMessageStore());

    const updated = await service.editDraft(id, body);

    await recordAuditEvent({
      actorType: actor.kind,
      actorUserId: actor.kind === "human" ? actor.founder.userId : null,
      actorAgentId: actor.kind === "agent" ? actor.agent.id : null,
      action: "message_draft_edited",
      entityType: "message_approval",
      entityId: updated.id,
      newValue: {
        status: updated.status,
        contentHash: updated.contentHash,
      },
      outcome: "succeeded",
    });

    return Response.json({ message: sanitizeMessageRecord(updated) });
  } catch (err) {
    if (err instanceof ApprovalRequiredError) {
      return Response.json({ error: err.message }, { status: 409 });
    }
    return errorResponse(err);
  }
}
