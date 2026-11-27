"use client";

import { useState } from "react";
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
  Menu,
  Shield,
  X,
} from "lucide-react";
import type { FounderIdentity } from "@/lib/auth";
import type { NavBadgeCounts } from "@/lib/dashboard";

const NAV_ITEMS = [
  { href: "/", label: "Overview", icon: LayoutDashboard, badgeKey: null },
  { href: "/breakfasts", label: "CMO Breakfasts", icon: CalendarDays, badgeKey: null },
  { href: "/gold-lists", label: "Gold Lists", icon: Crown, badgeKey: null },
  { href: "/reviews", label: "Review Queue", icon: ClipboardCheck, badgeKey: "reviewsCount" },
  { href: "/approvals", label: "Message Approvals", icon: MailCheck, badgeKey: "approvalsCount" },
  { href: "/actions", label: "Actions & Timeline", icon: Clock3, badgeKey: "actionsCount" },
  { href: "/admin", label: "Administration", icon: Shield, badgeKey: null },
] as const;

export function AppShellNav({
  activePath,
  founder,
  clerkReady,
  badges,
  children,
}: {
  activePath: string;
  founder: FounderIdentity | null;
  clerkReady: boolean;
  badges: NavBadgeCounts;
  children: React.ReactNode;
}) {
  const [mobileOpen, setMobileOpen] = useState(false);

  const renderLinks = (onNavigate?: () => void) => (
    <nav className="flex-1 p-3 space-y-1">
      {NAV_ITEMS.map((item) => {
        const Icon = item.icon;
        const isActive =
          item.href === "/"
            ? activePath === "/"
            : activePath.startsWith(item.href);
        const badgeCount = item.badgeKey ? badges[item.badgeKey] : 0;

        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            className={`flex items-center justify-between gap-2 rounded-lg px-3 py-2 text-sm transition-colors ${
              isActive
                ? "bg-surface-elevated text-foreground font-medium border border-border"
                : "text-muted hover:text-foreground hover:bg-surface-elevated/50"
            }`}
          >
            <span className="flex items-center gap-2.5 min-w-0">
              <Icon className="h-4 w-4 shrink-0" />
              <span className="truncate">{item.label}</span>
            </span>
            {badgeCount > 0 && (
              <span className="rounded-full bg-accent/20 text-accent px-1.5 py-0.5 text-[10px] font-semibold tabular-nums">
                {badgeCount}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );

  const sidebarFooter = (
    <div className="p-4 border-t border-border text-xs text-muted space-y-1.5">
      <div className="flex items-center gap-1.5 text-foreground/90">
        <CheckCircle2 className="h-3.5 w-3.5 text-success shrink-0" />
        <span>Folk remains contact master</span>
      </div>
      <p className="leading-relaxed">
        Approvals are bound by exact content hash; external sends report
        independently.
      </p>
    </div>
  );

  const brandHeader = (
    <div className="px-5 py-5 border-b border-border flex items-center justify-between gap-2">
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
      {mobileOpen && (
        <button
          type="button"
          onClick={() => setMobileOpen(false)}
          aria-label="Close navigation menu"
          className="md:hidden rounded-lg p-1 text-muted hover:text-foreground"
        >
          <X className="h-5 w-5" />
        </button>
      )}
    </div>
  );

  return (
    <div className="min-h-screen flex bg-background text-foreground">
      {/* Desktop persistent sidebar */}
      <aside className="hidden md:flex w-64 shrink-0 border-r border-border bg-surface flex-col">
        {brandHeader}
        {renderLinks()}
        {sidebarFooter}
      </aside>

      {/* Mobile slide-over drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 md:hidden flex">
          <div
            className="fixed inset-0 bg-black/70"
            onClick={() => setMobileOpen(false)}
          />
          <aside className="relative z-10 w-72 max-w-[82vw] border-r border-border bg-surface flex flex-col h-full">
            {brandHeader}
            {renderLinks(() => setMobileOpen(false))}
            {sidebarFooter}
          </aside>
        </div>
      )}

      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-14 border-b border-border bg-surface/60 px-4 sm:px-6 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <button
              type="button"
              onClick={() => setMobileOpen(true)}
              aria-label="Open navigation menu"
              className="md:hidden rounded-lg border border-border bg-surface-elevated p-1.5 text-foreground"
            >
              <Menu className="h-4 w-4" />
            </button>
            <div className="text-xs text-muted truncate">
              Two-Founder Workspace · Tim Burley &amp; Ben Scoggins
            </div>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            {founder ? (
              <div className="flex items-center gap-3">
                <div className="text-right hidden sm:block">
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

        <main className="flex-1 p-4 sm:p-6 max-w-6xl w-full mx-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
