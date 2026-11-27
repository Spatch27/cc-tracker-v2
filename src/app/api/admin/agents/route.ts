import { desc } from "drizzle-orm";
import { z } from "zod";
import { getDb, isDatabaseConfigured, schema } from "@/db";
import { AGENT_SCOPES, createAgentToken } from "@/lib/agent-auth";
import { errorResponse } from "@/lib/api-auth";
import { requireFounderSession } from "@/lib/auth";
import { recordAuditEvent } from "@/lib/governance/audit";

export const dynamic = "force-dynamic";

const createAgentSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(300).nullable().optional(),
  scopes: z.array(z.enum(AGENT_SCOPES)).min(1),
});

export async function GET() {
  try {
    await requireFounderSession();
    if (!isDatabaseConfigured()) {
      return Response.json({ agents: [], databaseConfigured: false });
    }
    const db = getDb();
    const agents = await db
      .select({
        id: schema.agentIdentities.id,
        name: schema.agentIdentities.name,
        description: schema.agentIdentities.description,
        tokenPrefix: schema.agentIdentities.tokenPrefix,
        scopes: schema.agentIdentities.scopes,
        revokedAt: schema.agentIdentities.revokedAt,
        lastUsedAt: schema.agentIdentities.lastUsedAt,
        createdAt: schema.agentIdentities.createdAt,
      })
      .from(schema.agentIdentities)
      .orderBy(desc(schema.agentIdentities.createdAt));

    return Response.json({ agents });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const founder = await requireFounderSession();
    if (!isDatabaseConfigured()) {
      return Response.json(
        { error: "Database is not configured" },
        { status: 503 },
      );
    }

    const body = createAgentSchema.parse(await request.json());
    const { rawToken, tokenHash, tokenPrefix } = createAgentToken();
    const db = getDb();

    const [agent] = await db
      .insert(schema.agentIdentities)
      .values({
        name: body.name.trim(),
        description: body.description?.trim() || null,
        tokenHash,
        tokenPrefix,
        scopes: body.scopes,
        createdByUserId: founder.userId,
      })
      .returning({
        id: schema.agentIdentities.id,
        name: schema.agentIdentities.name,
        description: schema.agentIdentities.description,
        tokenPrefix: schema.agentIdentities.tokenPrefix,
        scopes: schema.agentIdentities.scopes,
        revokedAt: schema.agentIdentities.revokedAt,
        lastUsedAt: schema.agentIdentities.lastUsedAt,
        createdAt: schema.agentIdentities.createdAt,
      });

    await recordAuditEvent({
      actorType: "human",
      actorUserId: founder.userId,
      action: "agent_identity_created",
      entityType: "agent_identity",
      entityId: agent.id,
      newValue: { name: agent.name, scopes: agent.scopes, tokenPrefix },
      outcome: "succeeded",
    });

    return Response.json({ agent, rawToken }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
