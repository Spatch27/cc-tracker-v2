import { desc } from "drizzle-orm";
import { z } from "zod";
import { getDb, isDatabaseConfigured, schema } from "@/db";
import { authenticateFounderOrAgent, errorResponse } from "@/lib/api-auth";
import { recordAuditEvent } from "@/lib/governance/audit";
import {
  createDrizzleMessageStore,
  MessageGovernanceService,
} from "@/lib/governance/messages";

export const dynamic = "force-dynamic";

const createMessageSchema = z.object({
  goldAccountId: z.string().uuid().nullable().optional(),
  breakfastEventId: z.string().uuid().nullable().optional(),
  folkPersonLinkId: z.string().uuid().nullable().optional(),
  senderUserId: z.string().uuid(),
  recipientName: z.string().min(1),
  recipientAddress: z.string().min(1),
  channel: z.enum(["email", "linkedin", "other"]),
  subject: z.string().nullable().optional(),
  body: z.string().min(1),
  initialStatus: z.enum(["draft", "awaiting_approval"]).optional(),
});

export async function GET(request: Request) {
  try {
    await authenticateFounderOrAgent(request, "read:context");
    if (!isDatabaseConfigured()) {
      return Response.json({ messages: [], databaseConfigured: false });
    }
    const db = getDb();
    const messages = await db
      .select()
      .from(schema.messageApprovals)
      .orderBy(desc(schema.messageApprovals.createdAt))
      .limit(100);
    return Response.json({ messages });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const actor = await authenticateFounderOrAgent(request, "draft:message");
    if (!isDatabaseConfigured()) {
      return Response.json(
        { error: "Database is not configured" },
        { status: 503 },
      );
    }

    const body = createMessageSchema.parse(await request.json());
    const service = new MessageGovernanceService(createDrizzleMessageStore());

    const message = await service.createDraft({
      goldAccountId: body.goldAccountId ?? null,
      breakfastEventId: body.breakfastEventId ?? null,
      folkPersonLinkId: body.folkPersonLinkId ?? null,
      senderUserId: body.senderUserId,
      recipientName: body.recipientName,
      recipientAddress: body.recipientAddress,
      channel: body.channel,
      subject: body.subject ?? null,
      body: body.body,
      proposedByAgentId: actor.kind === "agent" ? actor.agent.id : null,
      proposedByUserId: actor.kind === "human" ? actor.founder.userId : null,
      initialStatus: body.initialStatus ?? "awaiting_approval",
    });

    await recordAuditEvent({
      actorType: actor.kind,
      actorUserId: actor.kind === "human" ? actor.founder.userId : null,
      actorAgentId: actor.kind === "agent" ? actor.agent.id : null,
      action: "message_draft_created",
      entityType: "message_approval",
      entityId: message.id,
      outcome: "succeeded",
    });

    return Response.json({ message }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
