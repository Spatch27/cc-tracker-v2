"use client";

import { useState } from "react";
import Link from "next/link";
import * as XLSX from "xlsx";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  ClipboardCheck,
  Crown,
  FileSpreadsheet,
  ShieldBan,
  Upload,
} from "lucide-react";
import type { RowMatchResult } from "@/lib/breakfasts/import-parser";
import type { FounderOption } from "@/lib/founders";
import {
  isApprovedGoldTabName,
  parseGoldListTab,
  type GoldCompanyMatchResult,
  type ParsedGoldAccountRow,
} from "@/lib/gold-lists/import-parser";
import { MAX_GOLD_ACCOUNTS_PER_FOUNDER } from "@/lib/gold-lists/rules";

interface PreviewGoldRow extends ParsedGoldAccountRow {
  inferredRoleCategory:
    | "cmo"
    | "vp_marketing"
    | "marketing_director"
    | "marketing_ops"
    | "other";
  companyMatch: GoldCompanyMatchResult;
  contactMatch: RowMatchResult | null;
  alreadyOnGoldList: boolean;
  existingGoldOwnerName: string | null;
  duplicateInBatch: boolean;
}

interface PreviewTab {
  tabName: string;
  defaultOwnerUserId: string;
  rows: PreviewGoldRow[];
}

interface PreviewResponse {
  folkCompaniesTotal: number;
  folkPeopleTotal: number;
  founders: FounderOption[];
  existingOwnerCounts: Record<string, number>;
  tabs: PreviewTab[];
}

interface ApplyResult {
  importedAccountsCount: number;
  mappedContactsCount: number;
  contactGapsCount: number;
  signalsSeededCount: number;
  skippedAlreadyOnGoldList: number;
  queuedForReviewCount: number;
  ownerCountsAfter: Record<string, number>;
}

interface RowDecision {
  selectedFolkCompanyId: string; // "" means unmatched / flag to review
  selectedFolkPersonId: string; // "" means no Folk person match
  includeImport: boolean;
  flagMissingToReview: boolean;
  flagWarningToReview: boolean;
}

function rowKey(tabName: string, rowNumber: number): string {
  return `${tabName}:${rowNumber}`;
}

export function GoldImportClient({
  databaseConfigured,
  folkConfigured,
}: {
  databaseConfigured: boolean;
  folkConfigured: boolean;
}) {
  const [fileName, setFileName] = useState<string | null>(null);
  const [approvedTabsFound, setApprovedTabsFound] = useState<string[]>([]);
  const [excludedTabs, setExcludedTabs] = useState<
    Array<{ name: string; reason: string }>
  >([]);
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [ownerByTab, setOwnerByTab] = useState<Record<string, string>>({});
  const [decisions, setDecisions] = useState<Record<string, RowDecision>>({});
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [applying, setApplying] = useState(false);
  const [applyResult, setApplyResult] = useState<ApplyResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    setApplyResult(null);
    setFileName(file.name);

    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });

      const approved: Array<{ tabName: string; rows: ParsedGoldAccountRow[] }> = [];
      const excluded: Array<{ name: string; reason: string }> = [];

      for (const name of wb.SheetNames) {
        const verdict = isApprovedGoldTabName(name);
        if (!verdict.approved) {
          excluded.push({ name, reason: verdict.reason });
          continue;
        }
        const sheet = wb.Sheets[name];
        const grid = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
          header: 1,
          defval: "",
        });
        const rows = parseGoldListTab(name, grid);
        if (rows.length > 0) {
          approved.push({ tabName: name, rows });
        }
      }

      setApprovedTabsFound(approved.map((a) => a.tabName));
      setExcludedTabs(excluded);

      if (approved.length === 0) {
        setPreview(null);
        setError(
          "Could not find 'Tim ABM' or 'Ben ABM' tabs in this workbook. Warm List, Cold list, and Top 100 tabs are excluded.",
        );
        return;
      }

      setLoadingPreview(true);
      const res = await fetch("/api/gold-lists/import/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tabs: approved }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Failed to match Gold accounts against Folk CRM");
        return;
      }

      const typed = data as PreviewResponse;
      setPreview(typed);

      const nextOwners: Record<string, string> = {};
      const nextDecisions: Record<string, RowDecision> = {};

      for (const tab of typed.tabs) {
        nextOwners[tab.tabName] =
          tab.defaultOwnerUserId || typed.founders[0]?.id || "";
        for (const row of tab.rows) {
          const key = rowKey(tab.tabName, row.rowNumber);
          const compBest =
            row.companyMatch.status === "matched" ||
            row.companyMatch.status === "fuzzy"
              ? (row.companyMatch.bestMatch?.folkCompanyId ?? "")
              : "";
          const personBest =
            row.contactMatch &&
            (row.contactMatch.status === "matched" ||
              row.contactMatch.status === "fuzzy")
              ? (row.contactMatch.bestMatch?.folkPersonId ?? "")
              : "";

          const canImport =
            Boolean(compBest) && !row.alreadyOnGoldList && !row.duplicateInBatch;

          nextDecisions[key] = {
            selectedFolkCompanyId: compBest,
            selectedFolkPersonId: personBest,
            includeImport: canImport,
            flagMissingToReview: !compBest,
            flagWarningToReview: Boolean(row.staleDataWarning) && canImport,
          };
        }
      }

      setOwnerByTab(nextOwners);
      setDecisions(nextDecisions);
    } catch {
      setError("Could not parse Excel workbook. Please upload a valid .xlsx file.");
    } finally {
      setLoadingPreview(false);
    }
  }

  function updateDecision(key: string, patch: Partial<RowDecision>) {
    setDecisions((prev) => ({
      ...prev,
      [key]: {
        ...(prev[key] ?? {
          selectedFolkCompanyId: "",
          selectedFolkPersonId: "",
          includeImport: false,
          flagMissingToReview: false,
          flagWarningToReview: false,
        }),
        ...patch,
      },
    }));
  }

  // Compute live projected owner counts & summary stats
  const projectedByOwner: Record<string, number> = preview
    ? { ...preview.existingOwnerCounts }
    : {};
  let totalRows = 0;
  let matchedCompaniesCount = 0;
  let fuzzyOrAmbiguousCount = 0;
  let missingCompanyCount = 0;
  let selectedImportCount = 0;
  let selectedReviewCount = 0;

  if (preview) {
    for (const tab of preview.tabs) {
      const ownerId = ownerByTab[tab.tabName] ?? "";
      for (const row of tab.rows) {
        totalRows += 1;
        if (row.companyMatch.status === "matched") matchedCompaniesCount += 1;
        else if (
          row.companyMatch.status === "fuzzy" ||
          row.companyMatch.status === "ambiguous"
        ) {
          fuzzyOrAmbiguousCount += 1;
        } else {
          missingCompanyCount += 1;
        }

        const d = decisions[rowKey(tab.tabName, row.rowNumber)];
        if (!d) continue;
        if (
          d.includeImport &&
          d.selectedFolkCompanyId &&
          !row.alreadyOnGoldList &&
          ownerId
        ) {
          selectedImportCount += 1;
          projectedByOwner[ownerId] = (projectedByOwner[ownerId] ?? 0) + 1;
        }
        if (!d.selectedFolkCompanyId && d.flagMissingToReview) {
          selectedReviewCount += 1;
        }
        if (d.selectedFolkCompanyId && d.flagWarningToReview && row.staleDataWarning) {
          selectedReviewCount += 1;
        }
      }
    }
  }

  const anyOwnerOverCap = preview
    ? preview.founders.some(
        (f) => (projectedByOwner[f.id] ?? 0) > MAX_GOLD_ACCOUNTS_PER_FOUNDER,
      )
    : false;

  async function handleApply() {
    if (!preview || anyOwnerOverCap) return;
    setError(null);
    setApplying(true);

    try {
      const accounts: Array<{
        tabName: string;
        ownerUserId: string;
        folkCompanyId: string;
        companyName: string;
        domain: string | null;
        legacyScoreMetadata: Record<string, unknown>;
        fitNotes: string | null;
        officeAddress: string | null;
        contact:
          | {
              mode: "folk";
              folkPersonId: string;
              fullName: string;
              email: string | null;
              jobTitle: string | null;
              linkedinUrl: string | null;
              roleCategory: PreviewGoldRow["inferredRoleCategory"];
              notes: string | null;
            }
          | {
              mode: "gap";
              roleCategory: PreviewGoldRow["inferredRoleCategory"];
              notes: string | null;
            }
          | null;
        changeSignalText: string | null;
      }> = [];

      const flagReviews: Array<{
        kind: "missing_company" | "stale_data_warning";
        tabName: string;
        companyName: string;
        folkCompanyId: string | null;
        folkPersonId: string | null;
        summary: string;
        details: string;
      }> = [];

      for (const tab of preview.tabs) {
        const ownerUserId = ownerByTab[tab.tabName];
        if (!ownerUserId) continue;

        for (const row of tab.rows) {
          const d = decisions[rowKey(tab.tabName, row.rowNumber)];
          if (!d) continue;

          const pickedCompany =
            row.companyMatch.bestMatch?.folkCompanyId === d.selectedFolkCompanyId
              ? row.companyMatch.bestMatch
              : row.companyMatch.candidates.find(
                  (c) => c.folkCompanyId === d.selectedFolkCompanyId,
                ) ?? null;

          if (d.includeImport && pickedCompany && !row.alreadyOnGoldList) {
            const pickedPerson =
              row.contactMatch && d.selectedFolkPersonId
                ? row.contactMatch.bestMatch?.folkPersonId ===
                  d.selectedFolkPersonId
                  ? row.contactMatch.bestMatch
                  : row.contactMatch.candidates.find(
                      (c) => c.folkPersonId === d.selectedFolkPersonId,
                    ) ?? null
                : null;

            const contactPayload = pickedPerson
              ? {
                  mode: "folk" as const,
                  folkPersonId: pickedPerson.folkPersonId,
                  fullName: pickedPerson.fullName,
                  email: pickedPerson.email ?? row.contactEmail,
                  jobTitle: pickedPerson.jobTitle ?? row.contactTitle,
                  linkedinUrl: pickedPerson.linkedinUrl ?? row.contactLinkedin,
                  roleCategory: row.inferredRoleCategory,
                  notes: row.relationshipNote,
                }
              : row.isContactGap || row.contactName
                ? {
                    mode: "gap" as const,
                    roleCategory: row.inferredRoleCategory,
                    notes: row.contactName
                      ? `Sheet contact not linked in Folk: ${row.contactName}${row.contactTitle ? ` (${row.contactTitle})` : ""}`
                      : row.contactTitle || "No named contact yet (TBC)",
                  }
                : null;

            accounts.push({
              tabName: tab.tabName,
              ownerUserId,
              folkCompanyId: pickedCompany.folkCompanyId,
              companyName: pickedCompany.name,
              domain: pickedCompany.domain,
              legacyScoreMetadata: row.legacyScoreMetadata,
              fitNotes: row.relationshipNote,
              officeAddress: row.officeAddress,
              contact: contactPayload,
              changeSignalText: row.changeSignals,
            });

            if (d.flagWarningToReview && row.staleDataWarning) {
              flagReviews.push({
                kind: "stale_data_warning",
                tabName: tab.tabName,
                companyName: pickedCompany.name,
                folkCompanyId: pickedCompany.folkCompanyId,
                folkPersonId: pickedPerson?.folkPersonId ?? null,
                summary: `Stale email / verification needed: ${row.contactName ?? pickedCompany.name} (${pickedCompany.name})`,
                details: row.staleDataWarning,
              });
            }
          } else if (!pickedCompany && d.flagMissingToReview) {
            flagReviews.push({
              kind: "missing_company",
              tabName: tab.tabName,
              companyName: row.companyName,
              folkCompanyId: null,
              folkPersonId: null,
              summary: `Company not in Folk (${tab.tabName}): ${row.companyName}`,
              details: [
                row.contactName ? `Contact: ${row.contactName}` : null,
                row.contactTitle ? `Title: ${row.contactTitle}` : null,
                row.staleDataWarning,
              ]
                .filter(Boolean)
                .join(" · ") || "Needs Folk company linking before adding to Gold List",
            });
          }
        }
      }

      const res = await fetch("/api/gold-lists/import/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accounts, flagReviews }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Failed to apply Gold-list import");
        return;
      }

      setApplyResult(data as ApplyResult);
    } catch {
      setError("Network error applying Gold-list import");
    } finally {
      setApplying(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/gold-lists"
          className="inline-flex items-center gap-1.5 text-xs text-muted hover:text-foreground mb-2"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to Gold Lists
        </Link>

        <div className="flex items-center gap-2">
          <FileSpreadsheet className="h-5 w-5 text-accent" />
          <h1 className="text-2xl font-semibold tracking-tight">
            Import Gold Lists from Excel
          </h1>
        </div>
        <p className="text-sm text-muted mt-1">
          Dry-run migration for <strong>Tim ABM</strong> and{" "}
          <strong>Ben ABM</strong> only. Enforces the{" "}
          <strong>50-company cap per founder</strong>, excludes Warm List / Cold
          list / Top 100 tabs, preserves legacy score notes read-only, and sends
          unmatched items or stale-email checks to your Review Queue.
        </p>
      </div>

      {(!databaseConfigured || !folkConfigured) && (
        <div className="rounded-xl border border-warning/40 bg-warning/10 p-4 text-xs text-warning">
          Postgres and <code>FOLK_API_KEY</code> must both be configured before
          running Gold-list migration.
        </div>
      )}

      {error && (
        <div className="rounded-xl border border-danger/40 bg-danger/10 p-3.5 text-xs text-danger">
          {error}
        </div>
      )}

      {applyResult && (
        <div className="rounded-xl border border-success/40 bg-success/10 p-5 space-y-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-success">
            <CheckCircle2 className="h-4 w-4" />
            <span>Gold-List Migration Complete</span>
          </div>
          <p className="text-xs text-foreground">
            Created <strong>{applyResult.importedAccountsCount}</strong> Gold
            account(s) ({applyResult.mappedContactsCount} mapped contacts,{" "}
            {applyResult.contactGapsCount} coverage gaps,{" "}
            {applyResult.signalsSeededCount} buying signals seeded,{" "}
            {applyResult.skippedAlreadyOnGoldList} skipped as already on list).
            Queued <strong>{applyResult.queuedForReviewCount}</strong>{" "}
            warning/missing item(s) in the Review Queue.
          </p>
          <div className="flex flex-wrap gap-2 pt-1">
            <Link
              href="/gold-lists"
              className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3.5 py-2 text-xs font-semibold text-accent-foreground"
            >
              <Crown className="h-3.5 w-3.5" />
              Open Gold Lists →
            </Link>
            {applyResult.queuedForReviewCount > 0 && (
              <Link
                href="/reviews"
                className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3.5 py-2 text-xs font-medium text-foreground hover:border-accent"
              >
                <ClipboardCheck className="h-3.5 w-3.5 text-accent" />
                Open Review Queue ({applyResult.queuedForReviewCount}) →
              </Link>
            )}
          </div>
        </div>
      )}

      {/* Upload Box */}
      <div className="rounded-xl border border-border bg-surface p-5 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-1">
            <h2 className="text-sm font-semibold text-foreground">
              1. Upload Outreach Excel Workbook (.xlsx)
            </h2>
            <p className="text-xs text-muted">
              Only <code>Tim ABM</code> and <code>Ben ABM</code> are read. All
              excluded tabs remain untouched.
            </p>
          </div>
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg bg-accent px-4 py-2 text-xs font-semibold text-accent-foreground hover:opacity-90 shrink-0">
            <Upload className="h-3.5 w-3.5" />
            <span>{fileName ? "Choose Different File" : "Select Excel File"}</span>
            <input
              type="file"
              accept=".xlsx,.xls"
              onChange={handleFileUpload}
              className="hidden"
            />
          </label>
        </div>

        {(approvedTabsFound.length > 0 || excludedTabs.length > 0) && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-2 border-t border-border text-xs">
            <div className="rounded-lg border border-success/30 bg-success/10 p-3">
              <span className="font-semibold text-success block mb-1">
                Approved Tabs Loaded ({approvedTabsFound.length})
              </span>
              <span className="text-foreground font-mono">
                {approvedTabsFound.join(", ") || "None"}
              </span>
            </div>
            <div className="rounded-lg border border-border bg-surface-elevated p-3">
              <span className="font-semibold text-muted flex items-center gap-1 mb-1">
                <ShieldBan className="h-3.5 w-3.5" />
                Excluded Tabs ({excludedTabs.length})
              </span>
              <span className="text-muted">
                {excludedTabs.map((t) => t.name).join(", ") || "None"}
              </span>
            </div>
          </div>
        )}
      </div>

      {loadingPreview && (
        <div className="rounded-xl border border-border bg-surface p-8 text-center text-xs text-muted">
          Matching Tim ABM &amp; Ben ABM companies and contacts against your Folk CRM
          workspace...
        </div>
      )}

      {preview && !loadingPreview && (
        <div className="space-y-6">
          {/* Founder 50-account cap gauges + summary */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {preview.founders.map((f) => {
              const current = preview.existingOwnerCounts[f.id] ?? 0;
              const projected = projectedByOwner[f.id] ?? current;
              const overCap = projected > MAX_GOLD_ACCOUNTS_PER_FOUNDER;
              return (
                <div
                  key={f.id}
                  className={`rounded-xl border p-4 text-xs ${
                    overCap
                      ? "border-danger/60 bg-danger/10 text-danger"
                      : "border-border bg-surface"
                  }`}
                >
                  <span className="text-muted block">{f.name} Cap Check</span>
                  <p className="text-lg font-semibold mt-1 text-foreground">
                    {projected} / {MAX_GOLD_ACCOUNTS_PER_FOUNDER}
                  </p>
                  <span className="text-[11px] text-muted">
                    {current} existing + {projected - current} importing
                  </span>
                </div>
              );
            })}

            <div className="rounded-xl border border-border bg-surface p-4 text-xs space-y-1">
              <span className="text-muted block">Folk Match Summary ({totalRows} rows)</span>
              <p className="text-foreground">
                <strong className="text-success">{matchedCompaniesCount}</strong>{" "}
                matched ·{" "}
                <strong className="text-warning">{fuzzyOrAmbiguousCount}</strong>{" "}
                review ·{" "}
                <strong className="text-accent">{missingCompanyCount}</strong>{" "}
                not in Folk
              </p>
              <span className="text-[11px] text-muted block">
                Searched {preview.folkCompaniesTotal} companies &amp;{" "}
                {preview.folkPeopleTotal} people
              </span>
            </div>
          </div>

          {anyOwnerOverCap && (
            <div className="rounded-xl border border-danger/40 bg-danger/10 p-4 text-xs text-danger flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              <span>
                Projected count exceeds the 50 active companies cap for one or more
                founders. Untick some accounts before applying.
              </span>
            </div>
          )}

          {preview.tabs.map((tab) => (
            <div
              key={tab.tabName}
              className="rounded-xl border border-border bg-surface p-5 space-y-4"
            >
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <h2 className="text-base font-semibold text-foreground">
                    {tab.tabName} ({tab.rows.length} accounts)
                  </h2>
                  <p className="text-xs text-muted">
                    Legacy ranks, scores, and personas are preserved read-only on
                    each imported account.
                  </p>
                </div>

                <div className="flex items-center gap-2 text-xs">
                  <span className="text-muted">Assign Owner:</span>
                  <select
                    value={ownerByTab[tab.tabName] ?? ""}
                    onChange={(e) =>
                      setOwnerByTab((prev) => ({
                        ...prev,
                        [tab.tabName]: e.target.value,
                      }))
                    }
                    className="rounded-lg border border-border bg-surface-elevated px-3 py-1.5 text-xs text-foreground"
                  >
                    {preview.founders.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="overflow-x-auto rounded-lg border border-border">
                <table className="w-full text-left text-xs">
                  <thead className="bg-surface-elevated text-muted border-b border-border">
                    <tr>
                      <th className="px-3 py-2 font-medium">Action</th>
                      <th className="px-3 py-2 font-medium">Sheet Company</th>
                      <th className="px-3 py-2 font-medium">Folk Company Match</th>
                      <th className="px-3 py-2 font-medium">Decision-Maker</th>
                      <th className="px-3 py-2 font-medium">Warnings &amp; Signals</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {tab.rows.map((row) => {
                      const k = rowKey(tab.tabName, row.rowNumber);
                      const d = decisions[k];
                      const companyOptions = row.companyMatch.candidates;
                      const selectedCompanyId = d?.selectedFolkCompanyId ?? "";

                      return (
                        <tr key={k}>
                          <td className="px-3 py-2.5 whitespace-nowrap align-top">
                            {row.alreadyOnGoldList ? (
                              <span className="text-muted font-mono">
                                Already on Gold ({row.existingGoldOwnerName})
                              </span>
                            ) : selectedCompanyId ? (
                              <label className="inline-flex items-center gap-1.5 cursor-pointer">
                                <input
                                  type="checkbox"
                                  checked={Boolean(d?.includeImport)}
                                  onChange={(e) =>
                                    updateDecision(k, {
                                      includeImport: e.target.checked,
                                    })
                                  }
                                />
                                <span className="text-foreground">Import</span>
                              </label>
                            ) : (
                              <label className="inline-flex items-center gap-1.5 cursor-pointer">
                                <input
                                  type="checkbox"
                                  checked={Boolean(d?.flagMissingToReview)}
                                  onChange={(e) =>
                                    updateDecision(k, {
                                      flagMissingToReview: e.target.checked,
                                    })
                                  }
                                />
                                <span className="text-accent">
                                  Flag to Review Queue
                                </span>
                              </label>
                            )}
                          </td>

                          <td className="px-3 py-2.5 align-top">
                            <p className="font-medium text-foreground">
                              {row.companyName}
                            </p>
                            {row.duplicateInBatch && (
                              <span className="rounded bg-warning/15 text-warning px-1.5 py-0.5 text-[10px]">
                                Duplicate across tabs
                              </span>
                            )}
                            {Boolean(row.legacyScoreMetadata.rank) && (
                              <p className="text-[11px] text-muted">
                                Rank #{String(row.legacyScoreMetadata.rank)}
                                {row.legacyScoreMetadata.totalScore
                                  ? ` · Score ${String(row.legacyScoreMetadata.totalScore)}`
                                  : ""}
                              </p>
                            )}
                          </td>

                          <td className="px-3 py-2.5 align-top">
                            {companyOptions.length > 0 ? (
                              <div className="space-y-1">
                                <select
                                  value={selectedCompanyId}
                                  onChange={(e) => {
                                    const nextCompId = e.target.value;
                                    updateDecision(k, {
                                      selectedFolkCompanyId: nextCompId,
                                      includeImport:
                                        Boolean(nextCompId) &&
                                        !row.alreadyOnGoldList,
                                      flagMissingToReview: !nextCompId,
                                    });
                                  }}
                                  className="w-full max-w-xs rounded-lg border border-border bg-surface-elevated px-2 py-1 text-xs text-foreground"
                                >
                                  <option value="">
                                    — None (flag to Review Queue) —
                                  </option>
                                  {companyOptions.map((c) => (
                                    <option
                                      key={c.folkCompanyId}
                                      value={c.folkCompanyId}
                                    >
                                      {c.name}
                                      {c.domain ? ` (${c.domain})` : ""}
                                    </option>
                                  ))}
                                </select>
                                <p className="text-[11px] text-muted">
                                  {row.companyMatch.matchReason}
                                </p>
                              </div>
                            ) : (
                              <span className="text-[11px] text-accent">
                                {row.companyMatch.matchReason}
                              </span>
                            )}
                          </td>

                          <td className="px-3 py-2.5 align-top">
                            {row.isContactGap ? (
                              <span className="rounded-full border border-warning/40 bg-warning/10 px-2 py-0.5 text-[11px] text-warning">
                                Coverage Gap (TBC)
                              </span>
                            ) : row.contactMatch?.candidates.length ? (
                              <div className="space-y-1">
                                <select
                                  value={d?.selectedFolkPersonId ?? ""}
                                  onChange={(e) =>
                                    updateDecision(k, {
                                      selectedFolkPersonId: e.target.value,
                                    })
                                  }
                                  className="w-full max-w-[210px] rounded-lg border border-border bg-surface-elevated px-2 py-1 text-xs text-foreground"
                                >
                                  <option value="">— Gap / unlinked —</option>
                                  {row.contactMatch.candidates.map((p) => (
                                    <option
                                      key={p.folkPersonId}
                                      value={p.folkPersonId}
                                    >
                                      {p.fullName}
                                      {p.email ? ` (${p.email})` : ""}
                                    </option>
                                  ))}
                                </select>
                                <p className="text-[11px] text-muted">
                                  {row.contactTitle ?? row.inferredRoleCategory}
                                </p>
                              </div>
                            ) : (
                              <div>
                                <p className="text-foreground">
                                  {row.contactName}
                                </p>
                                <p className="text-[11px] text-warning">
                                  Not linked in Folk (logs gap)
                                </p>
                              </div>
                            )}
                          </td>

                          <td className="px-3 py-2.5 align-top max-w-[250px] space-y-1">
                            {row.staleDataWarning && (
                              <label className="flex items-start gap-1.5 text-[11px] text-warning cursor-pointer">
                                <input
                                  type="checkbox"
                                  checked={Boolean(d?.flagWarningToReview)}
                                  onChange={(e) =>
                                    updateDecision(k, {
                                      flagWarningToReview: e.target.checked,
                                    })
                                  }
                                  className="mt-0.5"
                                />
                                <span>{row.staleDataWarning}</span>
                              </label>
                            )}
                            {row.changeSignals && (
                              <p className="text-[11px] text-muted">
                                Signal: {row.changeSignals}
                              </p>
                            )}
                            {!row.staleDataWarning && !row.changeSignals && (
                              <span className="text-muted">—</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ))}

          <div className="rounded-xl border border-border bg-surface p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="text-xs text-muted">
              Ready to import{" "}
              <strong className="text-foreground">{selectedImportCount}</strong>{" "}
              Gold account(s) and queue{" "}
              <strong className="text-foreground">{selectedReviewCount}</strong>{" "}
              missing/stale-data item(s) in the Review Queue.
            </div>
            <button
              type="button"
              disabled={
                applying ||
                anyOwnerOverCap ||
                (selectedImportCount === 0 && selectedReviewCount === 0)
              }
              onClick={handleApply}
              className="rounded-lg bg-accent px-5 py-2.5 text-xs font-semibold text-accent-foreground hover:opacity-90 disabled:opacity-40"
            >
              {applying
                ? "Importing..."
                : `Confirm & Import (${selectedImportCount} + ${selectedReviewCount} flagged)`}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
