import { describe, expect, it } from "vitest";
import {
  AgentAuthError,
  authenticateAgentHeader,
  createAgentToken,
  hashToken,
  type AgentIdentityRecord,
  type AgentRepository,
} from "@/lib/agent-auth";
import { sanitizeForAudit } from "@/lib/governance/audit";

function makeRepo(agents: AgentIdentityRecord[]): {
  repo: AgentRepository;
  deniedLogs: Array<{ reason: string; requiredScope: string }>;
} {
  const deniedLogs: Array<{ reason: string; requiredScope: string }> = [];
  const repo: AgentRepository = {
    async findByTokenHash(tokenHash) {
      const match = agents.find((a) => hashTokenForTest(a.id) === tokenHash || a.id === tokenHash);
      return match ?? null;
    },
    async recordDeniedAttempt(details) {
      deniedLogs.push({
        reason: details.reason,
        requiredScope: details.requiredScope,
      });
    },
  };
  return { repo, deniedLogs };
}

function hashTokenForTest(id: string) {
  return id;
}

describe("agent authentication and audit sanitization", () => {
  it("accepts a valid token with the required scope", async () => {
    const { rawToken, tokenHash } = createAgentToken();
    const record: AgentIdentityRecord = {
      id: tokenHash,
      name: "Research Bot",
      scopes: ["read:context", "propose:research"],
      revokedAt: null,
    };
    const { repo, deniedLogs } = makeRepo([record]);

    const authed = await authenticateAgentHeader(
      `Bearer ${rawToken}`,
      "propose:research",
      repo,
    );
    expect(authed.name).toBe("Research Bot");
    expect(deniedLogs).toHaveLength(0);
  });

  it("denies an agent lacking the required scope", async () => {
    const { rawToken, tokenHash } = createAgentToken();
    const record: AgentIdentityRecord = {
      id: tokenHash,
      name: "Read-only Bot",
      scopes: ["read:context"],
      revokedAt: null,
    };
    const { repo, deniedLogs } = makeRepo([record]);

    await expect(
      authenticateAgentHeader(`Bearer ${rawToken}`, "draft:message", repo),
    ).rejects.toMatchObject({ status: 403, name: "AgentAuthError" });
    expect(deniedLogs).toHaveLength(1);
  });

  it("denies a revoked agent token", async () => {
    const { rawToken, tokenHash } = createAgentToken();
    const record: AgentIdentityRecord = {
      id: tokenHash,
      name: "Revoked Bot",
      scopes: ["read:context", "propose:research"],
      revokedAt: new Date("2026-01-01T00:00:00Z"),
    };
    const { repo } = makeRepo([record]);

    await expect(
      authenticateAgentHeader(`Bearer ${rawToken}`, "read:context", repo),
    ).rejects.toBeInstanceOf(AgentAuthError);
  });

  it("denies missing or unknown bearer tokens", async () => {
    const { repo } = makeRepo([]);
    await expect(
      authenticateAgentHeader(undefined, "read:context", repo),
    ).rejects.toMatchObject({ status: 401 });
    await expect(
      authenticateAgentHeader("Bearer cc_ag_invalid", "read:context", repo),
    ).rejects.toMatchObject({ status: 401 });
    expect(hashToken("abc")).not.toBe("abc");
  });

  it("redacts sensitive credential keys from audit payloads", () => {
    const cleaned = sanitizeForAudit({
      agentName: "Claude",
      apiKey: "secret-123",
      nested: {
        authorization: "Bearer xyz",
        cookie: "session=1",
        safeField: "keep-me",
      },
    });
    expect(cleaned).toEqual({
      agentName: "Claude",
      apiKey: "[REDACTED]",
      nested: {
        authorization: "[REDACTED]",
        cookie: "[REDACTED]",
        safeField: "keep-me",
      },
    });
  });
});
