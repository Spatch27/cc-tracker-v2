import { desc } from "drizzle-orm";
import { redirect } from "next/navigation";
import { Shield } from "lucide-react";
import {
  AdminAgentsPanel,
  type AgentListItem,
} from "@/components/admin-agents-panel";
import { AppShell } from "@/components/app-shell";
import { getDb, isDatabaseConfigured, schema } from "@/db";
import { getFounderAccessState } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const access = await getFounderAccessState();
  if (access.status === "unauthenticated") redirect("/sign-in");
  if (access.status === "forbidden") redirect("/access-denied");
  const founder = access.status === "authenticated" ? access.founder : null;

  let agents: AgentListItem[] = [];
  let dbReady = false;

  if (isDatabaseConfigured()) {
    try {
      const db = getDb();
      const rows = await db
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

      agents = rows.map((r) => ({
        ...r,
        revokedAt: r.revokedAt ? r.revokedAt.toISOString() : null,
        lastUsedAt: r.lastUsedAt ? r.lastUsedAt.toISOString() : null,
        createdAt: r.createdAt.toISOString(),
      }));
      dbReady = true;
    } catch {
      dbReady = false;
    }
  }

  return (
    <AppShell activePath="/admin" founder={founder}>
      <div className="space-y-6">
        <div className="flex items-center gap-2">
          <Shield className="h-5 w-5 text-accent" />
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">
              Administration
            </h1>
            <p className="text-sm text-muted">
              Scoped revocable agent tokens and integration health.
            </p>
          </div>
        </div>

        <AdminAgentsPanel initialAgents={agents} dbReady={dbReady} />
      </div>
    </AppShell>
  );
}
