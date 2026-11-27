import Link from "next/link";
import { redirect } from "next/navigation";
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  Crown,
  Database,
  MailCheck,
  ShieldAlert,
  Sparkles,
} from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { getFounderAccessState } from "@/lib/auth";
import { getOverviewSummary } from "@/lib/dashboard";
import { getIntegrationStatus } from "@/lib/env";

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

export default async function OverviewPage() {
  const access = await getFounderAccessState();
  if (access.status === "unauthenticated") {
    redirect("/sign-in");
  }
  if (access.status === "forbidden") {
    redirect("/access-denied");
  }

  const founder = access.status === "authenticated" ? access.founder : null;
  const envStatus = getIntegrationStatus();
  const summary = await getOverviewSummary();

  return (
    <AppShell activePath="/" founder={founder}>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Overview</h1>
          <p className="text-sm text-muted mt-1">
            Pending approvals, Folk conflicts, upcoming breakfasts, and
            founder-owned next actions.
          </p>
        </div>

        <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <Link
            href="/reviews"
            className="rounded-xl border border-border bg-surface p-4 hover:border-accent/50 transition-colors"
          >
            <div className="flex items-center justify-between text-xs text-muted">
              <span>Research &amp; Conflicts</span>
              <ShieldAlert className="h-4 w-4 text-accent" />
            </div>
            <p className="mt-2 text-2xl font-semibold">
              {summary.pendingProposalsCount + summary.conflictProposalsCount}
            </p>
            <p className="mt-1 text-xs text-muted">
              {summary.pendingProposalsCount} pending ·{" "}
              {summary.conflictProposalsCount} conflicts
            </p>
          </Link>

          <Link
            href="/approvals"
            className="rounded-xl border border-border bg-surface p-4 hover:border-accent/50 transition-colors"
          >
            <div className="flex items-center justify-between text-xs text-muted">
              <span>Message Approvals</span>
              <MailCheck className="h-4 w-4 text-accent" />
            </div>
            <p className="mt-2 text-2xl font-semibold">
              {summary.awaitingApprovalMessagesCount}
            </p>
            <p className="mt-1 text-xs text-muted">
              Awaiting founder sign-off before send
            </p>
          </Link>

          <Link
            href="/actions"
            className="rounded-xl border border-border bg-surface p-4 hover:border-accent/50 transition-colors"
          >
            <div className="flex items-center justify-between text-xs text-muted">
              <span>Next Actions</span>
              <Clock3 className="h-4 w-4 text-accent" />
            </div>
            <p className="mt-2 text-2xl font-semibold">
              {summary.dueTodayOrOpenActionsCount}
            </p>
            <p className="mt-1 text-xs text-muted">
              {summary.overdueActionsCount} overdue across both founders
            </p>
          </Link>

          <Link
            href="/gold-lists"
            className="rounded-xl border border-border bg-surface p-4 hover:border-accent/50 transition-colors"
          >
            <div className="flex items-center justify-between text-xs text-muted">
              <span>Active Scope</span>
              <Crown className="h-4 w-4 text-accent" />
            </div>
            <p className="mt-2 text-2xl font-semibold">
              {summary.activeGoldAccountsCount} / 100
            </p>
            <p className="mt-1 text-xs text-muted">
              Gold accounts · {summary.upcomingBreakfastsCount} active
              breakfasts
            </p>
          </Link>
        </section>

        <section className="rounded-xl border border-border bg-surface p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Database className="h-4 w-4 text-accent" />
              <h2 className="text-base font-medium">
                Phase 0 &amp; Phase 1 Integration Readiness
              </h2>
            </div>
            <Link
              href="/admin"
              className="text-xs text-accent hover:underline font-medium"
            >
              Manage agent access &amp; keys →
            </Link>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <StatusPill
              ok={envStatus.databaseConfigured && summary.dbReady}
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

          {summary.dbError && (
            <div className="rounded-lg border border-warning/30 bg-warning/10 p-3 text-xs text-warning">
              Database connected status: {summary.dbError}. Run{" "}
              <code className="font-mono">npm run db:push</code> after setting{" "}
              <code className="font-mono">DATABASE_URL</code> in{" "}
              <code className="font-mono">.env.local</code>.
            </div>
          )}

          <div className="rounded-lg border border-border bg-surface-elevated p-4 text-xs text-muted space-y-1.5">
            <div className="flex items-center gap-1.5 text-foreground font-medium">
              <Sparkles className="h-3.5 w-3.5 text-accent" />
              <span>Last Folk Sync</span>
            </div>
            {summary.lastSyncRun ? (
              <p>
                {summary.lastSyncRun.source} ({summary.lastSyncRun.scope}) —{" "}
                <strong className="text-foreground">
                  {summary.lastSyncRun.status}
                </strong>
                , {summary.lastSyncRun.recordsRead} record(s) read.
                {summary.lastSyncRun.visibilityGapNote
                  ? ` Visibility note: ${summary.lastSyncRun.visibilityGapNote}`
                  : ""}
              </p>
            ) : (
              <p>
                No Folk sync run recorded yet. Run{" "}
                <code className="font-mono text-foreground">
                  npm run folk:probe
                </code>{" "}
                first to verify read-only access and email visibility across
                both founders.
              </p>
            )}
          </div>
        </section>
      </div>
    </AppShell>
  );
}
