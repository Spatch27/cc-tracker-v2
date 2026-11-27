import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { computeMessageContentHash, sha256Hex } from "./hashing";
import {
  ApprovalRequiredError,
  ApprovalStaleError,
  ForbiddenGovernanceActionError,
} from "./proposals";

export type MessageStatus =
  | "draft"
  | "awaiting_approval"
  | "approved"
  | "rejected"
  | "sent"
  | "failed"
  | "outcome_unknown";

export interface MessageApprovalRecord {
  id: string;
  goldAccountId: string | null;
  breakfastEventId: string | null;
  folkPersonLinkId: string | null;
  senderUserId: string;
  recipientName: string;
  recipientAddress: string;
  channel: "email" | "linkedin" | "other";
  subject: string | null;
  body: string;
  contentHash: string;
  proposedByAgentId: string | null;
  proposedByUserId: string | null;
  status: MessageStatus;
  approvedByUserId: string | null;
  approvedAt: Date | null;
  approvalTokenHash: string | null;
  executionIdempotencyKey: string | null;
  executedAt: Date | null;
  executionNote: string | null;
  linkedActivityId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface MessageStore {
  create(
    input: Omit<
      MessageApprovalRecord,
      | "id"
      | "approvedByUserId"
      | "approvedAt"
      | "approvalTokenHash"
      | "executionIdempotencyKey"
      | "executedAt"
      | "executionNote"
      | "linkedActivityId"
      | "createdAt"
      | "updatedAt"
    >,
  ): Promise<MessageApprovalRecord>;
  getById(id: string): Promise<MessageApprovalRecord | null>;
  findByExecutionKey(key: string): Promise<MessageApprovalRecord | null>;
  update(
    id: string,
    patch: Partial<MessageApprovalRecord>,
  ): Promise<MessageApprovalRecord>;
}

export function createDrizzleMessageStore(): MessageStore {
  return {
    async create(input) {
      const db = getDb();
      const [row] = await db
        .insert(schema.messageApprovals)
        .values(input)
        .returning();
      return row;
    },
    async getById(id) {
      const db = getDb();
      const [row] = await db
        .select()
        .from(schema.messageApprovals)
        .where(eq(schema.messageApprovals.id, id))
        .limit(1);
      return row ?? null;
    },
    async findByExecutionKey(key) {
      const db = getDb();
      const [row] = await db
        .select()
        .from(schema.messageApprovals)
        .where(eq(schema.messageApprovals.executionIdempotencyKey, key))
        .limit(1);
      return row ?? null;
    },
    async update(id, patch) {
      const db = getDb();
      const [row] = await db
        .update(schema.messageApprovals)
        .set({ ...patch, updatedAt: new Date() })
        .where(eq(schema.messageApprovals.id, id))
        .returning();
      return row;
    },
  };
}

export class MessageGovernanceService {
  constructor(private readonly store: MessageStore) {}

  async createDraft(input: {
    goldAccountId?: string | null;
    breakfastEventId?: string | null;
    folkPersonLinkId?: string | null;
    senderUserId: string;
    recipientName: string;
    recipientAddress: string;
    channel: "email" | "linkedin" | "other";
    subject?: string | null;
    body: string;
    proposedByAgentId?: string | null;
    proposedByUserId?: string | null;
    initialStatus?: "draft" | "awaiting_approval";
  }): Promise<MessageApprovalRecord> {
    const contentHash = computeMessageContentHash({
      senderUserId: input.senderUserId,
      recipientName: input.recipientName,
      recipientAddress: input.recipientAddress,
      channel: input.channel,
      subject: input.subject ?? null,
      body: input.body,
    });

    return this.store.create({
      goldAccountId: input.goldAccountId ?? null,
      breakfastEventId: input.breakfastEventId ?? null,
      folkPersonLinkId: input.folkPersonLinkId ?? null,
      senderUserId: input.senderUserId,
      recipientName: input.recipientName,
      recipientAddress: input.recipientAddress,
      channel: input.channel,
      subject: input.subject ?? null,
      body: input.body,
      contentHash,
      proposedByAgentId: input.proposedByAgentId ?? null,
      proposedByUserId: input.proposedByUserId ?? null,
      status: input.initialStatus ?? "awaiting_approval",
    });
  }

  async editDraft(
    messageId: string,
    updates: {
      senderUserId?: string;
      recipientName?: string;
      recipientAddress?: string;
      channel?: "email" | "linkedin" | "other";
      subject?: string | null;
      body?: string;
    },
  ): Promise<MessageApprovalRecord> {
    const existing = await this.store.getById(messageId);
    if (!existing) {
      throw new Error(`Message ${messageId} not found`);
    }
    if (existing.status === "sent") {
      throw new ApprovalRequiredError("Cannot edit a message that has already been sent");
    }

    const next = {
      senderUserId: updates.senderUserId ?? existing.senderUserId,
      recipientName: updates.recipientName ?? existing.recipientName,
      recipientAddress: updates.recipientAddress ?? existing.recipientAddress,
      channel: updates.channel ?? existing.channel,
      subject: updates.subject !== undefined ? updates.subject : existing.subject,
      body: updates.body ?? existing.body,
    };

    const nextHash = computeMessageContentHash(next);
    const hashChanged = nextHash !== existing.contentHash;

    return this.store.update(messageId, {
      ...next,
      contentHash: nextHash,
      status: hashChanged && existing.status === "approved" ? "awaiting_approval" : existing.status,
      approvedByUserId: hashChanged ? null : existing.approvedByUserId,
      approvedAt: hashChanged ? null : existing.approvedAt,
      approvalTokenHash: hashChanged ? null : existing.approvalTokenHash,
    });
  }

  /**
   * Transitions a draft to `approved` and issues a single-use approval token.
   * Deliberately NEVER sets status to `sent`.
   */
  async approveMessage(params: {
    messageId: string;
    approverUserId: string;
    actorType: "human" | "agent";
    expectedContentHash?: string;
  }): Promise<{ message: MessageApprovalRecord; approvalToken: string }> {
    if (params.actorType !== "human") {
      throw new ForbiddenGovernanceActionError("Only a founder can approve an outgoing message");
    }
    const existing = await this.store.getById(params.messageId);
    if (!existing) {
      throw new Error(`Message ${params.messageId} not found`);
    }
    if (existing.status !== "draft" && existing.status !== "awaiting_approval") {
      throw new ApprovalRequiredError(
        `Message cannot be approved from status '${existing.status}'`,
      );
    }
    if (params.expectedContentHash && params.expectedContentHash !== existing.contentHash) {
      throw new ApprovalStaleError(
        "Message content changed since review started; fresh approval is required",
      );
    }

    const approvalToken = `cc_msg_${randomBytes(24).toString("base64url")}`;
    const approvalTokenHash = sha256Hex(approvalToken);

    const updated = await this.store.update(params.messageId, {
      status: "approved",
      approvedByUserId: params.approverUserId,
      approvedAt: new Date(),
      approvalTokenHash,
    });

    return { message: updated, approvalToken };
  }

  async rejectMessage(params: {
    messageId: string;
    reviewerUserId: string;
    actorType: "human" | "agent";
    note?: string | null;
  }): Promise<MessageApprovalRecord> {
    if (params.actorType !== "human") {
      throw new ForbiddenGovernanceActionError("Only a founder can reject a message");
    }
    const existing = await this.store.getById(params.messageId);
    if (!existing) {
      throw new Error(`Message ${params.messageId} not found`);
    }
    return this.store.update(params.messageId, {
      status: "rejected",
      approvedByUserId: null,
      approvedAt: null,
      approvalTokenHash: null,
      executionNote: params.note ?? existing.executionNote,
    });
  }

  async recordExecutionOutcome(params: {
    messageId: string;
    approvalToken: string;
    executionIdempotencyKey: string;
    outcome: "sent" | "failed" | "outcome_unknown";
    executionNote?: string | null;
    linkedActivityId?: string | null;
  }): Promise<{ message: MessageApprovalRecord; replayed: boolean }> {
    const existingByKey = await this.store.findByExecutionKey(params.executionIdempotencyKey);
    if (existingByKey) {
      return { message: existingByKey, replayed: true };
    }

    const existing = await this.store.getById(params.messageId);
    if (!existing) {
      throw new Error(`Message ${params.messageId} not found`);
    }

    if (
      existing.status === "sent" ||
      existing.status === "failed" ||
      existing.status === "outcome_unknown"
    ) {
      return { message: existing, replayed: true };
    }

    if (existing.status !== "approved") {
      throw new ApprovalRequiredError(
        `Cannot record execution outcome from status '${existing.status}'; message must be approved first`,
      );
    }

    if (!existing.approvalTokenHash || sha256Hex(params.approvalToken) !== existing.approvalTokenHash) {
      throw new ForbiddenGovernanceActionError("Invalid or stale message approval token");
    }

    const updated = await this.store.update(params.messageId, {
      status: params.outcome,
      executionIdempotencyKey: params.executionIdempotencyKey,
      executedAt: new Date(),
      executionNote: params.executionNote ?? null,
      linkedActivityId: params.linkedActivityId ?? existing.linkedActivityId,
    });

    return { message: updated, replayed: false };
  }
}
