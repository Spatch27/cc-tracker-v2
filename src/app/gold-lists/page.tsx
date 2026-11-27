import { redirect } from "next/navigation";
import { Crown } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { getFounderAccessState } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function GoldListsPage() {
  const access = await getFounderAccessState();
  if (access.status === "unauthenticated") redirect("/sign-in");
  if (access.status === "forbidden") redirect("/access-denied");
  const founder = access.status === "authenticated" ? access.founder : null;

  return (
    <AppShell activePath="/gold-lists" founder={founder}>
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <Crown className="h-5 w-5 text-accent" />
          <h1 className="text-2xl font-semibold tracking-tight">Gold Lists</h1>
        </div>
        <div className="rounded-xl border border-border bg-surface p-6 text-sm text-muted space-y-2">
          <p className="text-foreground font-medium">
            Phase 3 Workspace (Schema ready in Postgres)
          </p>
          <p>
            Will manage Tim and Ben&apos;s Gold-list accounts (strictly capped at
            50 companies per founder), decision-maker mapping linked to Folk,
            Team / Process / Data / Tech intelligence, dated buying signals, and
            cross-founder outreach timelines.
          </p>
        </div>
      </div>
    </AppShell>
  );
}
