import { desc, eq } from "drizzle-orm";
import { getDb, isDatabaseConfigured, schema } from "@/db";
import { errorResponse } from "@/lib/api-auth";
import { requireFounderSession } from "@/lib/auth";
import { createFolkClientFromEnv } from "@/lib/folk/client";
import { runFolkReconciliation } from "@/lib/folk/reconcile";
import { recordAuditEvent } from "@/lib/governance/audit";
import { createDrizzleProposalStore } from "@/lib/governance/proposals";

export const dynamic = "force-dynamic";

function isAuthorizedCronRequest(request: Request): boolean {
  const cronSecret = process.env.CRON_SECRET?.trim();
  if (!cronSecret) return false;
  const auth = request.headers.get("authorization");
  return auth === `Bearer ${cronSecret}`;
}

export async function GET() {
  try {
    await requireFounderSession();
    if (!isDatabaseConfigured()) {
      return Response.json({ lastRun: null, databaseConfigured: false });
    }
    const db = getDb();
    const [lastRun] = await db
      .select()
      .from(schema.syncRuns)
      .where(eq(schema.syncRuns.source, "folk_reconcile"))
      .orderBy(desc(schema.syncRuns.startedAt))
      .limit(1);

    return Response.json({ lastRun: lastRun ?? null });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    let founderUserId: string | null = null;
    if (!isAuthorizedCronRequest(request)) {
      const founder = await requireFounderSession();
      founderUserId = founder.userId;
    }

    if (!isDatabaseConfigured()) {
      return Response.json(
        { error: "Database is not configured" },
        { status: 503 },
      );
    }

    const folkClient = createFolkClientFromEnv();
    if (!folkClient) {
      return Response.json(
        { error: "FOLK_API_KEY is not configured" },
        { status: 503 },
      );
    }

    const db = getDb();
    const [runningRow] = await db
      .insert(schema.syncRuns)
      .values({
        source: "folk_reconcile",
        scope: "linked_entities",
        status: "running",
        recordsRead: 0,
      })
      .returning();

    const [peopleLinks, companyLinks] = await Promise.all([
      db.select().from(schema.folkPeopleLink),
      db.select().from(schema.folkCompaniesLink),
    ]);

    const summary = await runFolkReconciliation({
      peopleLinks: peopleLinks.map((p) => ({
        id: p.id,
        folkPersonId: p.folkPersonId,
        fullName: p.fullName,
        email: p.email,
        jobTitle: p.jobTitle,
        linkedinUrl: p.linkedinUrl,
      })),
      companyLinks: companyLinks.map((c) => ({
        id: c.id,
        folkCompanyId: c.folkCompanyId,
        name: c.name,
        domain: c.domain,
      })),
      folkClient,
      proposalStore: createDrizzleProposalStore(),
      initiatedByUserId: founderUserId,
    });

    const errorSummary =
      summary.errors.length > 0
        ? summary.errors
            .slice(0, 5)
            .map((e) => `${e.entityType}:${e.name} (${e.message})`)
            .join("; ")
        : null;

    const [finishedRun] = await db
      .update(schema.syncRuns)
      .set({
        status: summary.status,
        recordsRead: summary.recordsChecked,
        visibilityGapNote: `${summary.conflictsCreated} new conflict(s), ${summary.conflictsAlreadyOpen} already tracked.`,
        errorSummary,
        finishedAt: new Date(),
      })
      .where(eq(schema.syncRuns.id, runningRow.id))
      .returning();

    await recordAuditEvent({
      actorType: founderUserId ? "human" : "system",
      actorUserId: founderUserId,
      action: "folk_reconciliation_run",
      entityType: "sync_run",
      entityId: finishedRun.id,
      newValue: summary,
      outcome: summary.status === "failed" ? "failed" : "succeeded",
    });

    return Response.json({ run: finishedRun, summary });
  } catch (err) {
    return errorResponse(err);
  }
}
