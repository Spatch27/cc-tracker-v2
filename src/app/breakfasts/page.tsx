import { redirect } from "next/navigation";
import { CalendarDays } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { getFounderAccessState } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function BreakfastsPage() {
  const access = await getFounderAccessState();
  if (access.status === "unauthenticated") redirect("/sign-in");
  if (access.status === "forbidden") redirect("/access-denied");
  const founder = access.status === "authenticated" ? access.founder : null;

  return (
    <AppShell activePath="/breakfasts" founder={founder}>
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <CalendarDays className="h-5 w-5 text-accent" />
          <h1 className="text-2xl font-semibold tracking-tight">
            CMO Breakfasts
          </h1>
        </div>
        <div className="rounded-xl border border-border bg-surface p-6 text-sm text-muted space-y-2">
          <p className="text-foreground font-medium">
            Phase 2 Workspace (Schema ready in Postgres)
          </p>
          <p>
            Will manage locale-based events (Exeter, Bristol, London),
            host-aware capacity, booking/deposit obligations, manual waitlist
            offers, event-scoped dietary/timing notes, same-locale automatic
            carry-forward, Claude preread links, and post-event follow-ups.
          </p>
        </div>
      </div>
    </AppShell>
  );
}
