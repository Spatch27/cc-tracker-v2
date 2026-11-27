import { desc } from "drizzle-orm";
import { redirect } from "next/navigation";
import { AlertTriangle, CheckCircle2, Shield, Sparkles, Users } from "lucide-react";
import {
  AdminAgentsPanel,
  type AgentListItem,
} from "@/components/admin-agents-panel";
import {
  AdminAuditPanel,
  type SerializedAuditEvent,
} from "@/components/admin-audit-panel";
import { AppShell } from "@/components/app-shell";
import { SetupActionsPanel } from "@/components/setup-actions-panel";
import { getDb, isDatabaseConfigured, schema } from "@/db";
import { getFounderAccessState, parseAllowedEmails } from "@/lib/auth";
import { getOverviewSummary } from "@/lib/dashboard";
import { getAllowedFounderEmailsRaw, getIntegrationStatus } from "@/lib/env";

export const dynamic = "force-dynamic";

function StatusPill({ ok, label }: { ok: boolean; label: string }) {
  return (
    <div className="flex items-center justify-between rounded-lg border border-border bg-surface-elevated px-3.5 py-2.5">
      <span className="text-sm text-foreground">{label}</span>
      <span
        className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${
          ok
            ? "bg-success/15 text-success border border-success/30"
            : "bg-warning/15 text-warning border border-warning/30"
        }`}
      >
        {ok ? (
          <>
            <CheckCircle2 className="h-3.5 w-3.5" /> Configured
          </>
        ) : (
          <>
            <AlertTriangle className="h-3.5 w-3.5" /> Pending
          </>
        )}
      </span>
    </div>
  );
}

export default async function AdminPage() {
  const access = await getFounderAccessState();
  if (access.status === "unauthenticated") redirect("/sign-in");
  if (access.status === "forbidden") redirect("/access-denied");
  const founder = access.status === "authenticated" ? access.founder : null;
  const envStatus = getIntegrationStatus();
  const allowlistedEmails = parseAllowedEmails(getAllowedFounderEmailsRaw());

  let agents: AgentListItem[] = [];
  let auditEvents: SerializedAuditEvent[] = [];
  let userByEmail = new Map<
    string,
    { id: string; name: string | null; clerkUserId: string | null; role: string; isActive: boolean }
  >();
  let dbReady = false;
  const overview = await getOverviewSummary();

  if (isDatabaseConfigured()) {
    try {
      const db = getDb();
      const [agentRows, auditRows, userRows] = await Promise.all([
        db
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
          .orderBy(desc(schema.agentIdentities.createdAt)),
        db
          .select()
          .from(schema.auditEvents)
          .orderBy(desc(schema.auditEvents.createdAt))
          .limit(50),
        db
          .select({
            id: schema.users.id,
            email: schema.users.email,
            name: schema.users.name,
            clerkUserId: schema.users.clerkUserId,
            role: schema.users.role,
            isActive: schema.users.isActive,
          })
          .from(schema.users),
      ]);

      const userMap = new Map(userRows.map((u) => [u.id, u.name ?? u.email]));
      const agentMap = new Map(agentRows.map((a) => [a.id, a.name]));
      userByEmail = new Map(
        userRows.map((u) => [u.email.trim().toLowerCase(), u]),
      );

      agents = agentRows.map((r) => ({
        ...r,
        revokedAt: r.revokedAt ? r.revokedAt.toISOString() : null,
        lastUsedAt: r.lastUsedAt ? r.lastUsedAt.toISOString() : null,
        createdAt: r.createdAt.toISOString(),
      }));

      auditEvents = auditRows.map((ev) => ({
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
              Permitted Google accounts, scoped revocable agent tokens,
              integration health, and full activity audit history.
            </p>
          </div>
        </div>

        {/* Permitted Google Accounts */}
        <section className="rounded-xl border border-border bg-surface p-5 space-y-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div>
              <h2 className="text-sm font-semibold flex items-center gap-2">
                <Users className="h-4 w-4 text-accent" />
                Permitted Founder Google Accounts
              </h2>
              <p className="text-xs text-muted mt-0.5">
                Access fails closed against{" "}
                <code className="font-mono text-foreground">
                  ALLOWED_FOUNDER_EMAILS
                </code>{" "}
                in Vercel environment variables. Every other Google account
                receives Access Denied.
              </p>
            </div>
            <span className="rounded-full border border-border bg-surface-elevated px-2.5 py-0.5 text-xs text-muted">
              {allowlistedEmails.length} allowlisted
            </span>
          </div>

          {allowlistedEmails.length === 0 ? (
            <p className="text-xs text-warning">
              ALLOWED_FOUNDER_EMAILS is empty — workspace access is blocked
              until configured.
            </p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              {allowlistedEmails.map((email) => {
                const u = userByEmail.get(email);
                return (
                  <div
                    key={email}
                    className="rounded-lg border border-border bg-surface-elevated p-3 flex items-center justify-between gap-2"
                  >
                    <div>
                      <p className="font-semibold text-foreground">
                        {u?.name ?? email}
                      </p>
                      <p className="text-muted font-mono text-[11px]">
                        {email}
                      </p>
                    </div>
                    <span
                      className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${
                        u?.clerkUserId
                          ? "border-success/30 bg-success/10 text-success"
                          : "border-border bg-surface text-muted"
                      }`}
                    >
                      {u?.clerkUserId
                        ? `Signed in (${u.role})`
                        : "Pre-provisioned"}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* Integration Health & DB / Folk Setup */}
        <div className="rounded-xl border border-border bg-surface p-5 space-y-4">
          <h2 className="text-sm font-semibold">
            Integration Health &amp; Diagnostics
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <StatusPill
              ok={envStatus.databaseConfigured && dbReady}
              label="Neon PostgreSQL & Drizzle Schema"
            />
            <StatusPill
              ok={envStatus.clerkConfigured}
              label="Clerk Google Sign-In"
            />
            <StatusPill
              ok={envStatus.allowlistConfigured}
              label={`Founder Allowlist (${envStatus.allowlistCount} email${envStatus.allowlistCount === 1 ? "" : "s"})`}
            />
            <StatusPill
              ok={envStatus.folkConfigured}
              label="Folk CRM API Connection"
            />
          </div>

          <SetupActionsPanel
            dbReady={dbReady}
            databaseConfigured={envStatus.databaseConfigured}
            folkConfigured={envStatus.folkConfigured}
          />

          <div className="rounded-lg border border-border bg-surface-elevated p-3.5 text-xs text-muted space-y-1">
            <div className="flex items-center gap-1.5 text-foreground font-medium">
              <Sparkles className="h-3.5 w-3.5 text-accent" />
              <span>Last Folk Sync</span>
            </div>
            {overview.lastSyncRun ? (
              <p>
                {overview.lastSyncRun.source} ({overview.lastSyncRun.scope}) —{" "}
                <strong className="text-foreground">
                  {overview.lastSyncRun.status}
                </strong>
                , {overview.lastSyncRun.recordsRead} record(s) read.
                {overview.lastSyncRun.visibilityGapNote
                  ? ` Visibility note: ${overview.lastSyncRun.visibilityGapNote}`
                  : ""}
              </p>
            ) : (
              <p>No Folk sync run recorded yet.</p>
            )}
          </div>
        </div>

        <AdminAgentsPanel initialAgents={agents} dbReady={dbReady} />

        <AdminAuditPanel initialEvents={auditEvents} dbReady={dbReady} />
      </div>
    </AppShell>
  );
}
