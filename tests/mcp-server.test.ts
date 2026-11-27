import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { AgentIdentityRecord } from "@/lib/agent-auth";
import { handleMcpJsonRpc } from "@/lib/mcp/server";
import {
  ProposalGovernanceService,
  type ChangeProposalRecord,
  type ProposalStore,
} from "@/lib/governance/proposals";
import {
  MessageGovernanceService,
  type MessageApprovalRecord,
  type MessageStore,
} from "@/lib/governance/messages";

function createTestAgent(scopes: string[]): AgentIdentityRecord {
  return {
    id: randomUUID(),
    name: "Claude Test Agent",
    scopes,
    revokedAt: null,
  };
}

describe("Tracker MCP server (Phase 4)", () => {
  it("filters tools/list to granted scopes and blocks out-of-scope tools/call", async () => {
    const readOnlyAgent = createTestAgent(["read:context"]);
    const auditSpy = vi.fn(async () => {});
    const draftSpy = vi.fn(async () => ({ ok: true }));

    const listRes = await handleMcpJsonRpc(
      { jsonrpc: "2.0", id: 1, method: "tools/list" },
      { agent: readOnlyAgent, recordAudit: auditSpy },
    );

    const listedNames = (
      (listRes.body?.result as { tools: Array<{ name: string }> })?.tools ?? []
    ).map((t) => t.name);

    expect(listedNames).toContain("get_breakfast_preread_context");
    expect(listedNames).toContain("list_gold_accounts");
    expect(listedNames).not.toContain("submit_message_draft");
    expect(listedNames).not.toContain("submit_research_proposal");

    const deniedRes = await handleMcpJsonRpc(
      {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: {
          name: "submit_message_draft",
          arguments: { recipientName: "Alex" },
        },
      },
      {
        agent: readOnlyAgent,
        handlers: { submit_message_draft: draftSpy },
        recordAudit: auditSpy,
      },
    );

    expect((deniedRes.body?.error as { code: number })?.code).toBe(-32003);
    expect(draftSpy).not.toHaveBeenCalled();
    expect(auditSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "mcp_tool_denied",
        outcome: "denied",
      }),
    );
  });

  it("delivers breakfast preread context for Ben's Claude workflow", async () => {
    const agent = createTestAgent(["read:context"]);
    const auditSpy = vi.fn(async () => {});
    const prereadPayload = {
      eventId: "evt_london_1",
      title: "London CMO Breakfast",
      markdown: "# Claude Preread Context — London CMO Breakfast\n\n- **Jane Doe**",
      confirmedGuestsCount: 1,
    };

    const res = await handleMcpJsonRpc(
      {
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: {
          name: "get_breakfast_preread_context",
          arguments: { eventId: "evt_london_1" },
        },
      },
      {
        agent,
        handlers: {
          get_breakfast_preread_context: async () => prereadPayload,
        },
        recordAudit: auditSpy,
      },
    );

    const contentText = (
      res.body?.result as { content: Array<{ text: string }> }
    ).content[0]?.text;
    const parsed = JSON.parse(contentText);
    expect(parsed.eventId).toBe("evt_london_1");
    expect(parsed.markdown).toContain("London CMO Breakfast");
  });

  it("queues MCP research proposals in pending_review and enforces message execution tokens", async () => {
    const proposals: ChangeProposalRecord[] = [];
    const proposalStore: ProposalStore = {
      async create(input) {
        const rec: ChangeProposalRecord = {
          ...input,
          id: randomUUID(),
          reviewedByUserId: null,
          reviewedAt: null,
          reviewNote: null,
          appliedAt: null,
          applyError: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        proposals.push(rec);
        return rec;
      },
      async getById(id) {
        return proposals.find((p) => p.id === id) ?? null;
      },
      async findByIdempotencyKey(key) {
        return proposals.find((p) => p.idempotencyKey === key) ?? null;
      },
      async update(id, patch) {
        const idx = proposals.findIndex((p) => p.id === id);
        proposals[idx] = { ...proposals[idx], ...patch, updatedAt: new Date() };
        return proposals[idx];
      },
    };
    const proposalService = new ProposalGovernanceService(proposalStore);

    const messages: MessageApprovalRecord[] = [];
    const messageStore: MessageStore = {
      async create(input) {
        const rec: MessageApprovalRecord = {
          ...input,
          id: randomUUID(),
          approvedByUserId: null,
          approvedAt: null,
          approvalTokenHash: null,
          executionIdempotencyKey: null,
          executedAt: null,
          executionNote: null,
          linkedActivityId: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        messages.push(rec);
        return rec;
      },
      async getById(id) {
        return messages.find((m) => m.id === id) ?? null;
      },
      async findByExecutionKey(key) {
        return messages.find((m) => m.executionIdempotencyKey === key) ?? null;
      },
      async update(id, patch) {
        const idx = messages.findIndex((m) => m.id === id);
        messages[idx] = { ...messages[idx], ...patch, updatedAt: new Date() };
        return messages[idx];
      },
    };
    const msgService = new MessageGovernanceService(messageStore);

    const agent = createTestAgent([
      "read:context",
      "propose:research",
      "draft:message",
      "report:execution",
    ]);
    const auditSpy = vi.fn(async () => {});

    const propRes = await handleMcpJsonRpc(
      {
        jsonrpc: "2.0",
        id: 10,
        method: "tools/call",
        params: {
          name: "submit_research_proposal",
          arguments: {
            targetSystem: "folk",
            entityType: "person",
            entityId: "per_5",
            folkRecordId: "per_5",
            summary: "Updated role",
            proposedChangesJson: { jobTitle: "CMO" },
            baseSnapshotJson: { jobTitle: "VP Marketing" },
          },
        },
      },
      {
        agent,
        handlers: {
          submit_research_proposal: async (args) => {
            const p = await proposalService.createProposal({
              targetSystem: args.targetSystem as "folk" | "tracker",
              entityType: args.entityType as "person",
              entityId: args.entityId as string,
              folkRecordId: args.folkRecordId as string,
              proposedByAgentId: agent.id,
              summary: args.summary as string,
              proposedChangesJson: args.proposedChangesJson as Record<string, unknown>,
              baseSnapshotJson: args.baseSnapshotJson as Record<string, unknown>,
            });
            return { proposal: p };
          },
        },
        recordAudit: auditSpy,
      },
    );

    const createdProp = JSON.parse(
      (propRes.body?.result as { content: Array<{ text: string }> }).content[0]
        .text,
    ).proposal;
    expect(createdProp.status).toBe("pending_review");

    // Draft + approve message, then report execution via MCP
    const draft = await msgService.createDraft({
      senderUserId: "user_ben",
      recipientName: "Alex Brand",
      recipientAddress: "alex@brand.co.uk",
      channel: "email",
      subject: "Bristol Breakfast",
      body: "Hi Alex, hope you can join us.",
      proposedByAgentId: agent.id,
    });
    const { approvalToken } = await msgService.approveMessage({
      messageId: draft.id,
      approverUserId: "user_ben",
      actorType: "human",
    });

    const execHandler = async (args: Record<string, unknown>) =>
      msgService.recordExecutionOutcome({
        messageId: args.messageId as string,
        approvalToken: args.approvalToken as string,
        executionIdempotencyKey: args.executionIdempotencyKey as string,
        outcome: args.outcome as "sent" | "failed" | "outcome_unknown",
      });

    const firstExec = await handleMcpJsonRpc(
      {
        jsonrpc: "2.0",
        id: 11,
        method: "tools/call",
        params: {
          name: "report_message_execution",
          arguments: {
            messageId: draft.id,
            approvalToken,
            executionIdempotencyKey: "mcp-send-1",
            outcome: "sent",
          },
        },
      },
      { agent, handlers: { report_message_execution: execHandler }, recordAudit: auditSpy },
    );

    const parsedExec = JSON.parse(
      (firstExec.body?.result as { content: Array<{ text: string }> }).content[0]
        .text,
    );
    expect(parsedExec.replayed).toBe(false);
    expect(parsedExec.message.status).toBe("sent");

    const retryExec = await handleMcpJsonRpc(
      {
        jsonrpc: "2.0",
        id: 12,
        method: "tools/call",
        params: {
          name: "report_message_execution",
          arguments: {
            messageId: draft.id,
            approvalToken,
            executionIdempotencyKey: "mcp-send-1",
            outcome: "sent",
          },
        },
      },
      { agent, handlers: { report_message_execution: execHandler }, recordAudit: auditSpy },
    );
    const parsedRetry = JSON.parse(
      (retryExec.body?.result as { content: Array<{ text: string }> }).content[0]
        .text,
    );
    expect(parsedRetry.replayed).toBe(true);
  });
});
