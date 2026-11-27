import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { BreakfastImportClient } from "@/components/breakfasts/breakfast-import-client";
import { getFounderAccessState } from "@/lib/auth";
import { getIntegrationStatus } from "@/lib/env";

export const dynamic = "force-dynamic";

export default async function BreakfastImportPage() {
  const access = await getFounderAccessState();
  if (access.status === "unauthenticated") redirect("/sign-in");
  if (access.status === "forbidden") redirect("/access-denied");
  const founder = access.status === "authenticated" ? access.founder : null;
  const envStatus = getIntegrationStatus();

  return (
    <AppShell activePath="/breakfasts" founder={founder}>
      <BreakfastImportClient
        databaseConfigured={envStatus.databaseConfigured}
        folkConfigured={envStatus.folkConfigured}
      />
    </AppShell>
  );
}
