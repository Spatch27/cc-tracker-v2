import Link from "next/link";
import { UserButton } from "@clerk/nextjs";
import {
  CalendarDays,
  CheckCircle2,
  ClipboardCheck,
  Clock3,
  Crown,
  LayoutDashboard,
  MailCheck,
  Shield,
} from "lucide-react";
import type { FounderIdentity } from "@/lib/auth";
import { isClerkConfigured } from "@/lib/env";

interface AppShellProps {
  activePath: string;
  founder: FounderIdentity | null;
  children: React.ReactNode;
}

const NAV_ITEMS = [
  { href: "/", label: "Overview", icon: LayoutDashboard },
  { href: "/breakfasts", label: "CMO Breakfasts", icon: CalendarDays },
  { href: "/gold-lists", label: "Gold Lists", icon: Crown },
  { href: "/reviews", label: "Review Queue", icon: ClipboardCheck },
  { href: "/approvals", label: "Message Approvals", icon: MailCheck },
  { href: "/actions", label: "Actions & Timeline", icon: Clock3 },
  { href: "/admin", label: "Administration", icon: Shield },
];

export function AppShell({ activePath, founder, children }: AppShellProps) {
  const clerkReady = isClerkConfigured();

  return (
    <div className="min-h-screen flex bg-background text-foreground">
      <aside className="w-64 shrink-0 border-r border-border bg-surface flex flex-col">
        <div className="px-5 py-5 border-b border-border">
          <div className="flex items-center gap-2">
            <span className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-accent text-accent-foreground font-mono text-xs font-bold">
              CC
            </span>
            <div>
              <p className="text-sm font-semibold tracking-tight">
                Opportunity Tracker
              </p>
              <p className="text-[11px] text-muted">Committed Citizens v1</p>
            </div>
          </div>
        </div>

        <nav className="flex-1 p-3 space-y-1">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const isActive =
              item.href === "/"
                ? activePath === "/"
                : activePath.startsWith(item.href);

            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors ${
                  isActive
                    ? "bg-surface-elevated text-foreground font-medium border border-border"
                    : "text-muted hover:text-foreground hover:bg-surface-elevated/50"
                }`}
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="p-4 border-t border-border text-xs text-muted space-y-1.5">
          <div className="flex items-center gap-1.5 text-foreground/90">
            <CheckCircle2 className="h-3.5 w-3.5 text-success" />
            <span>Folk remains contact master</span>
          </div>
          <p className="leading-relaxed">
            Approvals are bound by exact content hash; external sends report
            independently.
          </p>
        </div>
      </aside>

      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-14 border-b border-border bg-surface/60 px-6 flex items-center justify-between">
          <div className="text-xs text-muted">
            Two-Founder Workspace · Tim &amp; Ben Scoggins
          </div>
          <div className="flex items-center gap-3">
            {founder ? (
              <div className="flex items-center gap-3">
                <div className="text-right">
                  <p className="text-xs font-medium text-foreground">
                    {founder.name}
                  </p>
                  <p className="text-[11px] text-muted">{founder.email}</p>
                </div>
                {clerkReady && <UserButton />}
              </div>
            ) : (
              <span className="rounded-full border border-border bg-surface-elevated px-2.5 py-1 text-xs text-muted">
                Setup mode (Auth pending)
              </span>
            )}
          </div>
        </header>

        <main className="flex-1 p-6 max-w-6xl w-full mx-auto">{children}</main>
      </div>
    </div>
  );
}
