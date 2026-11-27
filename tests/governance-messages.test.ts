import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  MessageGovernanceService,
  type MessageApprovalRecord,
  type MessageStore,
} from "@/lib/governance/messages";
import {
  ApprovalRequiredError,
  ForbiddenGovernanceActionError,
} from "@/lib/governance/proposals";

function createInMemoryMessageStore(): MessageStore {
  const rows = new Map<string, MessageApprovalRecord>();
  return {
    async create(input) {
      const now = new Date();
      const record: MessageApprovalRecord = {
        ...input,
        id: randomUUID(),
        approvedByUserId: null,
        approvedAt: null,
        approvalTokenHash: null,
        executionIdempotencyKey: null,
        executedAt: null,
        executionNote: null,
        linkedActivityId: null,
        createdAt: now,
        updatedAt: now,
      };
      rows.set(record.id, record);
      return record;
    },
    async getById(id) {
      return rows.get(id) ?? null;
    },
    async findByExecutionKey(key) {
      for (const r of rows.values()) {
        if (r.executionIdempotencyKey === key) return r;
      }
      return null;
    },
    async update(id, patch) {
      const existing = rows.get(id);
      if (!existing) throw new Error("Not found");
      const updated = { ...existing, ...patch, updatedAt: new Date() };
      rows.set(id, updated);
      return updated;
    },
  };
}

describe("message approval governance", () => {
  it("approval never marks a message sent and edits invalidate prior approval", async () => {
    const store = createInMemoryMessageStore();
    const service = new MessageGovernanceService(store);

    const draft = await service.createDraft({
      senderUserId: "user_tim",
      recipientName: "Alex Smith",
      recipientAddress: "alex@brand.co.uk",
      channel: "email",
      subject: "London CMO Breakfast",
      body: "Would love to host you on 12 May.",
    });
    expect(draft.status).toBe("awaiting_approval");

    const { message: approved, approvalToken } = await service.approveMessage({
      messageId: draft.id,
      approverUserId: "user_tim",
      actorType: "human",
      expectedContentHash: draft.contentHash,
    });
    expect(approved.status).toBe("approved");
    expect(approved.executedAt).toBeNull();

    // Editing body after approval resets status to awaiting_approval
    const edited = await service.editDraft(draft.id, {
      body: "Updated wording for 12 May.",
    });
    expect(edited.status).toBe("awaiting_approval");
    expect(edited.approvalTokenHash).toBeNull();

    // Old approval token cannot execute an unapproved/edited message
    await expect(
      service.recordExecutionOutcome({
        messageId: draft.id,
        approvalToken,
        executionIdempotencyKey: "send-1",
        outcome: "sent",
      }),
    ).rejects.toBeInstanceOf(ApprovalRequiredError);
  });

  it("requires valid approval token to report execution and deduplicates retries", async () => {
    const store = createInMemoryMessageStore();
    const service = new MessageGovernanceService(store);

    const draft = await service.createDraft({
      senderUserId: "user_ben",
      recipientName: "Sam Lee",
      recipientAddress: "sam@brand.co.uk",
      channel: "email",
      subject: "Follow-up",
      body: "Great meeting you.",
    });

    const { approvalToken } = await service.approveMessage({
      messageId: draft.id,
      approverUserId: "user_ben",
      actorType: "human",
    });

    await expect(
      service.recordExecutionOutcome({
        messageId: draft.id,
        approvalToken: "wrong-token",
        executionIdempotencyKey: "send-2",
        outcome: "sent",
      }),
    ).rejects.toBeInstanceOf(ForbiddenGovernanceActionError);

    const first = await service.recordExecutionOutcome({
      messageId: draft.id,
      approvalToken,
      executionIdempotencyKey: "send-2",
      outcome: "sent",
    });
    expect(first.replayed).toBe(false);
    expect(first.message.status).toBe("sent");

    const retry = await service.recordExecutionOutcome({
      messageId: draft.id,
      approvalToken,
      executionIdempotencyKey: "send-2",
      outcome: "sent",
    });
    expect(retry.replayed).toBe(true);
    expect(retry.message.status).toBe("sent");
  });
});
