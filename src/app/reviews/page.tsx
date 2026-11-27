import { and, desc, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import {
  ReviewsClient,
  type SerializedProposal,
  type SerializedSyncRun,
} from "@/components/reviews/reviews-client";
import { getDb, isDatabaseConfigured, schema } from "@/db";
import { getFounderAccessState } from "@/lib/auth";
import { getIntegrationStatus } from "@/lib/env";

export const dynamic = "force-dynamic";

export default async function ReviewsPage() {
  const access = await getFounderAccessState();
  if (access.status === "unauthenticated") redirect("/sign-in");
  if (access.status === "forbidden") redirect("/access-denied");
  const founder = access.status === "authenticated" ? access.founder : null;
  const envStatus = getIntegrationStatus();

  let proposals: SerializedProposal[] = [];
  let lastReconcileRun: SerializedSyncRun | null = null;
  let dbReady = false;

  if (isDatabaseConfigured()) {
    try {
      const db = getDb();
      const [proposalRows, [reconcileRow]] = await Promise.all([
        db
          .select()
          .from(schema.changeProposals)
          .orderBy(desc(schema.changeProposals.createdAt))
          .limit(100),
        db
          .select()
          .from(schema.syncRuns)
          .where(and(eq(schema.syncRuns.source, "folk_reconcile")))
          .orderBy(desc(schema.syncRuns.startedAt))
          .limit(1),
      ]);
      dbReady = true;
      proposals = proposalRows.map((p) => ({
        ...p,
        evidenceDate: p.evidenceDate ? p.evidenceDate.toISOString() : null,
        observedAt: p.observedAt.toISOString(),
        reviewedAt: p.reviewedAt ? p.reviewedAt.toISOString() : null,
        appliedAt: p.appliedAt ? p.appliedAt.toISOString() : null,
        createdAt: p.createdAt.toISOString(),
        updatedAt: p.updatedAt.toISOString(),
      }));
      if (reconcileRow) {
        lastReconcileRun = {
          ...reconcileRow,
          startedAt: reconcileRow.startedAt.toISOString(),
          finishedAt: reconcileRow.finishedAt
            ? reconcileRow.finishedAt.toISOString()
            : null,
        };
      }
    } catch {
      proposals = [];
      lastReconcileRun = null;
    }
  }

  return (
    <AppShell activePath="/reviews" founder={founder}>
      <ReviewsClient
        initialProposals={proposals}
        initialLastReconcileRun={lastReconcileRun}
        dbReady={dbReady}
        folkConfigured={envStatus.folkConfigured}
      />
    </AppShell>
  );
}
