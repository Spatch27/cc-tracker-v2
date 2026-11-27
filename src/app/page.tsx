import Link from "next/link";
import { redirect } from "next/navigation";
import {
  AlertTriangle,
  CalendarDays,
  Clock3,
  Crown,
  MailCheck,
  ShieldAlert,
  Sparkles,
} from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { getFounderAccessState } from "@/lib/auth";
import { formatLocaleLabel } from "@/lib/breakfasts/rules";
import { getOverviewCockpitData, getOverviewSummary } from "@/lib/dashboard";
import { getIntegrationStatus } from "@/lib/env";

export const dynamic = "force-dynamic";

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
  const [summary, cockpit] = await Promise.all([
    getOverviewSummary(),
    getOverviewCockpitData(),
  ]);

  const now = new Date();
  const integrationAttentionNeeded =
    !summary.dbReady ||
    !envStatus.databaseConfigured ||
    !envStatus.folkConfigured ||
    !envStatus.clerkConfigured ||
    !envStatus.allowlistConfigured;

  return (
    <AppShell activePath="/" founder={founder}>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Overview</h1>
            <p className="text-sm text-muted mt-1">
              Upcoming breakfasts, due actions, pending reviews, and message
              approvals across both founders.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              href="/breakfasts"
              className="rounded-lg border border-border bg-surface-elevated px-3 py-1.5 text-xs font-medium hover:border-accent/50"
            >
              CMO Breakfasts
            </Link>
            <Link
              href="/gold-lists"
              className="rounded-lg border border-border bg-surface-elevated px-3 py-1.5 text-xs font-medium hover:border-accent/50"
            >
              Gold Lists
            </Link>
          </div>
        </div>

        {integrationAttentionNeeded && (
          <div className="rounded-xl border border-warning/40 bg-warning/10 p-4 text-xs text-warning flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              <span>
                {summary.dbError
                  ? `Database setup needed: ${summary.dbError}`
                  : "One or more core integrations need attention (Database, Clerk, Allowlist, or Folk CRM)."}
              </span>
            </div>
            <Link href="/admin" className="underline font-semibold">
              Open Administration &amp; Setup →
            </Link>
          </div>
        )}

        {/* Top 4 KPI summary cards */}
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
            <p
              className={`mt-1 text-xs ${
                summary.overdueActionsCount > 0 ? "text-warning" : "text-muted"
              }`}
            >
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

        {/* Daily Founder Cockpit */}
        <section className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Left: Upcoming Breakfasts + Pending Reviews/Approvals */}
          <div className="space-y-6">
            <div className="rounded-xl border border-border bg-surface p-5 space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold flex items-center gap-2">
                  <CalendarDays className="h-4 w-4 text-accent" />
                  Upcoming CMO Breakfasts
                </h2>
                <Link
                  href="/breakfasts"
                  className="text-xs text-accent hover:underline font-medium"
                >
                  View all →
                </Link>
              </div>

              {cockpit.upcomingBreakfasts.length === 0 ? (
                <p className="text-xs text-muted">
                  No active upcoming breakfasts scheduled.
                </p>
              ) : (
                <ul className="space-y-2.5">
                  {cockpit.upcomingBreakfasts.map((ev) => (
                    <li key={ev.id}>
                      <Link
                        href={`/breakfasts/${ev.id}`}
                        className="rounded-lg border border-border bg-surface-elevated p-3 flex items-center justify-between gap-3 hover:border-accent/50 transition-colors"
                      >
                        <div className="min-w-0">
                          <p className="text-xs font-semibold text-foreground truncate">
                            {ev.title}
                          </p>
                          <p className="text-[11px] text-muted truncate">
                            {formatLocaleLabel(ev.locale)} ·{" "}
                            {new Date(ev.eventDate).toLocaleDateString(
                              "en-GB",
                              {
                                weekday: "short",
                                day: "numeric",
                                month: "short",
                              },
                            )}
                            {ev.venueName ? ` · ${ev.venueName}` : ""}
                          </p>
                        </div>
                        <div className="text-right shrink-0">
                          <p className="text-xs font-semibold text-foreground tabular-nums">
                            {ev.confirmedGuestCount} / {ev.guestCapacity} seats
                          </p>
                          <p className="text-[11px] text-muted">
                            {ev.inviteeCount} on invite list
                          </p>
                        </div>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="rounded-xl border border-border bg-surface p-5 space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold flex items-center gap-2">
                  <ShieldAlert className="h-4 w-4 text-accent" />
                  Pending Reviews &amp; Message Approvals
                </h2>
                <div className="flex items-center gap-3 text-xs">
                  <Link href="/reviews" className="text-accent hover:underline">
                    Reviews →
                  </Link>
                  <Link href="/approvals" className="text-accent hover:underline">
                    Approvals →
                  </Link>
                </div>
              </div>

              {cockpit.pendingReviews.length === 0 &&
              cockpit.pendingMessages.length === 0 ? (
                <p className="text-xs text-muted">
                  All agent proposals, Folk conflicts, and outbound drafts are
                  cleared.
                </p>
              ) : (
                <div className="space-y-2 text-xs">
                  {cockpit.pendingMessages.map((msg) => (
                    <Link
                      key={msg.id}
                      href="/approvals"
                      className="rounded-lg border border-border bg-surface-elevated px-3 py-2 flex items-center justify-between gap-2 hover:border-accent/50"
                    >
                      <span className="truncate text-foreground">
                        <strong className="font-mono text-accent">
                          [Draft · {msg.channel}]
                        </strong>{" "}
                        {msg.recipientName}
                        {msg.subject ? ` — ${msg.subject}` : ""}
                      </span>
                      <span className="text-[11px] text-muted shrink-0">
                        Approve
                      </span>
                    </Link>
                  ))}
                  {cockpit.pendingReviews.map((prop) => (
                    <Link
                      key={prop.id}
                      href="/reviews"
                      className="rounded-lg border border-border bg-surface-elevated px-3 py-2 flex items-center justify-between gap-2 hover:border-accent/50"
                    >
                      <span className="truncate text-foreground">
                        <strong
                          className={`font-mono ${
                            prop.status === "conflict"
                              ? "text-warning"
                              : "text-accent"
                          }`}
                        >
                          [{prop.status === "conflict" ? "Conflict" : "Review"}]
                        </strong>{" "}
                        {prop.summary}
                      </span>
                      <span className="text-[11px] text-muted shrink-0">
                        {prop.targetSystem}
                      </span>
                    </Link>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Right: Due / Overdue / Needs-Review Actions + Folk Sync Summary */}
          <div className="space-y-6">
            <div className="rounded-xl border border-border bg-surface p-5 space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold flex items-center gap-2">
                  <Clock3 className="h-4 w-4 text-accent" />
                  Priority Next Actions
                </h2>
                <Link
                  href="/actions"
                  className="text-xs text-accent hover:underline font-medium"
                >
                  Open full queue →
                </Link>
              </div>

              {cockpit.priorityActions.length === 0 ? (
                <p className="text-xs text-muted">
                  No open follow-up actions right now.
                </p>
              ) : (
                <ul className="space-y-2.5 text-xs">
                  {cockpit.priorityActions.map((act) => {
                    const isOverdue = new Date(act.dueDate) < now;
                    return (
                      <li
                        key={act.id}
                        className="rounded-lg border border-border bg-surface-elevated p-3 flex items-center justify-between gap-3"
                      >
                        <div className="min-w-0 space-y-0.5">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-semibold text-foreground truncate">
                              {act.title}
                            </span>
                            {act.status === "needs_review" && (
                              <span className="rounded bg-warning/20 text-warning px-1.5 py-0.5 text-[10px] font-medium">
                                Reply arrived
                              </span>
                            )}
                            {isOverdue && (
                              <span className="rounded bg-danger/15 text-danger px-1.5 py-0.5 text-[10px] font-medium">
                                Overdue
                              </span>
                            )}
                          </div>
                          <p className="text-[11px] text-muted truncate">
                            {act.ownerName}
                            {act.companyName ? ` · ${act.companyName}` : ""}
                            {act.personName ? ` (${act.personName})` : ""} · Due{" "}
                            {new Date(act.dueDate).toLocaleDateString("en-GB")}
                          </p>
                        </div>
                        {act.goldAccountId ? (
                          <Link
                            href={`/gold-lists/${act.goldAccountId}`}
                            className="shrink-0 text-accent hover:underline font-medium"
                          >
                            Account →
                          </Link>
                        ) : (
                          <Link
                            href="/actions"
                            className="shrink-0 text-accent hover:underline font-medium"
                          >
                            Queue →
                          </Link>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            <div className="rounded-xl border border-border bg-surface p-5 space-y-2 text-xs">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5 text-foreground font-medium">
                  <Sparkles className="h-3.5 w-3.5 text-accent" />
                  <span>Last Folk Sync</span>
                </div>
                <Link
                  href="/admin"
                  className="text-accent hover:underline font-medium"
                >
                  Admin &amp; Diagnostics →
                </Link>
              </div>
              {summary.lastSyncRun ? (
                <p className="text-muted">
                  {summary.lastSyncRun.source} ({summary.lastSyncRun.scope}) —{" "}
                  <strong className="text-foreground">
                    {summary.lastSyncRun.status}
                  </strong>
                  , {summary.lastSyncRun.recordsRead} record(s) read.
                  {summary.lastSyncRun.visibilityGapNote
                    ? ` ${summary.lastSyncRun.visibilityGapNote}`
                    : ""}
                </p>
              ) : (
                <p className="text-muted">
                  No Folk sync run recorded yet. Run the read-only Folk API
                  probe in Administration if needed.
                </p>
              )}
            </div>
          </div>
        </section>
      </div>
    </AppShell>
  );
}
