import { asc, desc } from "drizzle-orm";
import { redirect } from "next/navigation";
import { Clock3 } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { getDb, isDatabaseConfigured, schema } from "@/db";
import { getFounderAccessState } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function ActionsPage() {
  const access = await getFounderAccessState();
  if (access.status === "unauthenticated") redirect("/sign-in");
  if (access.status === "forbidden") redirect("/access-denied");
  const founder = access.status === "authenticated" ? access.founder : null;

  let actions: (typeof schema.followUpActions.$inferSelect)[] = [];
  let activities: (typeof schema.outreachActivities.$inferSelect)[] = [];
  if (isDatabaseConfigured()) {
    try {
      const db = getDb();
      [actions, activities] = await Promise.all([
        db
          .select()
          .from(schema.followUpActions)
          .orderBy(asc(schema.followUpActions.dueDate))
          .limit(50),
        db
          .select()
          .from(schema.outreachActivities)
          .orderBy(desc(schema.outreachActivities.occurredAt))
          .limit(50),
      ]);
    } catch {
      actions = [];
      activities = [];
    }
  }

  return (
    <AppShell activePath="/actions" founder={founder}>
      <div className="space-y-6">
        <div className="flex items-center gap-2">
          <Clock3 className="h-5 w-5 text-accent" />
          <h1 className="text-2xl font-semibold tracking-tight">
            Actions &amp; Outreach Timeline
          </h1>
        </div>

        <section className="rounded-xl border border-border bg-surface p-5 space-y-3">
          <h2 className="text-sm font-medium">Founder-Owned Next Actions</h2>
          {actions.length === 0 ? (
            <p className="text-sm text-muted">
              No follow-up actions recorded yet.
            </p>
          ) : (
            <ul className="space-y-2 text-sm">
              {actions.map((a) => (
                <li
                  key={a.id}
                  className="flex items-center justify-between border-b border-border/60 pb-2"
                >
                  <span>{a.title}</span>
                  <span className="text-xs font-mono text-muted">
                    {a.status} · due {a.dueDate.toISOString().slice(0, 10)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-xl border border-border bg-surface p-5 space-y-3">
          <h2 className="text-sm font-medium">Shared Activity Timeline</h2>
          {activities.length === 0 ? (
            <p className="text-sm text-muted">
              No outreach activities synced or logged yet.
            </p>
          ) : (
            <ul className="space-y-2 text-sm">
              {activities.map((act) => (
                <li
                  key={act.id}
                  className="flex items-center justify-between border-b border-border/60 pb-2"
                >
                  <span>
                    [{act.channel}] {act.subject ?? act.direction}
                  </span>
                  <span className="text-xs font-mono text-muted">
                    {act.sourceSystem} · {act.executionStatus}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </AppShell>
  );
}
