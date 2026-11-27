import {
  AgentAuthError,
  authenticateAgentHeader,
  type AgentIdentityRecord,
  type AgentScope,
} from "./agent-auth";
import { AuthError, requireFounderSession, type FounderIdentity } from "./auth";

export type RouteActor =
  | { kind: "human"; founder: FounderIdentity }
  | { kind: "agent"; agent: AgentIdentityRecord };

export async function authenticateFounderOrAgent(
  request: Request,
  requiredAgentScope: AgentScope,
): Promise<RouteActor> {
  const authHeader = request.headers.get("authorization");
  if (authHeader && authHeader.startsWith("Bearer ")) {
    const agent = await authenticateAgentHeader(authHeader, requiredAgentScope);
    return { kind: "agent", agent };
  }

  const founder = await requireFounderSession();
  return { kind: "human", founder };
}

export function errorResponse(err: unknown): Response {
  if (err instanceof AuthError || err instanceof AgentAuthError) {
    return Response.json({ error: err.message }, { status: err.status });
  }
  if (err instanceof Error) {
    return Response.json({ error: err.message }, { status: 400 });
  }
  return Response.json({ error: "Internal server error" }, { status: 500 });
}
