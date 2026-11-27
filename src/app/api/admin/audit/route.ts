import { desc, eq } from "drizzle-orm";
import { getDb, isDatabaseConfigured, schema } from "@/db";
import { errorResponse } from "@/lib/api-auth";
import { requireFounderSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    await requireFounderSession();
    if (!isDatabaseConfigured()) {
      return Response.json({ events: [], databaseConfigured: false });
    }

    const { searchParams } = new URL(request.url);
    const actorTypeParam = searchParams.get("actorType");
    const entityTypeParam = searchParams.get("entityType");
    const q = (searchParams.get("q") ?? "").trim().toLowerCase();
    const limit = Math.min(200, Math.max(10, Number(searchParams.get("limit") ?? 100)));

    const db = getDb();
    const [events, users, agents] = await Promise.all([
      actorTypeParam && ["human", "agent", "system"].includes(actorTypeParam)
        ? db
            .select()
            .from(schema.auditEvents)
            .where(
              eq(
                schema.auditEvents.actorType,
                actorTypeParam as "human" | "agent" | "system",
              ),
            )
            .orderBy(desc(schema.auditEvents.createdAt))
            .limit(limit)
        : db
            .select()
            .from(schema.auditEvents)
            .orderBy(desc(schema.auditEvents.createdAt))
            .limit(limit),
      db
        .select({
          id: schema.users.id,
          name: schema.users.name,
          email: schema.users.email,
        })
        .from(schema.users),
      db
        .select({
          id: schema.agentIdentities.id,
          name: schema.agentIdentities.name,
        })
        .from(schema.agentIdentities),
    ]);

    const userMap = new Map(users.map((u) => [u.id, u.name ?? u.email]));
    const agentMap = new Map(agents.map((a) => [a.id, a.name]));

    const serialized = events
      .filter((ev) => {
        if (entityTypeParam && ev.entityType !== entityTypeParam) return false;
        if (!q) return true;
        const actorLabel =
          (ev.actorUserId ? userMap.get(ev.actorUserId) : null) ??
          (ev.actorAgentId ? agentMap.get(ev.actorAgentId) : null) ??
          ev.actorType;
        const hay = [
          ev.action,
          ev.entityType,
          ev.entityId,
          ev.outcome,
          ev.source,
          actorLabel,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        return hay.includes(q);
      })
      .map((ev) => ({
        id: ev.id,
        actorType: ev.actorType,
        actorLabel:
          ev.actorType === "human"
            ? (ev.actorUserId ? userMap.get(ev.actorUserId) : null) ?? "Founder"
            : ev.actorType === "agent"
              ? (ev.actorAgentId ? agentMap.get(ev.actorAgentId) : null) ?? "Agent"
              : "System",
        action: ev.action,
        entityType: ev.entityType,
        entityId: ev.entityId,
        fieldName: ev.fieldName,
        previousValueJson: ev.previousValueJson,
        newValueJson: ev.newValueJson,
        source: ev.source,
        outcome: ev.outcome,
        metadataJson: ev.metadataJson,
        createdAt: ev.createdAt.toISOString(),
      }));

    return Response.json({ events: serialized, databaseConfigured: true });
  } catch (err) {
    return errorResponse(err);
  }
}
