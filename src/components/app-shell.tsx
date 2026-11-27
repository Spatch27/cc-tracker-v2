import type { FounderIdentity } from "@/lib/auth";
import { getNavBadgeCounts } from "@/lib/dashboard";
import { isClerkConfigured } from "@/lib/env";
import { AppShellNav } from "./app-shell-nav";

interface AppShellProps {
  activePath: string;
  founder: FounderIdentity | null;
  children: React.ReactNode;
}

export async function AppShell({ activePath, founder, children }: AppShellProps) {
  const clerkReady = isClerkConfigured();
  const badges = await getNavBadgeCounts();

  return (
    <AppShellNav
      activePath={activePath}
      founder={founder}
      clerkReady={clerkReady}
      badges={badges}
    >
      {children}
    </AppShellNav>
  );
}
