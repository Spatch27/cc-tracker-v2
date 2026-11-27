import { desc } from "drizzle-orm";
import { redirect } from "next/navigation";
import { ClipboardCheck } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { getDb, isDatabaseConfigured, schema } from "@/db";
import { getFounderAccessState } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function ReviewsPage() {
  const access = await getFounderAccessState();
  if (access.status === "unauthenticated") redirect("/sign-in");
  if (access.status === "forbidden") redirect("/access-denied");
  const founder = access.status === "authenticated" ? access.founder : null;

  let proposals: (typeof schema.changeProposals.$inferSelect)[] = [];
  if (isDatabaseConfigured()) {
    try {
      const db = getDb();
      proposals = await db
        .select()
        .from(schema.changeProposals)
        .orderBy(desc(schema.changeProposals.createdAt))
        .limit(50);
    } catch {
      proposals = [];
    }
  }

  return (
    <AppShell activePath="/reviews" founder={founder}>
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <ClipboardCheck className="h-5 w-5 text-accent" />
          <h1 className="text-2xl font-semibold tracking-tight">
            Review Queue &amp; Folk Conflicts
          </h1>
        </div>

        {proposals.length === 0 ? (
          <div className="rounded-xl border border-border bg-surface p-6 text-sm text-muted">
            No pending research proposals or Folk conflicts right now. Research
            submitted via <code className="font-mono text-foreground">/api/proposals</code>{" "}
            always enters <code className="font-mono text-foreground">pending_review</code>{" "}
            before any Folk write can occur.
          </div>
        ) : (
          <div className="space-y-3">
            {proposals.map((p) => (
              <div
                key={p.id}
                className="rounded-xl border border-border bg-surface p-4 space-y-2"
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-foreground">
                    {p.summary}
                  </span>
                  <span className="rounded-full border border-border bg-surface-elevated px-2.5 py-0.5 text-xs font-mono">
                    {p.status}
                  </span>
                </div>
                <p className="text-xs text-muted">
                  Target: {p.targetSystem} · {p.entityType} ({p.entityId}) ·
                  Evidence: {p.factType}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}
