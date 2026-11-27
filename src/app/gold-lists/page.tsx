import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import {
  GoldListsClient,
  type GoldListItem,
} from "@/components/gold-lists/gold-lists-client";
import { getDb, isDatabaseConfigured } from "@/db";
import { getFounderAccessState } from "@/lib/auth";
import type { FounderOption } from "@/lib/founders";
import { listGoldAccountsSummary } from "@/lib/gold-lists/queries";

export const dynamic = "force-dynamic";

export default async function GoldListsPage() {
  const access = await getFounderAccessState();
  if (access.status === "unauthenticated") redirect("/sign-in");
  if (access.status === "forbidden") redirect("/access-denied");
  const founder = access.status === "authenticated" ? access.founder : null;

  let dbReady = false;
  let founders: FounderOption[] = [];
  let ownerCounts: Record<string, number> = {};
  let accounts: GoldListItem[] = [];

  if (isDatabaseConfigured()) {
    try {
      const db = getDb();
      const summary = await listGoldAccountsSummary(db);
      founders = summary.founders;
      ownerCounts = summary.ownerCounts;
      accounts = summary.accounts.map((a) => ({
        id: a.id,
        ownerUserId: a.ownerUserId,
        ownerName: a.ownerName,
        status: a.status,
        companyName: a.companyName,
        companyDomain: a.companyDomain,
        folkCompanyId: a.folkCompanyId,
        marketingTeamSize: a.marketingTeamSize,
        legacySetupNotes: a.legacySetupNotes,
        fit: a.fit,
        mappedContactsCount: a.mappedContactsCount,
        coverageGapsCount: a.coverageGapsCount,
        latestSignal: a.latestSignal
          ? {
              ...a.latestSignal,
              signalDate: a.latestSignal.signalDate
                ? a.latestSignal.signalDate.toISOString()
                : null,
            }
          : null,
        openActionsCount: a.openActionsCount,
        lastActivityAt: a.lastActivityAt ? a.lastActivityAt.toISOString() : null,
      }));
      dbReady = true;
    } catch {
      dbReady = false;
    }
  }

  return (
    <AppShell activePath="/gold-lists" founder={founder}>
      <GoldListsClient
        initialAccounts={accounts}
        founders={founders}
        initialOwnerCounts={ownerCounts}
        currentFounderUserId={founder?.userId ?? null}
        dbReady={dbReady}
      />
    </AppShell>
  );
}
