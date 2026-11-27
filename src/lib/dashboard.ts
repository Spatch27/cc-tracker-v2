import { count, desc, eq, inArray, lt } from "drizzle-orm";
import { getDb, isDatabaseConfigured, schema } from "@/db";

export interface OverviewSummary {
  dbReady: boolean;
  dbError: string | null;
  pendingProposalsCount: number;
  conflictProposalsCount: number;
  awaitingApprovalMessagesCount: number;
  overdueActionsCount: number;
  dueTodayOrOpenActionsCount: number;
  activeGoldAccountsCount: number;
  upcomingBreakfastsCount: number;
  lastSyncRun: {
    source: string;
    scope: string;
    status: string;
    recordsRead: number;
    visibilityGapNote: string | null;
    errorSummary: string | null;
    startedAt: Date;
    finishedAt: Date | null;
  } | null;
}

export async function getOverviewSummary(): Promise<OverviewSummary> {
  if (!isDatabaseConfigured()) {
    return {
      dbReady: false,
      dbError: null,
      pendingProposalsCount: 0,
      conflictProposalsCount: 0,
      awaitingApprovalMessagesCount: 0,
      overdueActionsCount: 0,
      dueTodayOrOpenActionsCount: 0,
      activeGoldAccountsCount: 0,
      upcomingBreakfastsCount: 0,
      lastSyncRun: null,
    };
  }

  try {
    const db = getDb();
    const now = new Date();

    const [
      [pendingProposals],
      [conflictProposals],
      [awaitingMessages],
      [overdueActions],
      [openActions],
      [goldAccounts],
      [breakfasts],
      syncRuns,
    ] = await Promise.all([
      db
        .select({ value: count() })
        .from(schema.changeProposals)
        .where(eq(schema.changeProposals.status, "pending_review")),
      db
        .select({ value: count() })
        .from(schema.changeProposals)
        .where(eq(schema.changeProposals.status, "conflict")),
      db
        .select({ value: count() })
        .from(schema.messageApprovals)
        .where(eq(schema.messageApprovals.status, "awaiting_approval")),
      db
        .select({ value: count() })
        .from(schema.followUpActions)
        .where(lt(schema.followUpActions.dueDate, now)),
      db
        .select({ value: count() })
        .from(schema.followUpActions)
        .where(inArray(schema.followUpActions.status, ["open", "needs_review"])),
      db
        .select({ value: count() })
        .from(schema.goldAccounts)
        .where(eq(schema.goldAccounts.status, "active")),
      db
        .select({ value: count() })
        .from(schema.breakfastEvents)
        .where(
          inArray(schema.breakfastEvents.status, [
            "planning",
            "inviting",
            "confirmed",
          ]),
        ),
      db
        .select()
        .from(schema.syncRuns)
        .orderBy(desc(schema.syncRuns.startedAt))
        .limit(1),
    ]);

    return {
      dbReady: true,
      dbError: null,
      pendingProposalsCount: Number(pendingProposals?.value ?? 0),
      conflictProposalsCount: Number(conflictProposals?.value ?? 0),
      awaitingApprovalMessagesCount: Number(awaitingMessages?.value ?? 0),
      overdueActionsCount: Number(overdueActions?.value ?? 0),
      dueTodayOrOpenActionsCount: Number(openActions?.value ?? 0),
      activeGoldAccountsCount: Number(goldAccounts?.value ?? 0),
      upcomingBreakfastsCount: Number(breakfasts?.value ?? 0),
      lastSyncRun: syncRuns[0] ?? null,
    };
  } catch (err) {
    return {
      dbReady: false,
      dbError:
        err instanceof Error
          ? err.message
          : "Database schema not yet pushed or unreachable",
      pendingProposalsCount: 0,
      conflictProposalsCount: 0,
      awaitingApprovalMessagesCount: 0,
      overdueActionsCount: 0,
      dueTodayOrOpenActionsCount: 0,
      activeGoldAccountsCount: 0,
      upcomingBreakfastsCount: 0,
      lastSyncRun: null,
    };
  }
}
