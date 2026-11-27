import { eq } from "drizzle-orm";
import { getDb, isDatabaseConfigured, schema } from "@/db";
import { errorResponse } from "@/lib/api-auth";
import { requireFounderSession } from "@/lib/auth";
import { recordAuditEvent } from "@/lib/governance/audit";

export const dynamic = "force-dynamic";

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const founder = await requireFounderSession();
    if (!isDatabaseConfigured()) {
      return Response.json(
        { error: "Database is not configured" },
        { status: 503 },
      );
    }

    const { id } = await context.params;
    const db = getDb();
    const [agent] = await db
      .update(schema.agentIdentities)
      .set({ revokedAt: new Date() })
      .where(eq(schema.agentIdentities.id, id))
      .returning({
        id: schema.agentIdentities.id,
        name: schema.agentIdentities.name,
        revokedAt: schema.agentIdentities.revokedAt,
      });

    if (!agent) {
      return Response.json({ error: "Agent identity not found" }, { status: 404 });
    }

    await recordAuditEvent({
      actorType: "human",
      actorUserId: founder.userId,
      action: "agent_identity_revoked",
      entityType: "agent_identity",
      entityId: agent.id,
      outcome: "succeeded",
    });

    return Response.json({ agent });
  } catch (err) {
    return errorResponse(err);
  }
}
