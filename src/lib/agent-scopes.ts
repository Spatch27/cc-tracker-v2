export const AGENT_SCOPES = [
  "read:context",
  "propose:research",
  "draft:message",
  "log:activity",
  "manage:actions",
  "report:execution",
] as const;

export type AgentScope = (typeof AGENT_SCOPES)[number];
