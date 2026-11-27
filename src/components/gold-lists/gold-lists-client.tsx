"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  Building2,
  Crown,
  LayoutGrid,
  List,
  Plus,
  Search,
  Sparkles,
  Upload,
  Users,
  X,
} from "lucide-react";
import type { FounderOption } from "@/lib/founders";
import {
  MAX_GOLD_ACCOUNTS_PER_FOUNDER,
  type AccountFitSummary,
} from "@/lib/gold-lists/rules";

export interface GoldListItem {
  id: string;
  ownerUserId: string;
  ownerName: string;
  status: "active" | "archived";
  companyName: string;
  companyDomain: string | null;
  folkCompanyId: string | null;
  marketingTeamSize: number | null;
  legacySetupNotes: string | null;
  fit: AccountFitSummary;
  mappedContactsCount: number;
  coverageGapsCount: number;
  latestSignal: {
    id: string;
    signalType: string;
    title: string;
    signalDate: string | null;
  } | null;
  openActionsCount: number;
  lastActivityAt: string | null;
}

interface FolkCompanyOption {
  folkCompanyId: string;
  name: string;
  domain: string | null;
  industries: string[];
}

type SignalContactFilter =
  | "all"
  | "has_gaps"
  | "no_contacts"
  | "has_signals"
  | "no_outreach"
  | "open_actions";

type SortMode =
  | "recent"
  | "name_asc"
  | "actions_desc"
  | "activity_desc"
  | "activity_asc";

export function GoldListsClient({
  initialAccounts,
  founders,
  initialOwnerCounts,
  currentFounderUserId,
  dbReady,
}: {
  initialAccounts: GoldListItem[];
  founders: FounderOption[];
  initialOwnerCounts: Record<string, number>;
  currentFounderUserId: string | null;
  dbReady: boolean;
}) {
  const router = useRouter();
  const [accounts, setAccounts] = useState<GoldListItem[]>(initialAccounts);
  const [ownerCounts, setOwnerCounts] =
    useState<Record<string, number>>(initialOwnerCounts);
  const [ownerFilter, setOwnerFilter] = useState<string>("all_active");
  const [searchQuery, setSearchQuery] = useState("");
  const [quickFilter, setQuickFilter] = useState<SignalContactFilter>("all");
  const [sortMode, setSortMode] = useState<SortMode>("name_asc");
  const [viewMode, setViewMode] = useState<"table" | "cards">("table");
  const [showAdd, setShowAdd] = useState(false);

  const [companyQuery, setCompanyQuery] = useState("");
  const [folkCompanies, setFolkCompanies] = useState<FolkCompanyOption[]>([]);
  const [searching, setSearching] = useState(false);
  const [folkConfigured, setFolkConfigured] = useState(true);
  const [selectedCompany, setSelectedCompany] =
    useState<FolkCompanyOption | null>(null);
  const [selectedOwnerId, setSelectedOwnerId] = useState<string>(
    currentFounderUserId ?? founders[0]?.id ?? "",
  );
  const [teamSize, setTeamSize] = useState("");
  const [legacyNotes, setLegacyNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function searchFolkCompanies(q: string) {
    setSearching(true);
    try {
      const res = await fetch(`/api/folk/companies?q=${encodeURIComponent(q)}`);
      const data = await res.json();
      setFolkConfigured(data.folkConfigured !== false);
      setFolkCompanies(data.companies ?? []);
    } catch {
      setError("Failed to search Folk companies");
    } finally {
      setSearching(false);
    }
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedCompany) return;
    setError(null);
    setSaving(true);
    try {
      const res = await fetch("/api/gold-lists", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          folkCompanyId: selectedCompany.folkCompanyId,
          companyName: selectedCompany.name,
          domain: selectedCompany.domain,
          ownerUserId: selectedOwnerId,
          marketingTeamSize: teamSize.trim() ? Number(teamSize) : null,
          legacySetupNotes: legacyNotes.trim() || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Failed to add Gold account");
        return;
      }

      const listRes = await fetch("/api/gold-lists");
      if (listRes.ok) {
        const listData = await listRes.json();
        setAccounts(listData.accounts);
        setOwnerCounts(listData.ownerCounts);
      }
      setShowAdd(false);
      setSelectedCompany(null);
      setTeamSize("");
      setLegacyNotes("");
      router.refresh();
    } catch {
      setError("Network error adding Gold account");
    } finally {
      setSaving(false);
    }
  }

  const ownerScoped = accounts.filter((a) => {
    if (ownerFilter === "all_active") return a.status === "active";
    if (ownerFilter === "archived") return a.status === "archived";
    return a.status === "active" && a.ownerUserId === ownerFilter;
  });

  const qLower = searchQuery.trim().toLowerCase();
  const filtered = ownerScoped
    .filter((a) => {
      if (quickFilter === "has_gaps" && a.coverageGapsCount === 0) return false;
      if (quickFilter === "no_contacts" && a.mappedContactsCount > 0) return false;
      if (quickFilter === "has_signals" && !a.latestSignal) return false;
      if (quickFilter === "no_outreach" && a.lastActivityAt !== null) return false;
      if (quickFilter === "open_actions" && a.openActionsCount === 0) return false;

      if (!qLower) return true;
      const hay = [
        a.companyName,
        a.companyDomain,
        a.ownerName,
        a.latestSignal?.title,
        a.legacySetupNotes,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(qLower);
    })
    .slice()
    .sort((a, b) => {
      if (sortMode === "name_asc") {
        return a.companyName.localeCompare(b.companyName);
      }
      if (sortMode === "actions_desc") {
        return (
          b.openActionsCount - a.openActionsCount ||
          a.companyName.localeCompare(b.companyName)
        );
      }
      if (sortMode === "activity_desc") {
        const at = a.lastActivityAt ? new Date(a.lastActivityAt).getTime() : 0;
        const bt = b.lastActivityAt ? new Date(b.lastActivityAt).getTime() : 0;
        return bt - at || a.companyName.localeCompare(b.companyName);
      }
      if (sortMode === "activity_asc") {
        const at = a.lastActivityAt
          ? new Date(a.lastActivityAt).getTime()
          : Number.MAX_SAFE_INTEGER;
        const bt = b.lastActivityAt
          ? new Date(b.lastActivityAt).getTime()
          : Number.MAX_SAFE_INTEGER;
        return at - bt || a.companyName.localeCompare(b.companyName);
      }
      return 0;
    });

  const selectedOwnerCount = ownerCounts[selectedOwnerId] ?? 0;
  const selectedOwnerAtCap =
    selectedOwnerCount >= MAX_GOLD_ACCOUNTS_PER_FOUNDER;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Crown className="h-5 w-5 text-accent" />
            <h1 className="text-2xl font-semibold tracking-tight">Gold Lists</h1>
          </div>
          <p className="text-sm text-muted mt-1">
            Account intelligence, decision-maker mapping, and cross-founder
            outreach (strictly capped at 50 active companies per founder).
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Link
            href="/gold-lists/import"
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface-elevated px-3.5 py-2 text-xs font-medium text-foreground hover:border-accent"
          >
            <Upload className="h-3.5 w-3.5 text-accent" />
            Import from Excel
          </Link>
          <button
            type="button"
            disabled={!dbReady}
            onClick={() => {
              setShowAdd(true);
              setError(null);
              searchFolkCompanies("");
            }}
            className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-4 py-2 text-xs font-semibold text-accent-foreground hover:opacity-90 disabled:opacity-40"
          >
            <Plus className="h-4 w-4" />
            Add Gold Account
          </button>
        </div>
      </div>

      {!dbReady && (
        <div className="rounded-xl border border-warning/40 bg-warning/10 p-4 text-xs text-warning">
          Database tables need an update for Phase 3. Go to{" "}
          <Link href="/admin" className="underline font-semibold">
            Administration
          </Link>{" "}
          and click <strong>Re-check / Update Database Tables</strong>.
        </div>
      )}

      {/* Founder Cap Gauges & Filter Tabs */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {founders.map((f) => {
          const count = ownerCounts[f.id] ?? 0;
          const atCap = count >= MAX_GOLD_ACCOUNTS_PER_FOUNDER;
          return (
            <button
              key={f.id}
              type="button"
              onClick={() => setOwnerFilter(f.id)}
              className={`rounded-xl border p-4 text-left transition-colors ${
                ownerFilter === f.id
                  ? "border-accent bg-surface-elevated"
                  : "border-border bg-surface hover:border-accent/40"
              }`}
            >
              <div className="flex items-center justify-between text-xs text-muted">
                <span>{f.name}&apos;s Gold List</span>
                {atCap && (
                  <span className="rounded bg-warning/15 text-warning px-1.5 py-0.5 text-[10px] font-medium">
                    At Cap
                  </span>
                )}
              </div>
              <p className="mt-1.5 text-xl font-semibold">
                {count} / {MAX_GOLD_ACCOUNTS_PER_FOUNDER}
              </p>
            </button>
          );
        })}

        <div className="rounded-xl border border-border bg-surface p-4 flex flex-col justify-between">
          <span className="text-xs text-muted">Quick Views</span>
          <div className="flex flex-wrap gap-2 mt-2">
            <button
              type="button"
              onClick={() => setOwnerFilter("all_active")}
              className={`rounded-lg border px-2.5 py-1 text-xs ${
                ownerFilter === "all_active"
                  ? "border-accent bg-accent/15 text-accent font-medium"
                  : "border-border bg-surface-elevated text-muted"
              }`}
            >
              All Active (
              {accounts.filter((a) => a.status === "active").length})
            </button>
            <button
              type="button"
              onClick={() => setOwnerFilter("archived")}
              className={`rounded-lg border px-2.5 py-1 text-xs ${
                ownerFilter === "archived"
                  ? "border-accent bg-accent/15 text-accent font-medium"
                  : "border-border bg-surface-elevated text-muted"
              }`}
            >
              Archived (
              {accounts.filter((a) => a.status === "archived").length})
            </button>
          </div>
        </div>
      </div>

      {/* Search, Quick Filters, Sort & View Mode */}
      <div className="rounded-xl border border-border bg-surface p-4 space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center gap-2.5">
          <div className="relative flex-1">
            <Search className="h-3.5 w-3.5 text-muted absolute left-3 top-2.5" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search company, domain, owner, buying signal, or notes..."
              className="w-full rounded-lg border border-border bg-surface-elevated pl-8 pr-3 py-1.5 text-xs"
            />
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <select
              aria-label="Sort Gold accounts"
              value={sortMode}
              onChange={(e) => setSortMode(e.target.value as SortMode)}
              className="rounded-lg border border-border bg-surface-elevated px-2.5 py-1.5 text-xs"
            >
              <option value="name_asc">Company A–Z</option>
              <option value="recent">Recently Updated</option>
              <option value="actions_desc">Most Open Actions</option>
              <option value="activity_desc">Most Recent Outreach</option>
              <option value="activity_asc">Least Recent Outreach</option>
            </select>

            <div className="inline-flex rounded-lg border border-border bg-surface-elevated p-0.5 text-xs">
              <button
                type="button"
                onClick={() => setViewMode("table")}
                title="Table view"
                className={`inline-flex items-center gap-1 rounded-md px-2 py-1 ${
                  viewMode === "table"
                    ? "bg-surface text-foreground font-medium"
                    : "text-muted hover:text-foreground"
                }`}
              >
                <List className="h-3.5 w-3.5" />
                Table
              </button>
              <button
                type="button"
                onClick={() => setViewMode("cards")}
                title="Card view"
                className={`inline-flex items-center gap-1 rounded-md px-2 py-1 ${
                  viewMode === "cards"
                    ? "bg-surface text-foreground font-medium"
                    : "text-muted hover:text-foreground"
                }`}
              >
                <LayoutGrid className="h-3.5 w-3.5" />
                Cards
              </button>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
          <div className="flex flex-wrap gap-1.5">
            {(
              [
                ["all", "All"],
                ["no_contacts", "Needs Contacts"],
                ["has_gaps", "Has Coverage Gaps"],
                ["has_signals", "Has Signals"],
                ["no_outreach", "No Outreach Yet"],
                ["open_actions", "Has Open Actions"],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setQuickFilter(key)}
                className={`rounded-full border px-2.5 py-0.5 text-[11px] transition-colors ${
                  quickFilter === key
                    ? "border-accent bg-accent/15 text-accent font-medium"
                    : "border-border bg-surface-elevated text-muted hover:text-foreground"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <span className="text-[11px] text-muted">
            Showing {filtered.length} of {ownerScoped.length}
          </span>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-xl border border-border bg-surface p-8 text-center space-y-2">
          <p className="text-sm font-medium">
            {ownerScoped.length === 0
              ? "No Gold accounts in this view yet"
              : "No Gold accounts match your current search or filter"}
          </p>
          <p className="text-xs text-muted">
            {ownerScoped.length === 0
              ? "Click Add Gold Account or Import from Excel to add companies from Folk CRM."
              : "Clear your search or switch filter pills to see all accounts."}
          </p>
        </div>
      ) : viewMode === "table" ? (
        <div className="rounded-xl border border-border bg-surface overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse min-w-[780px]">
            <thead>
              <tr className="border-b border-border bg-surface-elevated/60 text-[11px] text-muted">
                <th className="py-2.5 px-4 font-medium">Company</th>
                <th className="py-2.5 px-3 font-medium">Owner</th>
                <th className="py-2.5 px-3 font-medium">Fit &amp; Team</th>
                <th className="py-2.5 px-3 font-medium">Contacts</th>
                <th className="py-2.5 px-3 font-medium">Latest Signal</th>
                <th className="py-2.5 px-3 font-medium text-right">Actions</th>
                <th className="py-2.5 px-4 font-medium text-right">
                  Last Activity
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtered.map((acc) => (
                <tr
                  key={acc.id}
                  onClick={() => router.push(`/gold-lists/${acc.id}`)}
                  className="hover:bg-surface-elevated/50 cursor-pointer transition-colors"
                >
                  <td className="py-3 px-4">
                    <Link
                      href={`/gold-lists/${acc.id}`}
                      className="font-semibold text-foreground hover:text-accent block"
                    >
                      {acc.companyName}
                    </Link>
                    <span className="text-[11px] text-muted">
                      {acc.companyDomain ?? "No domain"}
                    </span>
                  </td>
                  <td className="py-3 px-3 text-foreground whitespace-nowrap">
                    {acc.ownerName}
                  </td>
                  <td className="py-3 px-3">
                    <span
                      className={`inline-block rounded-full px-2 py-0.5 border text-[11px] whitespace-nowrap ${
                        acc.fit.meetsTeamSizeCriteria
                          ? "border-success/30 bg-success/10 text-success"
                          : "border-border bg-surface-elevated text-muted"
                      }`}
                    >
                      {acc.fit.summaryLabel}
                    </span>
                  </td>
                  <td className="py-3 px-3 whitespace-nowrap text-muted">
                    <span
                      className={
                        acc.mappedContactsCount === 0
                          ? "text-warning font-medium"
                          : "text-foreground"
                      }
                    >
                      {acc.mappedContactsCount} mapped
                    </span>
                    {acc.coverageGapsCount > 0 && (
                      <span className="text-warning">
                        {" "}
                        · {acc.coverageGapsCount} gap
                        {acc.coverageGapsCount === 1 ? "" : "s"}
                      </span>
                    )}
                  </td>
                  <td className="py-3 px-3 max-w-[220px]">
                    {acc.latestSignal ? (
                      <span className="truncate block text-foreground">
                        <strong className="font-mono text-accent">
                          [{acc.latestSignal.signalType}]
                        </strong>{" "}
                        {acc.latestSignal.title}
                      </span>
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                  </td>
                  <td className="py-3 px-3 text-right tabular-nums">
                    {acc.openActionsCount > 0 ? (
                      <span className="rounded-full bg-accent/15 text-accent px-2 py-0.5 font-medium">
                        {acc.openActionsCount}
                      </span>
                    ) : (
                      <span className="text-muted">0</span>
                    )}
                  </td>
                  <td className="py-3 px-4 text-right text-muted whitespace-nowrap">
                    {acc.lastActivityAt
                      ? new Date(acc.lastActivityAt).toLocaleDateString("en-GB")
                      : "None yet"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filtered.map((acc) => (
            <Link
              key={acc.id}
              href={`/gold-lists/${acc.id}`}
              className="rounded-xl border border-border bg-surface p-5 hover:border-accent/60 transition-colors space-y-3 block"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <Building2 className="h-4 w-4 text-accent" />
                    <h2 className="text-base font-semibold text-foreground">
                      {acc.companyName}
                    </h2>
                  </div>
                  <p className="text-xs text-muted mt-0.5">
                    Owner: <strong className="text-foreground">{acc.ownerName}</strong>
                    {acc.companyDomain ? ` · ${acc.companyDomain}` : ""}
                  </p>
                </div>
                <span className="rounded-md border border-border bg-surface-elevated px-2 py-0.5 text-[11px] font-mono text-muted">
                  {acc.status}
                </span>
              </div>

              <div className="flex flex-wrap gap-1.5 text-[11px]">
                <span
                  className={`rounded-full px-2 py-0.5 border ${
                    acc.fit.meetsTeamSizeCriteria
                      ? "border-success/30 bg-success/10 text-success"
                      : "border-border bg-surface-elevated text-muted"
                  }`}
                >
                  {acc.fit.summaryLabel}
                </span>
                <span className="rounded-full border border-border bg-surface-elevated px-2 py-0.5 text-muted inline-flex items-center gap-1">
                  <Users className="h-3 w-3" />
                  {acc.mappedContactsCount} mapped · {acc.coverageGapsCount} gaps
                </span>
              </div>

              {acc.latestSignal && (
                <div className="rounded-lg border border-border bg-surface-elevated px-3 py-2 text-xs flex items-center gap-2">
                  <Sparkles className="h-3.5 w-3.5 text-accent shrink-0" />
                  <span className="truncate">
                    <strong className="font-mono text-accent">
                      [{acc.latestSignal.signalType}]
                    </strong>{" "}
                    {acc.latestSignal.title}
                  </span>
                </div>
              )}

              <div className="flex items-center justify-between text-xs text-muted">
                <span>{acc.openActionsCount} open next action(s)</span>
                <span>
                  {acc.lastActivityAt
                    ? `Last activity ${new Date(acc.lastActivityAt).toLocaleDateString("en-GB")}`
                    : "No logged outreach yet"}
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}

      {/* Modal: Add Gold Account from Folk CRM */}
      {showAdd && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-2xl rounded-2xl border border-border bg-surface p-6 space-y-4 max-h-[88vh] flex flex-col">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold">
                Add Gold-List Company from Folk CRM
              </h2>
              <button
                type="button"
                onClick={() => setShowAdd(false)}
                className="text-muted hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {error && (
              <div className="rounded-lg border border-danger/40 bg-danger/10 p-3 text-xs text-danger">
                {error}
              </div>
            )}

            <form
              onSubmit={(e) => {
                e.preventDefault();
                searchFolkCompanies(companyQuery);
              }}
              className="flex gap-2"
            >
              <div className="relative flex-1">
                <Search className="h-4 w-4 text-muted absolute left-3 top-2.5" />
                <input
                  type="text"
                  value={companyQuery}
                  onChange={(e) => setCompanyQuery(e.target.value)}
                  placeholder="Search Folk companies by name, domain, or industry..."
                  className="w-full rounded-lg border border-border bg-surface-elevated pl-9 pr-3 py-2 text-xs"
                />
              </div>
              <button
                type="submit"
                disabled={searching}
                className="rounded-lg bg-accent px-4 py-2 text-xs font-semibold text-accent-foreground"
              >
                {searching ? "Searching..." : "Search"}
              </button>
            </form>

            {!folkConfigured ? (
              <p className="text-xs text-warning">
                FOLK_API_KEY is not configured.
              </p>
            ) : (
              <div className="overflow-y-auto space-y-1.5 max-h-48 pr-1">
                {folkCompanies.map((c) => {
                  const isSelected =
                    selectedCompany?.folkCompanyId === c.folkCompanyId;
                  const alreadyAdded = accounts.some(
                    (a) => a.folkCompanyId === c.folkCompanyId,
                  );
                  return (
                    <button
                      key={c.folkCompanyId}
                      type="button"
                      disabled={alreadyAdded}
                      onClick={() => setSelectedCompany(c)}
                      className={`w-full text-left flex items-center justify-between gap-3 rounded-lg border p-2.5 text-xs transition-colors ${
                        isSelected
                          ? "border-accent bg-accent/15"
                          : "border-border bg-surface-elevated hover:border-accent/40"
                      } disabled:opacity-40`}
                    >
                      <div>
                        <p className="font-medium text-foreground">{c.name}</p>
                        <p className="text-muted">
                          {[c.domain, c.industries.join(", ")]
                            .filter(Boolean)
                            .join(" · ") || c.folkCompanyId}
                        </p>
                      </div>
                      <span className="font-mono text-[11px] text-muted">
                        {alreadyAdded
                          ? "Already added"
                          : isSelected
                            ? "Selected"
                            : "Select"}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}

            <form
              onSubmit={handleCreate}
              className="space-y-3 border-t border-border pt-3 text-xs"
            >
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-muted block mb-1">
                    Account Owner (50-company cap)
                  </label>
                  <select
                    value={selectedOwnerId}
                    onChange={(e) => setSelectedOwnerId(e.target.value)}
                    className="w-full rounded-lg border border-border bg-surface-elevated px-3 py-2 text-xs"
                  >
                    {founders.map((f) => {
                      const count = ownerCounts[f.id] ?? 0;
                      return (
                        <option key={f.id} value={f.id}>
                          {f.name} ({count} / {MAX_GOLD_ACCOUNTS_PER_FOUNDER})
                        </option>
                      );
                    })}
                  </select>
                </div>
                <div>
                  <label className="text-muted block mb-1">
                    Marketing Team Size (ICP &gt; 10)
                  </label>
                  <input
                    type="number"
                    min={0}
                    value={teamSize}
                    onChange={(e) => setTeamSize(e.target.value)}
                    placeholder="e.g. 18"
                    className="w-full rounded-lg border border-border bg-surface-elevated px-3 py-2 text-xs"
                  />
                </div>
              </div>

              <div>
                <label className="text-muted block mb-1">
                  Legacy Technology / Setup Notes
                </label>
                <input
                  type="text"
                  value={legacyNotes}
                  onChange={(e) => setLegacyNotes(e.target.value)}
                  placeholder="e.g. Disconnected CRM/CMS stack"
                  className="w-full rounded-lg border border-border bg-surface-elevated px-3 py-2 text-xs"
                />
              </div>

              {selectedOwnerAtCap && (
                <div className="rounded-lg border border-warning/40 bg-warning/10 p-2.5 text-warning flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 shrink-0" />
                  <span>
                    Selected founder is already at 50 / 50 active companies.
                    Choose the other founder or archive an existing account.
                  </span>
                </div>
              )}

              <div className="flex justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setShowAdd(false)}
                  className="rounded-lg border border-border px-4 py-2 text-xs text-muted"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving || !selectedCompany || selectedOwnerAtCap}
                  className="rounded-lg bg-accent px-4 py-2 text-xs font-semibold text-accent-foreground disabled:opacity-40"
                >
                  {saving ? "Adding..." : "Add to Gold List"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
