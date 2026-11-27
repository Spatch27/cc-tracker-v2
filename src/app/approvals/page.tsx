import { desc } from "drizzle-orm";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import {
  ApprovalsClient,
  type SerializedMessageApproval,
} from "@/components/approvals/approvals-client";
import { getDb, isDatabaseConfigured, schema } from "@/db";
import { getFounderAccessState } from "@/lib/auth";
import { ensureAllowlistedFounders, type FounderOption } from "@/lib/founders";

export const dynamic = "force-dynamic";

export default async function ApprovalsPage() {
  const access = await getFounderAccessState();
  if (access.status === "unauthenticated") redirect("/sign-in");
  if (access.status === "forbidden") redirect("/access-denied");
  const founder = access.status === "authenticated" ? access.founder : null;

  let messages: SerializedMessageApproval[] = [];
  let founders: FounderOption[] = [];
  let dbReady = false;

  if (isDatabaseConfigured()) {
    try {
      const db = getDb();
      const [rows, founderRows] = await Promise.all([
        db
          .select()
          .from(schema.messageApprovals)
          .orderBy(desc(schema.messageApprovals.createdAt))
          .limit(100),
        ensureAllowlistedFounders(db),
      ]);
      dbReady = true;
      founders = founderRows;
      messages = rows.map(({ approvalTokenHash: _omitted, ...m }) => {
        void _omitted;
        return {
          ...m,
          approvedAt: m.approvedAt ? m.approvedAt.toISOString() : null,
          executedAt: m.executedAt ? m.executedAt.toISOString() : null,
          createdAt: m.createdAt.toISOString(),
          updatedAt: m.updatedAt.toISOString(),
        };
      });
    } catch {
      messages = [];
    }
  }

  return (
    <AppShell activePath="/approvals" founder={founder}>
      <ApprovalsClient
        initialMessages={messages}
        founders={founders}
        dbReady={dbReady}
      />
    </AppShell>
  );
}
