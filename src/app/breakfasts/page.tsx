import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import {
  BreakfastsListClient,
  type BreakfastSummaryItem,
} from "@/components/breakfasts/breakfasts-list-client";
import { getDb, isDatabaseConfigured } from "@/db";
import { getFounderAccessState } from "@/lib/auth";
import { listBreakfastsSummary } from "@/lib/breakfasts/queries";
import type { FounderOption } from "@/lib/founders";

export const dynamic = "force-dynamic";

export default async function BreakfastsPage() {
  const access = await getFounderAccessState();
  if (access.status === "unauthenticated") redirect("/sign-in");
  if (access.status === "forbidden") redirect("/access-denied");
  const founder = access.status === "authenticated" ? access.founder : null;

  let dbReady = false;
  let founders: FounderOption[] = [];
  let events: BreakfastSummaryItem[] = [];
  let queueCountsByLocale: Record<string, number> = {};

  if (isDatabaseConfigured()) {
    try {
      const db = getDb();
      const summary = await listBreakfastsSummary(db);
      founders = summary.founders;
      queueCountsByLocale = summary.queueCountsByLocale;
      events = summary.events.map((ev) => ({
        id: ev.id,
        locale: ev.locale,
        title: ev.title,
        eventDate: ev.eventDate.toISOString(),
        venueName: ev.venueName,
        totalCapacity: ev.totalCapacity,
        status: ev.status,
        bookingStatus: ev.bookingStatus,
        depositPaid: ev.depositPaid,
        balancePaid: ev.balancePaid,
        inviteeCount: ev.inviteeCount,
        capacity: ev.capacity,
      }));
      dbReady = true;
    } catch {
      dbReady = false;
    }
  }

  return (
    <AppShell activePath="/breakfasts" founder={founder}>
      <BreakfastsListClient
        initialEvents={events}
        founders={founders}
        queueCountsByLocale={queueCountsByLocale}
        dbReady={dbReady}
      />
    </AppShell>
  );
}
