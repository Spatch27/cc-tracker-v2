import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { getDb, isDatabaseConfigured, schema } from "@/db";
import {
  flagActionsForInboundReply,
  snoozeFollowUpAction,
} from "@/lib/actions/follow-ups";
import {
  verifyAgentPermissions,
  type AgentIdentityRecord,
} from "@/lib/agent-auth";
import type { AgentScope } from "@/lib/agent-scopes";
import { buildBreakfastPrereadContext } from "@/lib/breakfasts/preread";
import { listBreakfastsSummary } from "@/lib/breakfasts/queries";
import {
  listGoldAccountsSummary,
  loadGoldAccountWorkspace,
} from "@/lib/gold-lists/queries";
import { recordAuditEvent } from "@/lib/governance/audit";
import {
  createDrizzleMessageStore,
  MessageGovernanceService,
} from "@/lib/governance/messages";
import {
  createDrizzleProposalStore,
  ProposalGovernanceService,
} from "@/lib/governance/proposals";

export interface McpToolDefinition {
  name: string;
  description: string;
  requiredScope: AgentScope;
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export const MCP_TOOLS: readonly McpToolDefinition[] = [
  {
    name: "list_breakfasts",
    description:
      "List CMO Breakfast events with locale, dates, venue, guest capacity metrics, and invitee counts.",
    requiredScope: "read:context",
    inputSchema: {
      type: "object",
      properties: {
        locale: { type: "string", description: "Optional locale filter (e.g. London, Bristol, Exeter)." },
      },
    },
  },
  {
    name: "get_breakfast_preread_context",
    description:
      "Retrieve structured guest, company, host, capacity, timing notes, and formatted markdown context for Ben's Claude breakfast preread workflow.",
    requiredScope: "read:context",
    inputSchema: {
      type: "object",
      properties: {
        eventId: { type: "string", description: "UUID of the breakfast event." },
      },
      required: ["eventId"],
    },
  },
  {
    name: "list_gold_accounts",
    description:
      "List active and archived Gold List accounts across both founders with owner quotas and open action counts.",
    requiredScope: "read:context",
    inputSchema: {
      type: "object",
      properties: {
        ownerEmail: { type: "string", description: "Optional founder email filter." },
      },
    },
  },
  {
    name: "get_gold_account_context",
    description:
      "Load full Gold account workspace: linked Folk company, decision-makers, Team/Process/Data/Tech intelligence, buying signals, outreach timeline, and follow-up actions.",
    requiredScope: "read:context",
    inputSchema: {
      type: "object",
      properties: {
        goldAccountId: { type: "string", description: "UUID of the Gold account." },
      },
      required: ["goldAccountId"],
    },
  },
  {
    name: "submit_research_proposal",
    description:
      "Submit proposed Folk or tracker updates with evidence, source URL/note, and base snapshot into pending_review. Never writes directly to Folk.",
    requiredScope: "propose:research",
    inputSchema: {
      type: "object",
      properties: {
        targetSystem: { type: "string", enum: ["folk", "tracker"] },
        entityType: {
          type: "string",
          enum: ["person", "company", "gold_account", "breakfast_event"],
        },
        entityId: { type: "string" },
        folkRecordId: { type: "string" },
        summary: { type: "string" },
        proposedChangesJson: { type: "object" },
        baseSnapshotJson: { type: "object" },
        sourceUrl: { type: "string" },
        sourceNote: { type: "string" },
        factType: { type: "string", enum: ["verified", "interpretation", "unknown"] },
        evidenceDate: { type: "string" },
        idempotencyKey: { type: "string" },
      },
      required: ["targetSystem", "entityType", "entityId", "summary", "proposedChangesJson"],
    },
  },
  {
    name: "get_proposal_status",
    description:
      "Inspect a research proposal's current review/conflict/applied status and payload hash.",
    requiredScope: "read:context",
    inputSchema: {
      type: "object",
      properties: {
        proposalId: { type: "string" },
      },
      required: ["proposalId"],
    },
  },
  {
    name: "submit_message_draft",
    description:
      "Create an individual outgoing message draft in awaiting_approval status bound by exact SHA-256 content hash. Approval is required before sending.",
    requiredScope: "draft:message",
    inputSchema: {
      type: "object",
      properties: {
        goldAccountId: { type: "string" },
        breakfastEventId: { type: "string" },
        folkPersonLinkId: { type: "string" },
        senderUserId: { type: "string" },
        recipientName: { type: "string" },
        recipientAddress: { type: "string" },
        channel: { type: "string", enum: ["email", "linkedin", "other"] },
        subject: { type: "string" },
        body: { type: "string" },
      },
      required: ["senderUserId", "recipientName", "recipientAddress", "channel", "body"],
    },
  },
  {
    name: "get_message_approval_status",
    description:
      "Check approval state and exact approved content for a message draft. Never exposes plaintext approval tokens.",
    requiredScope: "read:context",
    inputSchema: {
      type: "object",
      properties: {
        messageId: { type: "string" },
      },
      required: ["messageId"],
    },
  },
  {
    name: "report_message_execution",
    description:
      "Report external execution outcome (sent, failed, or outcome_unknown) for an approved message using the single-use approval token and idempotency key.",
    requiredScope: "report:execution",
    inputSchema: {
      type: "object",
      properties: {
        messageId: { type: "string" },
        approvalToken: { type: "string" },
        executionIdempotencyKey: { type: "string" },
        outcome: { type: "string", enum: ["sent", "failed", "outcome_unknown"] },
        executionNote: { type: "string" },
        logActivity: { type: "boolean" },
      },
      required: ["messageId", "approvalToken", "executionIdempotencyKey", "outcome"],
    },
  },
  {
    name: "log_outreach_activity",
    description:
      "Record a manual outreach activity or inbound reply in the tracker with idempotency deduplication.",
    requiredScope: "log:activity",
    inputSchema: {
      type: "object",
      properties: {
        goldAccountId: { type: "string" },
        breakfastEventId: { type: "string" },
        folkPersonLinkId: { type: "string" },
        channel: { type: "string", enum: ["email", "linkedin", "postcard", "call", "meeting", "other"] },
        direction: { type: "string", enum: ["outbound", "inbound", "note"] },
        ownerUserId: { type: "string" },
        conversationKey: { type: "string" },
        subject: { type: "string" },
        bodyPreview: { type: "string" },
        occurredAt: { type: "string" },
        idempotencyKey: { type: "string" },
      },
      required: ["channel", "direction"],
    },
  },
  {
    name: "manage_follow_up_action",
    description:
      "Create, snooze, complete, or reopen a founder-owned follow-up action while preserving snooze history.",
    requiredScope: "manage:actions",
    inputSchema: {
      type: "object",
      properties: {
        operation: { type: "string", enum: ["create", "snooze", "complete", "reopen"] },
        actionId: { type: "string" },
        goldAccountId: { type: "string" },
        breakfastEventId: { type: "string" },
        folkPersonLinkId: { type: "string" },
        ownerUserId: { type: "string" },
        title: { type: "string" },
        notes: { type: "string" },
        dueDate: { type: "string" },
        reason: { type: "string" },
      },
      required: ["operation"],
    },
  },
];

export type McpToolName = (typeof MCP_TOOLS)[number]["name"];
export type McpToolHandlers = Record<string, (args: Record<string, unknown>) => Promise<unknown>>;

const proposalArgsSchema = z.object({
  targetSystem: z.enum(["folk", "tracker"]),
  entityType: z.enum(["person", "company", "gold_account", "breakfast_event"]),
  entityId: z.string().min(1),
  folkRecordId: z.string().nullable().optional(),
  summary: z.string().min(1),
  proposedChangesJson: z.record(z.unknown()),
  baseSnapshotJson: z.record(z.unknown()).default({}),
  sourceUrl: z.string().nullable().optional(),
  sourceNote: z.string().nullable().optional(),
  factType: z.enum(["verified", "interpretation", "unknown"]).optional(),
  evidenceDate: z.string().nullable().optional(),
  idempotencyKey: z.string().nullable().optional(),
});

const draftArgsSchema = z.object({
  goldAccountId: z.string().uuid().nullable().optional(),
  breakfastEventId: z.string().uuid().nullable().optional(),
  folkPersonLinkId: z.string().uuid().nullable().optional(),
  senderUserId: z.string().uuid(),
  recipientName: z.string().min(1),
  recipientAddress: z.string().min(1),
  channel: z.enum(["email", "linkedin", "other"]),
  subject: z.string().nullable().optional(),
  body: z.string().min(1),
});

const reportExecArgsSchema = z.object({
  messageId: z.string().uuid(),
  approvalToken: z.string().min(1),
  executionIdempotencyKey: z.string().min(1),
  outcome: z.enum(["sent", "failed", "outcome_unknown"]),
  executionNote: z.string().nullable().optional(),
  logActivity: z.boolean().default(true),
});

const logActivityArgsSchema = z.object({
  goldAccountId: z.string().uuid().nullable().optional(),
  breakfastEventId: z.string().uuid().nullable().optional(),
  folkPersonLinkId: z.string().uuid().nullable().optional(),
  channel: z.enum(["email", "linkedin", "postcard", "call", "meeting", "other"]),
  direction: z.enum(["outbound", "inbound", "note"]),
  ownerUserId: z.string().uuid().nullable().optional(),
  conversationKey: z.string().nullable().optional(),
  subject: z.string().nullable().optional(),
  bodyPreview: z.string().nullable().optional(),
  occurredAt: z.string().nullable().optional(),
  idempotencyKey: z.string().nullable().optional(),
});

const manageActionArgsSchema = z.object({
  operation: z.enum(["create", "snooze", "complete", "reopen"]),
  actionId: z.string().uuid().optional(),
  goldAccountId: z.string().uuid().nullable().optional(),
  breakfastEventId: z.string().uuid().nullable().optional(),
  folkPersonLinkId: z.string().uuid().nullable().optional(),
  ownerUserId: z.string().uuid().optional(),
  title: z.string().optional(),
  notes: z.string().nullable().optional(),
  dueDate: z.string().optional(),
  reason: z.string().optional(),
});

export function createDefaultMcpHandlers(agent: AgentIdentityRecord): McpToolHandlers {
  return {
    async list_breakfasts(args) {
      if (!isDatabaseConfigured()) throw new Error("Database is not configured");
      const db = getDb();
      const summary = await listBreakfastsSummary(db);
      const localeFilter =
        typeof args.locale === "string" ? args.locale.trim().toLowerCase() : null;
      const events = localeFilter
        ? summary.events.filter((e) => e.locale.toLowerCase() === localeFilter)
        : summary.events;
      return { events };
    },

    async get_breakfast_preread_context(args) {
      if (!isDatabaseConfigured()) throw new Error("Database is not configured");
      const eventId = z.string().uuid().parse(args.eventId);
      const db = getDb();
      return buildBreakfastPrereadContext(db, eventId);
    },

    async list_gold_accounts(args) {
      if (!isDatabaseConfigured()) throw new Error("Database is not configured");
      const db = getDb();
      const summary = await listGoldAccountsSummary(db);
      const ownerEmail =
        typeof args.ownerEmail === "string" ? args.ownerEmail.trim().toLowerCase() : null;
      if (!ownerEmail) return summary;
      const matchingFounder = summary.founders.find(
        (f) => f.email.toLowerCase() === ownerEmail,
      );
      return {
        ...summary,
        accounts: matchingFounder
          ? summary.accounts.filter((a) => a.ownerUserId === matchingFounder.id)
          : [],
      };
    },

    async get_gold_account_context(args) {
      if (!isDatabaseConfigured()) throw new Error("Database is not configured");
      const goldAccountId = z.string().uuid().parse(args.goldAccountId);
      const db = getDb();
      return loadGoldAccountWorkspace(db, goldAccountId);
    },

    async submit_research_proposal(args) {
      if (!isDatabaseConfigured()) throw new Error("Database is not configured");
      const input = proposalArgsSchema.parse(args);
      const service = new ProposalGovernanceService(createDrizzleProposalStore());
      const proposal = await service.createProposal({
        targetSystem: input.targetSystem,
        entityType: input.entityType,
        entityId: input.entityId,
        folkRecordId: input.folkRecordId ?? null,
        proposedByAgentId: agent.id,
        summary: input.summary,
        proposedChangesJson: input.proposedChangesJson,
        baseSnapshotJson: input.baseSnapshotJson,
        sourceUrl: input.sourceUrl ?? null,
        sourceNote: input.sourceNote ?? null,
        factType: input.factType ?? "verified",
        evidenceDate: input.evidenceDate ? new Date(input.evidenceDate) : null,
        idempotencyKey: input.idempotencyKey ?? null,
      });
      await recordAuditEvent({
        actorType: "agent",
        actorAgentId: agent.id,
        action: "mcp_proposal_submitted",
        entityType: "change_proposal",
        entityId: proposal.id,
        newValue: proposal.proposedChangesJson,
        outcome: "succeeded",
      });
      return { proposal };
    },

    async get_proposal_status(args) {
      if (!isDatabaseConfigured()) throw new Error("Database is not configured");
      const proposalId = z.string().uuid().parse(args.proposalId);
      const proposal = await createDrizzleProposalStore().getById(proposalId);
      if (!proposal) throw new Error(`Proposal ${proposalId} not found`);
      return { proposal };
    },

    async submit_message_draft(args) {
      if (!isDatabaseConfigured()) throw new Error("Database is not configured");
      const input = draftArgsSchema.parse(args);
      const service = new MessageGovernanceService(createDrizzleMessageStore());
      const message = await service.createDraft({
        goldAccountId: input.goldAccountId ?? null,
        breakfastEventId: input.breakfastEventId ?? null,
        folkPersonLinkId: input.folkPersonLinkId ?? null,
        senderUserId: input.senderUserId,
        recipientName: input.recipientName,
        recipientAddress: input.recipientAddress,
        channel: input.channel,
        subject: input.subject ?? null,
        body: input.body,
        proposedByAgentId: agent.id,
        initialStatus: "awaiting_approval",
      });
      await recordAuditEvent({
        actorType: "agent",
        actorAgentId: agent.id,
        action: "mcp_message_draft_created",
        entityType: "message_approval",
        entityId: message.id,
        outcome: "succeeded",
      });
      const { approvalTokenHash: _omitted, ...safe } = message;
      void _omitted;
      return { message: safe };
    },

    async get_message_approval_status(args) {
      if (!isDatabaseConfigured()) throw new Error("Database is not configured");
      const messageId = z.string().uuid().parse(args.messageId);
      const message = await createDrizzleMessageStore().getById(messageId);
      if (!message) throw new Error(`Message ${messageId} not found`);
      const { approvalTokenHash: _omitted, ...safe } = message;
      void _omitted;
      return { message: safe };
    },

    async report_message_execution(args) {
      if (!isDatabaseConfigured()) throw new Error("Database is not configured");
      const input = reportExecArgsSchema.parse(args);
      const store = createDrizzleMessageStore();
      const service = new MessageGovernanceService(store);
      const result = await service.recordExecutionOutcome({
        messageId: input.messageId,
        approvalToken: input.approvalToken,
        executionIdempotencyKey: input.executionIdempotencyKey,
        outcome: input.outcome,
        executionNote: input.executionNote ?? null,
      });

      let linkedActivityId: string | null = result.message.linkedActivityId;
      if (!result.replayed && input.outcome === "sent" && input.logActivity) {
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
            actorAgentId: agent.id,
            subject: result.message.subject,
            bodyPreview: result.message.body.slice(0, 500),
            sourceSystem: "agent",
            idempotencyKey: `msg_exec:${input.executionIdempotencyKey}`,
            executionStatus: "sent",
            visibilityRestricted: false,
            occurredAt: result.message.executedAt ?? new Date(),
          })
          .onConflictDoNothing({ target: schema.outreachActivities.idempotencyKey })
          .returning({ id: schema.outreachActivities.id });

        if (activity) {
          linkedActivityId = activity.id;
          await store.update(result.message.id, { linkedActivityId });
        }
      }

      const { approvalTokenHash: _omitted, ...safe } = result.message;
      void _omitted;
      return { message: { ...safe, linkedActivityId }, replayed: result.replayed };
    },

    async log_outreach_activity(args) {
      if (!isDatabaseConfigured()) throw new Error("Database is not configured");
      const input = logActivityArgsSchema.parse(args);
      const db = getDb();

      if (input.idempotencyKey) {
        const [existing] = await db
          .select()
          .from(schema.outreachActivities)
          .where(eq(schema.outreachActivities.idempotencyKey, input.idempotencyKey))
          .limit(1);
        if (existing) return { activity: existing, replayed: true };
      }

      const [created] = await db
        .insert(schema.outreachActivities)
        .values({
          goldAccountId: input.goldAccountId ?? null,
          breakfastEventId: input.breakfastEventId ?? null,
          folkPersonLinkId: input.folkPersonLinkId ?? null,
          channel: input.channel,
          direction: input.direction,
          ownerUserId: input.ownerUserId ?? null,
          actorAgentId: agent.id,
          conversationKey: input.conversationKey ?? null,
          subject: input.subject ?? null,
          bodyPreview: input.bodyPreview ?? null,
          sourceSystem: "agent",
          idempotencyKey: input.idempotencyKey ?? null,
          executionStatus: "logged",
          visibilityRestricted: false,
          occurredAt: input.occurredAt ? new Date(input.occurredAt) : new Date(),
        })
        .returning();

      const flaggedActionIds: string[] = [];
      if (input.direction === "inbound" && input.goldAccountId) {
        const openActions = await db
          .select()
          .from(schema.followUpActions)
          .where(
            and(
              eq(schema.followUpActions.goldAccountId, input.goldAccountId),
              eq(schema.followUpActions.status, "open"),
            ),
          );
        const actIds = openActions
          .map((a) => a.activityId)
          .filter(Boolean) as string[];
        const linkedActs =
          actIds.length > 0
            ? await db
                .select({
                  id: schema.outreachActivities.id,
                  conversationKey: schema.outreachActivities.conversationKey,
                })
                .from(schema.outreachActivities)
                .where(inArray(schema.outreachActivities.id, actIds))
            : [];
        const convMap = new Map(linkedActs.map((a) => [a.id, a.conversationKey]));
        const evaluated = flagActionsForInboundReply(
          openActions.map((a) => ({
            ...a,
            conversationKey: a.activityId ? convMap.get(a.activityId) ?? null : null,
          })),
          {
            id: created.id,
            folkPersonLinkId: created.folkPersonLinkId,
            goldAccountId: created.goldAccountId,
            conversationKey: created.conversationKey,
          },
        );
        for (const next of evaluated) {
          if (next.status === "needs_review") {
            await db
              .update(schema.followUpActions)
              .set({
                status: "needs_review",
                flaggedByReplyActivityId: created.id,
                updatedAt: new Date(),
              })
              .where(eq(schema.followUpActions.id, next.id));
            flaggedActionIds.push(next.id);
          }
        }
      }

      return { activity: created, flaggedActionIds };
    },

    async manage_follow_up_action(args) {
      if (!isDatabaseConfigured()) throw new Error("Database is not configured");
      const input = manageActionArgsSchema.parse(args);
      const db = getDb();

      if (input.operation === "create") {
        if (!input.ownerUserId || !input.title || !input.dueDate) {
          throw new Error("create requires ownerUserId, title, and dueDate");
        }
        const [created] = await db
          .insert(schema.followUpActions)
          .values({
            goldAccountId: input.goldAccountId ?? null,
            breakfastEventId: input.breakfastEventId ?? null,
            folkPersonLinkId: input.folkPersonLinkId ?? null,
            ownerUserId: input.ownerUserId,
            title: input.title,
            notes: input.notes ?? null,
            dueDate: new Date(input.dueDate),
            status: "open",
            snoozeHistoryJson: [],
          })
          .returning();
        return { action: created };
      }

      if (!input.actionId) {
        throw new Error(`operation '${input.operation}' requires actionId`);
      }

      const [existing] = await db
        .select()
        .from(schema.followUpActions)
        .where(eq(schema.followUpActions.id, input.actionId))
        .limit(1);
      if (!existing) throw new Error(`Action ${input.actionId} not found`);

      if (input.operation === "complete") {
        const [updated] = await db
          .update(schema.followUpActions)
          .set({ status: "completed", completedAt: new Date(), updatedAt: new Date() })
          .where(eq(schema.followUpActions.id, existing.id))
          .returning();
        return { action: updated };
      }

      if (input.operation === "reopen") {
        const [updated] = await db
          .update(schema.followUpActions)
          .set({ status: "open", completedAt: null, updatedAt: new Date() })
          .where(eq(schema.followUpActions.id, existing.id))
          .returning();
        return { action: updated };
      }

      if (!input.dueDate) {
        throw new Error("snooze requires dueDate");
      }
      const snoozed = snoozeFollowUpAction(
        { ...existing, snoozeHistoryJson: existing.snoozeHistoryJson ?? [] },
        new Date(input.dueDate),
        { reason: input.reason },
      );
      const [updated] = await db
        .update(schema.followUpActions)
        .set({
          dueDate: snoozed.dueDate,
          snoozeHistoryJson: snoozed.snoozeHistoryJson,
          updatedAt: new Date(),
        })
        .where(eq(schema.followUpActions.id, existing.id))
        .returning();
      return { action: updated };
    },
  };
}

interface JsonRpcRequest {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
}

export async function handleMcpJsonRpc(
  rawBody: unknown,
  context: {
    agent: AgentIdentityRecord;
    handlers?: Partial<McpToolHandlers>;
    recordAudit?: typeof recordAuditEvent;
  },
): Promise<{ status: number; body: Record<string, unknown> | null }> {
  const req = (rawBody && typeof rawBody === "object" ? rawBody : {}) as JsonRpcRequest;
  const id = req.id !== undefined ? req.id : null;
  const auditFn = context.recordAudit ?? recordAuditEvent;

  if (req.jsonrpc !== "2.0" || typeof req.method !== "string") {
    return {
      status: 400,
      body: {
        jsonrpc: "2.0",
        id,
        error: { code: -32600, message: "Invalid JSON-RPC 2.0 request" },
      },
    };
  }

  if (req.method === "initialize") {
    return {
      status: 200,
      body: {
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: "2024-11-05",
          capabilities: { tools: {} },
          serverInfo: {
            name: "committed-citizens-opportunity-tracker",
            version: "1.0.0",
          },
        },
      },
    };
  }

  if (req.method === "notifications/initialized") {
    return { status: 202, body: null };
  }

  if (req.method === "ping") {
    return {
      status: 200,
      body: { jsonrpc: "2.0", id, result: {} },
    };
  }

  if (req.method === "tools/list") {
    const allowedTools = MCP_TOOLS.filter((tool) =>
      verifyAgentPermissions(context.agent, tool.requiredScope).allowed,
    ).map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
    }));

    return {
      status: 200,
      body: {
        jsonrpc: "2.0",
        id,
        result: { tools: allowedTools },
      },
    };
  }

  if (req.method === "tools/call") {
    const params = req.params ?? {};
    const toolName = typeof params.name === "string" ? params.name : "";
    const args =
      params.arguments && typeof params.arguments === "object"
        ? (params.arguments as Record<string, unknown>)
        : {};

    const toolDef = MCP_TOOLS.find((t) => t.name === toolName);
    if (!toolDef) {
      return {
        status: 200,
        body: {
          jsonrpc: "2.0",
          id,
          error: { code: -32602, message: `Unknown MCP tool: ${toolName}` },
        },
      };
    }

    const perm = verifyAgentPermissions(context.agent, toolDef.requiredScope);
    if (!perm.allowed) {
      await auditFn({
        actorType: "agent",
        actorAgentId: context.agent.id,
        action: "mcp_tool_denied",
        entityType: "mcp_tool",
        entityId: toolName,
        outcome: "denied",
        metadata: { requiredScope: toolDef.requiredScope, reason: perm.reason },
      });
      return {
        status: 200,
        body: {
          jsonrpc: "2.0",
          id,
          error: {
            code: -32003,
            message: perm.reason,
          },
        },
      };
    }

    const defaultHandlers = createDefaultMcpHandlers(context.agent);
    const handler = context.handlers?.[toolName] ?? defaultHandlers[toolName];
    if (!handler) {
      return {
        status: 200,
        body: {
          jsonrpc: "2.0",
          id,
          error: { code: -32601, message: `Handler missing for ${toolName}` },
        },
      };
    }

    try {
      const result = await handler(args);
      await auditFn({
        actorType: "agent",
        actorAgentId: context.agent.id,
        action: "mcp_tool_called",
        entityType: "mcp_tool",
        entityId: toolName,
        outcome: "succeeded",
      });
      return {
        status: 200,
        body: {
          jsonrpc: "2.0",
          id,
          result: {
            content: [
              {
                type: "text",
                text: JSON.stringify(result, null, 2),
              },
            ],
          },
        },
      };
    } catch (err) {
      await auditFn({
        actorType: "agent",
        actorAgentId: context.agent.id,
        action: "mcp_tool_failed",
        entityType: "mcp_tool",
        entityId: toolName,
        outcome: "failed",
        metadata: {
          message: err instanceof Error ? err.message : "Tool execution failed",
        },
      });
      return {
        status: 200,
        body: {
          jsonrpc: "2.0",
          id,
          result: {
            isError: true,
            content: [
              {
                type: "text",
                text: err instanceof Error ? err.message : "MCP tool execution failed",
              },
            ],
          },
        },
      };
    }
  }

  return {
    status: 200,
    body: {
      jsonrpc: "2.0",
      id,
      error: { code: -32601, message: `Method not found: ${req.method}` },
    },
  };
}
