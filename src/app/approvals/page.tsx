import { desc } from "drizzle-orm";
import { redirect } from "next/navigation";
import { MailCheck } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { getDb, isDatabaseConfigured, schema } from "@/db";
import { getFounderAccessState } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function ApprovalsPage() {
  const access = await getFounderAccessState();
  if (access.status === "unauthenticated") redirect("/sign-in");
  if (access.status === "forbidden") redirect("/access-denied");
  const founder = access.status === "authenticated" ? access.founder : null;

  let messages: (typeof schema.messageApprovals.$inferSelect)[] = [];
  if (isDatabaseConfigured()) {
    try {
      const db = getDb();
      messages = await db
        .select()
        .from(schema.messageApprovals)
        .orderBy(desc(schema.messageApprovals.createdAt))
        .limit(50);
    } catch {
      messages = [];
    }
  }

  return (
    <AppShell activePath="/approvals" founder={founder}>
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <MailCheck className="h-5 w-5 text-accent" />
          <h1 className="text-2xl font-semibold tracking-tight">
            Message Approvals
          </h1>
        </div>

        {messages.length === 0 ? (
          <div className="rounded-xl border border-border bg-surface p-6 text-sm text-muted">
            No outgoing message drafts awaiting approval. Every message approval
            binds to an exact SHA-256 content hash and never marks a message as
            sent without an external execution report.
          </div>
        ) : (
          <div className="space-y-3">
            {messages.map((m) => (
              <div
                key={m.id}
                className="rounded-xl border border-border bg-surface p-4 space-y-2"
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-foreground">
                    {m.recipientName} ({m.recipientAddress}) — {m.channel}
                  </span>
                  <span className="rounded-full border border-border bg-surface-elevated px-2.5 py-0.5 text-xs font-mono">
                    {m.status}
                  </span>
                </div>
                {m.subject && (
                  <p className="text-xs text-foreground/90">
                    Subject: {m.subject}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}
