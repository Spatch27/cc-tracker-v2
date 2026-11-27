import { createHash, randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { getDb, isDatabaseConfigured, schema } from "@/db";
import { AGENT_SCOPES, type AgentScope } from "./agent-scopes";
import { sanitizeForAudit } from "./governance/audit";

export { AGENT_SCOPES, type AgentScope };

export interface AgentIdentityRecord {
  id: string;
  name: string;
  scopes: string[];
  revokedAt: Date | null;
}

export interface AgentRepository {
  findByTokenHash(tokenHash: string): Promise<AgentIdentityRecord | null>;
  touchLastUsed?(agentId: string): Promise<void>;
  recordDeniedAttempt?(details: {
    reason: string;
    requiredScope: AgentScope;
    agentId?: string | null;
  }): Promise<void>;
}

export class AgentAuthError extends Error {
  readonly status: 401 | 403;

  constructor(message: string, status: 401 | 403) {
    super(message);
    this.name = "AgentAuthError";
    this.status = status;
  }
}

export function hashToken(rawToken: string): string {
  return createHash("sha256").update(rawToken, "utf8").digest("hex");
}

export function createAgentToken(): {
  rawToken: string;
  tokenHash: string;
  tokenPrefix: string;
} {
  const secretPart = randomBytes(32).toString("base64url");
  const rawToken = `cc_ag_${secretPart}`;
  return {
    rawToken,
    tokenHash: hashToken(rawToken),
    tokenPrefix: rawToken.slice(0, 14),
  };
}

export function verifyAgentPermissions(
  agent: AgentIdentityRecord | null,
  requiredScope: AgentScope,
): { allowed: true; agent: AgentIdentityRecord } | { allowed: false; status: 401 | 403; reason: string } {
  if (!agent) {
    return { allowed: false, status: 401, reason: "Invalid agent token" };
  }
  if (agent.revokedAt !== null) {
    return { allowed: false, status: 403, reason: "Agent identity has been revoked" };
  }
  if (!agent.scopes.includes(requiredScope)) {
    return {
      allowed: false,
      status: 403,
      reason: `Agent lacks required scope: ${requiredScope}`,
    };
  }
  return { allowed: true, agent };
}

export function createDrizzleAgentRepository(): AgentRepository {
  return {
    async findByTokenHash(tokenHash: string): Promise<AgentIdentityRecord | null> {
      if (!isDatabaseConfigured()) return null;
      const db = getDb();
      const [row] = await db
        .select({
          id: schema.agentIdentities.id,
          name: schema.agentIdentities.name,
          scopes: schema.agentIdentities.scopes,
          revokedAt: schema.agentIdentities.revokedAt,
        })
        .from(schema.agentIdentities)
        .where(eq(schema.agentIdentities.tokenHash, tokenHash))
        .limit(1);
      return row ?? null;
    },
    async touchLastUsed(agentId: string): Promise<void> {
      if (!isDatabaseConfigured()) return;
      const db = getDb();
      await db
        .update(schema.agentIdentities)
        .set({ lastUsedAt: new Date() })
        .where(eq(schema.agentIdentities.id, agentId));
    },
    async recordDeniedAttempt(details): Promise<void> {
      if (!isDatabaseConfigured()) return;
      const db = getDb();
      await db.insert(schema.auditEvents).values({
        actorType: "agent",
        actorAgentId: details.agentId ?? null,
        action: "agent_auth_denied",
        entityType: "agent_identity",
        entityId: details.agentId ?? null,
        outcome: "denied",
        metadataJson: sanitizeForAudit({
          reason: details.reason,
          requiredScope: details.requiredScope,
        }),
      });
    },
  };
}

export async function authenticateAgentHeader(
  authHeader: string | null | undefined,
  requiredScope: AgentScope,
  repo: AgentRepository = createDrizzleAgentRepository(),
): Promise<AgentIdentityRecord> {
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    await repo.recordDeniedAttempt?.({
      reason: "Missing or malformed Bearer header",
      requiredScope,
      agentId: null,
    });
    throw new AgentAuthError("Missing Bearer agent token", 401);
  }

  const rawToken = authHeader.slice("Bearer ".length).trim();
  if (!rawToken) {
    await repo.recordDeniedAttempt?.({
      reason: "Empty Bearer token",
      requiredScope,
      agentId: null,
    });
    throw new AgentAuthError("Empty Bearer agent token", 401);
  }

  const tokenHash = hashToken(rawToken);
  const agent = await repo.findByTokenHash(tokenHash);
  const verdict = verifyAgentPermissions(agent, requiredScope);

  if (!verdict.allowed) {
    await repo.recordDeniedAttempt?.({
      reason: verdict.reason,
      requiredScope,
      agentId: agent?.id ?? null,
    });
    throw new AgentAuthError(verdict.reason, verdict.status);
  }

  await repo.touchLastUsed?.(verdict.agent.id);
  return verdict.agent;
}

/**
 * Validates only that the Bearer token belongs to a non-revoked agent identity.
 * Used by transport endpoints (e.g. MCP JSON-RPC) that perform per-tool scope checks
 * via `verifyAgentPermissions`.
 */
export async function authenticateAgentTokenOnly(
  authHeader: string | null | undefined,
  repo: AgentRepository = createDrizzleAgentRepository(),
): Promise<AgentIdentityRecord> {
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    await repo.recordDeniedAttempt?.({
      reason: "Missing or malformed Bearer header",
      requiredScope: "read:context",
      agentId: null,
    });
    throw new AgentAuthError("Missing Bearer agent token", 401);
  }

  const rawToken = authHeader.slice("Bearer ".length).trim();
  if (!rawToken) {
    await repo.recordDeniedAttempt?.({
      reason: "Empty Bearer token",
      requiredScope: "read:context",
      agentId: null,
    });
    throw new AgentAuthError("Empty Bearer agent token", 401);
  }

  const tokenHash = hashToken(rawToken);
  const agent = await repo.findByTokenHash(tokenHash);
  if (!agent) {
    await repo.recordDeniedAttempt?.({
      reason: "Invalid agent token",
      requiredScope: "read:context",
      agentId: null,
    });
    throw new AgentAuthError("Invalid agent token", 401);
  }

  if (agent.revokedAt !== null) {
    await repo.recordDeniedAttempt?.({
      reason: "Agent identity has been revoked",
      requiredScope: "read:context",
      agentId: agent.id,
    });
    throw new AgentAuthError("Agent identity has been revoked", 403);
  }

  await repo.touchLastUsed?.(agent.id);
  return agent;
}
