"use client";

import { useState } from "react";
import Link from "next/link";
import * as XLSX from "xlsx";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  ClipboardCheck,
  FileSpreadsheet,
  RefreshCw,
  Upload,
} from "lucide-react";
import {
  parseBreakfast2Grid,
  type FolkMatchCandidate,
  type ParsedBreakfastSheet,
  type RowMatchResult,
} from "@/lib/breakfasts/import-parser";

interface ExistingEventOption {
  id: string;
  locale: string;
  title: string;
  eventDate: string;
  status: string;
}

interface PreviewRow {
  rowNumber: number;
  rawName: string;
  companyHint: string | null;
  roleHint: string | null;
  notes: string | null;
  match: RowMatchResult;
  alreadyOnEventIds: string[];
  contactSuppressed: boolean;
  candidateAnnotations: Record<
    string,
    { alreadyOnEventIds: string[]; contactSuppressed: boolean }
  >;
}

interface PreviewBlock {
  locale: string;
  headerLabel: string;
  dateLabel: string | null;
  stoppedAtMarker: string | null;
  suggestedEventId: string | null;
  rows: PreviewRow[];
}

interface PreviewResponse {
  folkPeopleTotal: number;
  folkPagesFetched: number;
  folkTruncated: boolean;
  existingEvents: ExistingEventOption[];
  blocks: PreviewBlock[];
}

interface ApplyResult {
  importedCount: number;
  skippedAlreadyOnEvent: number;
  skippedSuppressed: number;
  queuedForReviewCount: number;
  perEventCounts: Record<
    string,
    { imported: number; skippedAlreadyOnEvent: number; skippedSuppressed: number }
  >;
}

interface RowDecision {
  selectedFolkId: string; // "" means "not in Folk / none of these"
  includeImport: boolean;
  flagToReview: boolean;
}

function rowKey(locale: string, rowNumber: number): string {
  return `${locale}:${rowNumber}`;
}

export function BreakfastImportClient({
  databaseConfigured,
  folkConfigured,
}: {
  databaseConfigured: boolean;
  folkConfigured: boolean;
}) {
  const [fileName, setFileName] = useState<string | null>(null);
  const [workbook, setWorkbook] = useState<XLSX.WorkBook | null>(null);
  const [sheetNames, setSheetNames] = useState<string[]>([]);
  const [selectedSheet, setSelectedSheet] = useState<string>("");
  const [parsedSheet, setParsedSheet] = useState<ParsedBreakfastSheet | null>(
    null,
  );
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [targetEventByLocale, setTargetEventByLocale] = useState<
    Record<string, string>
  >({});
  const [decisions, setDecisions] = useState<Record<string, RowDecision>>({});
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [applying, setApplying] = useState(false);
  const [applyResult, setApplyResult] = useState<ApplyResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function runPreviewForGrid(wb: XLSX.WorkBook, sheetName: string) {
    setError(null);
    setApplyResult(null);
    const sheet = wb.Sheets[sheetName];
    if (!sheet) {
      setError(`Sheet "${sheetName}" not found in workbook.`);
      return;
    }

    const grid = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
      header: 1,
      defval: "",
    });
    const parsed = parseBreakfast2Grid(grid);
    setParsedSheet(parsed);

    if (parsed.blocks.length === 0) {
      setPreview(null);
      setError(
        `Could not find Bristol / London / Exeter blocks in tab "${sheetName}". Try selecting the Breakfast2 tab.`,
      );
      return;
    }

    setLoadingPreview(true);
    try {
      const res = await fetch("/api/breakfasts/import/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ blocks: parsed.blocks }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Failed to match spreadsheet against Folk CRM");
        return;
      }

      const typed = data as PreviewResponse;
      setPreview(typed);

      const initialTargets: Record<string, string> = {};
      const initialDecisions: Record<string, RowDecision> = {};

      for (const block of typed.blocks) {
        const targetId = block.suggestedEventId ?? typed.existingEvents[0]?.id ?? "";
        initialTargets[block.locale] = targetId;

        for (const row of block.rows) {
          const key = rowKey(block.locale, row.rowNumber);
          const best = row.match.bestMatch;
          const selectedFolkId =
            row.match.status === "matched" || row.match.status === "fuzzy"
              ? (best?.folkPersonId ?? "")
              : "";
          const ann = selectedFolkId
            ? row.candidateAnnotations[selectedFolkId]
            : null;
          const alreadyOnTarget =
            Boolean(targetId) && Boolean(ann?.alreadyOnEventIds.includes(targetId));
          const suppressed = Boolean(ann?.contactSuppressed);

          const shouldImport =
            Boolean(selectedFolkId) && !alreadyOnTarget && !suppressed;
          const shouldFlagReview = !selectedFolkId;

          initialDecisions[key] = {
            selectedFolkId,
            includeImport: shouldImport,
            flagToReview: shouldFlagReview,
          };
        }
      }

      setTargetEventByLocale(initialTargets);
      setDecisions(initialDecisions);
    } catch {
      setError("Network error contacting Folk CRM preview endpoint");
    } finally {
      setLoadingPreview(false);
    }
  }

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    setFileName(file.name);

    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      setWorkbook(wb);
      setSheetNames(wb.SheetNames);

      const preferred =
        wb.SheetNames.find((n) => n.toLowerCase() === "breakfast2") ??
        wb.SheetNames.find((n) => n.toLowerCase().includes("breakfast2")) ??
        wb.SheetNames[0] ??
        "";
      setSelectedSheet(preferred);
      if (preferred) {
        await runPreviewForGrid(wb, preferred);
      }
    } catch {
      setError("Could not read spreadsheet file. Please upload a .xlsx or .csv file.");
    }
  }

  function updateRowDecision(key: string, patch: Partial<RowDecision>) {
    setDecisions((prev) => ({
      ...prev,
      [key]: { ...(prev[key] ?? { selectedFolkId: "", includeImport: false, flagToReview: false }), ...patch },
    }));
  }

  function getSelectedCandidate(
    row: PreviewRow,
    decision: RowDecision | undefined,
  ): FolkMatchCandidate | null {
    const id = decision?.selectedFolkId;
    if (!id) return null;
    if (row.match.bestMatch?.folkPersonId === id) return row.match.bestMatch;
    return row.match.candidates.find((c) => c.folkPersonId === id) ?? null;
  }

  function isAlreadyOnTarget(
    row: PreviewRow,
    folkId: string,
    targetEventId: string,
  ): boolean {
    if (!folkId || !targetEventId) return false;
    const ann = row.candidateAnnotations[folkId];
    return ann ? ann.alreadyOnEventIds.includes(targetEventId) : false;
  }

  function isSuppressed(row: PreviewRow, folkId: string): boolean {
    if (!folkId) return false;
    return Boolean(row.candidateAnnotations[folkId]?.contactSuppressed);
  }

  // Compute live summary metrics from current selections
  let totalParsed = 0;
  let totalExact = 0;
  let totalFuzzy = 0;
  let totalAmbiguous = 0;
  let totalUnmatched = 0;
  let selectedImportCount = 0;
  let selectedReviewFlagCount = 0;

  if (preview) {
    for (const block of preview.blocks) {
      const targetId = targetEventByLocale[block.locale] ?? "";
      for (const row of block.rows) {
        totalParsed += 1;
        if (row.match.status === "matched") totalExact += 1;
        else if (row.match.status === "fuzzy") totalFuzzy += 1;
        else if (row.match.status === "ambiguous") totalAmbiguous += 1;
        else totalUnmatched += 1;

        const d = decisions[rowKey(block.locale, row.rowNumber)];
        if (!d) continue;
        if (
          d.includeImport &&
          d.selectedFolkId &&
          targetId &&
          !isAlreadyOnTarget(row, d.selectedFolkId, targetId) &&
          !isSuppressed(row, d.selectedFolkId)
        ) {
          selectedImportCount += 1;
        }
        if (d.flagToReview && !d.selectedFolkId && targetId) {
          selectedReviewFlagCount += 1;
        }
      }
    }
  }

  async function handleApply() {
    if (!preview) return;
    setError(null);
    setApplying(true);

    try {
      const importsByEvent = new Map<
        string,
        Array<{
          folkPersonId: string;
          fullName: string;
          email: string | null;
          jobTitle: string | null;
          folkCompanyId: string | null;
          companyName: string | null;
          linkedinUrl: string | null;
          sheetNotes: string | null;
        }>
      >();
      const flagUnmatched: Array<{
        targetEventId: string;
        locale: string;
        rawName: string;
        companyHint: string | null;
        roleHint: string | null;
        sheetNotes: string | null;
      }> = [];

      for (const block of preview.blocks) {
        const targetEventId = targetEventByLocale[block.locale];
        if (!targetEventId) continue;

        for (const row of block.rows) {
          const d = decisions[rowKey(block.locale, row.rowNumber)];
          if (!d) continue;

          if (
            d.includeImport &&
            d.selectedFolkId &&
            !isAlreadyOnTarget(row, d.selectedFolkId, targetEventId) &&
            !isSuppressed(row, d.selectedFolkId)
          ) {
            const candidate = getSelectedCandidate(row, d);
            if (!candidate) continue;
            const list = importsByEvent.get(targetEventId) ?? [];
            list.push({
              folkPersonId: candidate.folkPersonId,
              fullName: candidate.fullName,
              email: candidate.email,
              jobTitle: candidate.jobTitle,
              folkCompanyId: candidate.folkCompanyId,
              companyName: candidate.companyName,
              linkedinUrl: candidate.linkedinUrl,
              sheetNotes: row.notes,
            });
            importsByEvent.set(targetEventId, list);
          } else if (d.flagToReview && !d.selectedFolkId) {
            flagUnmatched.push({
              targetEventId,
              locale: block.locale,
              rawName: row.rawName,
              companyHint: row.companyHint,
              roleHint: row.roleHint,
              sheetNotes: row.notes,
            });
          }
        }
      }

      const imports = Array.from(importsByEvent.entries()).map(
        ([targetEventId, items]) => ({ targetEventId, items }),
      );

      const res = await fetch("/api/breakfasts/import/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imports, flagUnmatched }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Failed to apply breakfast import");
        return;
      }

      setApplyResult(data as ApplyResult);
    } catch {
      setError("Network error applying breakfast import");
    } finally {
      setApplying(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/breakfasts"
          className="inline-flex items-center gap-1.5 text-xs text-muted hover:text-foreground mb-2"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to CMO Breakfasts
        </Link>

        <div className="flex items-center gap-2">
          <FileSpreadsheet className="h-5 w-5 text-accent" />
          <h1 className="text-2xl font-semibold tracking-tight">
            Import Breakfast Invites from Excel
          </h1>
        </div>
        <p className="text-sm text-muted mt-1">
          Dry-run matcher against your Folk CRM contacts. Only imports the main
          invite lists (automatically skips <strong>HOLD</strong>,{" "}
          <strong>LEAVE</strong>, and <strong>ATTENDED IN NOV</strong>), and
          sends any names not in Folk to your <strong>Review Queue</strong>.
        </p>
      </div>

      {(!databaseConfigured || !folkConfigured) && (
        <div className="rounded-xl border border-warning/40 bg-warning/10 p-4 text-xs text-warning">
          Both Postgres and <code>FOLK_API_KEY</code> must be configured before
          running the Folk dry-run importer.
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
            <span>Import Complete</span>
          </div>
          <p className="text-xs text-foreground">
            Added <strong>{applyResult.importedCount}</strong> provisional
            invitee(s) across your breakfasts ({applyResult.skippedAlreadyOnEvent}{" "}
            already on list, {applyResult.skippedSuppressed} skipped as Do Not
            Contact). Queued <strong>{applyResult.queuedForReviewCount}</strong>{" "}
            not-in-Folk contact(s) into the Review Queue.
          </p>
          <div className="flex flex-wrap gap-2 pt-1">
            {Object.entries(applyResult.perEventCounts).map(([eventId, stats]) => {
              const ev = preview?.existingEvents.find((e) => e.id === eventId);
              return (
                <Link
                  key={eventId}
                  href={`/breakfasts/${eventId}`}
                  className="rounded-lg border border-success/40 bg-surface px-3 py-1.5 text-xs font-medium text-foreground hover:border-accent"
                >
                  Open {ev?.title ?? "Breakfast"} (+{stats.imported}) →
                </Link>
              );
            })}
            {applyResult.queuedForReviewCount > 0 && (
              <Link
                href="/reviews"
                className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-accent-foreground"
              >
                <ClipboardCheck className="h-3.5 w-3.5" />
                Open Review Queue ({applyResult.queuedForReviewCount} flagged) →
              </Link>
            )}
          </div>
        </div>
      )}

      {/* Step 1: Upload & sheet selection */}
      <div className="rounded-xl border border-border bg-surface p-5 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-1">
            <h2 className="text-sm font-semibold text-foreground">
              1. Upload Outreach Excel Workbook (.xlsx / .csv)
            </h2>
            <p className="text-xs text-muted">
              Parsed privately in your browser first; nothing is saved until you
              confirm the dry-run preview below.
            </p>
          </div>

          <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg bg-accent px-4 py-2 text-xs font-semibold text-accent-foreground hover:opacity-90 shrink-0">
            <Upload className="h-3.5 w-3.5" />
            <span>{fileName ? "Choose Different File" : "Select Excel File"}</span>
            <input
              type="file"
              accept=".xlsx,.xls,.csv"
              onChange={handleFileUpload}
              className="hidden"
            />
          </label>
        </div>

        {sheetNames.length > 0 && (
          <div className="flex flex-wrap items-center gap-3 pt-2 border-t border-border text-xs">
            <span className="text-muted">File: {fileName}</span>
            <div className="flex items-center gap-2">
              <label className="text-muted">Tab:</label>
              <select
                value={selectedSheet}
                onChange={async (e) => {
                  const next = e.target.value;
                  setSelectedSheet(next);
                  if (workbook) await runPreviewForGrid(workbook, next);
                }}
                className="rounded-lg border border-border bg-surface-elevated px-2.5 py-1 text-xs text-foreground"
              >
                {sheetNames.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </div>
            {workbook && selectedSheet && (
              <button
                type="button"
                disabled={loadingPreview}
                onClick={() => runPreviewForGrid(workbook, selectedSheet)}
                className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1 text-xs text-muted hover:text-foreground"
              >
                <RefreshCw
                  className={`h-3 w-3 ${loadingPreview ? "animate-spin" : ""}`}
                />
                Re-run Folk Match
              </button>
            )}
          </div>
        )}

        {parsedSheet && parsedSheet.ignoredMarkers.length > 0 && (
          <p className="text-xs text-muted">
            Detected and excluded sections:{" "}
            <span className="text-foreground font-mono">
              {parsedSheet.ignoredMarkers.join(", ")}
            </span>
          </p>
        )}
      </div>

      {loadingPreview && (
        <div className="rounded-xl border border-border bg-surface p-8 text-center text-xs text-muted">
          Searching all Folk CRM contacts and matching Bristol, London, and
          Exeter rows...
        </div>
      )}

      {/* Step 2: Dry-Run Preview */}
      {preview && !loadingPreview && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            <div className="rounded-xl border border-border bg-surface p-3.5 text-xs">
              <span className="text-muted block">Folk Contacts Searched</span>
              <span className="text-lg font-semibold text-foreground">
                {preview.folkPeopleTotal}
              </span>
              {preview.folkTruncated && (
                <span className="text-[11px] text-warning block">
                  Page limit reached
                </span>
              )}
            </div>
            <div className="rounded-xl border border-border bg-surface p-3.5 text-xs">
              <span className="text-muted block">Main-List Rows</span>
              <span className="text-lg font-semibold text-foreground">
                {totalParsed}
              </span>
            </div>
            <div className="rounded-xl border border-border bg-surface p-3.5 text-xs">
              <span className="text-muted block">Exact / Matched</span>
              <span className="text-lg font-semibold text-success">
                {totalExact}
              </span>
            </div>
            <div className="rounded-xl border border-border bg-surface p-3.5 text-xs">
              <span className="text-muted block">Fuzzy / Ambiguous</span>
              <span className="text-lg font-semibold text-warning">
                {totalFuzzy + totalAmbiguous}
              </span>
            </div>
            <div className="rounded-xl border border-border bg-surface p-3.5 text-xs">
              <span className="text-muted block">Not in Folk</span>
              <span className="text-lg font-semibold text-accent">
                {totalUnmatched}
              </span>
            </div>
          </div>

          {preview.blocks.map((block) => {
            const targetId = targetEventByLocale[block.locale] ?? "";
            return (
              <div
                key={block.locale}
                className="rounded-xl border border-border bg-surface p-5 space-y-4"
              >
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <h2 className="text-base font-semibold text-foreground">
                      {block.locale} ({block.rows.length} contacts)
                    </h2>
                    <p className="text-xs text-muted">
                      Sheet header: {block.headerLabel}
                      {block.dateLabel ? ` · ${block.dateLabel}` : ""}
                      {block.stoppedAtMarker
                        ? ` · Stopped before "${block.stoppedAtMarker}"`
                        : ""}
                    </p>
                  </div>

                  <div className="flex items-center gap-2 text-xs">
                    <span className="text-muted">Target Breakfast:</span>
                    <select
                      value={targetId}
                      onChange={(e) => {
                        const nextTargetId = e.target.value;
                        setTargetEventByLocale((prev) => ({
                          ...prev,
                          [block.locale]: nextTargetId,
                        }));
                        // Re-evaluate already-on-event flags for rows in this block
                        setDecisions((prev) => {
                          const updated = { ...prev };
                          for (const r of block.rows) {
                            const k = rowKey(block.locale, r.rowNumber);
                            const curr = updated[k];
                            if (!curr) continue;
                            if (curr.selectedFolkId) {
                              const blocked =
                                isAlreadyOnTarget(r, curr.selectedFolkId, nextTargetId) ||
                                isSuppressed(r, curr.selectedFolkId);
                              updated[k] = {
                                ...curr,
                                includeImport: !blocked,
                              };
                            }
                          }
                          return updated;
                        });
                      }}
                      className="rounded-lg border border-border bg-surface-elevated px-3 py-1.5 text-xs text-foreground"
                    >
                      <option value="">— Select breakfast —</option>
                      {preview.existingEvents.map((ev) => (
                        <option key={ev.id} value={ev.id}>
                          {ev.title} ({ev.locale})
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
                        <th className="px-3 py-2 font-medium">Sheet Contact</th>
                        <th className="px-3 py-2 font-medium">Status</th>
                        <th className="px-3 py-2 font-medium">Folk Match</th>
                        <th className="px-3 py-2 font-medium">Sheet Notes</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {block.rows.map((row) => {
                        const k = rowKey(block.locale, row.rowNumber);
                        const d = decisions[k];
                        const selectedFolkId = d?.selectedFolkId ?? "";
                        const candidate = getSelectedCandidate(row, d);
                        const already = isAlreadyOnTarget(
                          row,
                          selectedFolkId,
                          targetId,
                        );
                        const suppressed = isSuppressed(row, selectedFolkId);

                        return (
                          <tr key={k}>
                            <td className="px-3 py-2.5 whitespace-nowrap">
                              {already ? (
                                <span className="text-muted font-mono">
                                  Already on list
                                </span>
                              ) : suppressed ? (
                                <span className="text-danger font-mono">
                                  Do Not Contact
                                </span>
                              ) : selectedFolkId ? (
                                <label className="inline-flex items-center gap-1.5 cursor-pointer">
                                  <input
                                    type="checkbox"
                                    checked={Boolean(d?.includeImport)}
                                    onChange={(e) =>
                                      updateRowDecision(k, {
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
                                    checked={Boolean(d?.flagToReview)}
                                    onChange={(e) =>
                                      updateRowDecision(k, {
                                        flagToReview: e.target.checked,
                                      })
                                    }
                                  />
                                  <span className="text-accent">
                                    Flag to Review Queue
                                  </span>
                                </label>
                              )}
                            </td>

                            <td className="px-3 py-2.5">
                              <p className="font-medium text-foreground">
                                {row.rawName}
                              </p>
                              {(row.companyHint || row.roleHint) && (
                                <p className="text-[11px] text-muted">
                                  {[row.companyHint, row.roleHint]
                                    .filter(Boolean)
                                    .join(" · ")}
                                </p>
                              )}
                            </td>

                            <td className="px-3 py-2.5 whitespace-nowrap">
                              {already ? (
                                <span className="rounded-full border border-border bg-surface-elevated px-2 py-0.5 text-[11px] text-muted">
                                  already added
                                </span>
                              ) : row.match.status === "matched" &&
                                selectedFolkId ? (
                                <span className="rounded-full border border-success/40 bg-success/10 px-2 py-0.5 text-[11px] text-success">
                                  matched
                                </span>
                              ) : row.match.status === "fuzzy" && selectedFolkId ? (
                                <span className="inline-flex items-center gap-1 rounded-full border border-warning/40 bg-warning/10 px-2 py-0.5 text-[11px] text-warning">
                                  <AlertTriangle className="h-3 w-3" />
                                  fuzzy check
                                </span>
                              ) : row.match.status === "ambiguous" &&
                                !selectedFolkId ? (
                                <span className="rounded-full border border-warning/40 bg-warning/10 px-2 py-0.5 text-[11px] text-warning">
                                  pick contact
                                </span>
                              ) : (
                                <span className="rounded-full border border-accent/40 bg-accent/10 px-2 py-0.5 text-[11px] text-accent">
                                  not in Folk
                                </span>
                              )}
                            </td>

                            <td className="px-3 py-2.5">
                              {row.match.candidates.length > 0 ? (
                                <div className="space-y-1">
                                  <select
                                    value={selectedFolkId}
                                    onChange={(e) => {
                                      const nextId = e.target.value;
                                      const blocked =
                                        !nextId ||
                                        isAlreadyOnTarget(row, nextId, targetId) ||
                                        isSuppressed(row, nextId);
                                      updateRowDecision(k, {
                                        selectedFolkId: nextId,
                                        includeImport: Boolean(nextId) && !blocked,
                                        flagToReview: !nextId,
                                      });
                                    }}
                                    className="w-full max-w-xs rounded-lg border border-border bg-surface-elevated px-2 py-1 text-xs text-foreground"
                                  >
                                    <option value="">
                                      — None of these (flag to Review Queue) —
                                    </option>
                                    {row.match.candidates.map((c) => (
                                      <option
                                        key={c.folkPersonId}
                                        value={c.folkPersonId}
                                      >
                                        {c.fullName}
                                        {c.companyName ? ` (${c.companyName})` : ""}
                                        {c.email ? ` — ${c.email}` : ""}
                                      </option>
                                    ))}
                                  </select>
                                  {candidate && (
                                    <p className="text-[11px] text-muted">
                                      {candidate.scoreReason}
                                      {candidate.email ? ` · ${candidate.email}` : ""}
                                    </p>
                                  )}
                                </div>
                              ) : (
                                <span className="text-[11px] text-muted">
                                  {row.match.matchReason}
                                </span>
                              )}
                            </td>

                            <td className="px-3 py-2.5 text-muted max-w-[200px]">
                              {row.notes ?? "—"}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })}

          <div className="rounded-xl border border-border bg-surface p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="text-xs text-muted">
              Ready to import{" "}
              <strong className="text-foreground">{selectedImportCount}</strong>{" "}
              matched contact(s) as provisional invitees and flag{" "}
              <strong className="text-foreground">
                {selectedReviewFlagCount}
              </strong>{" "}
              not-in-Folk contact(s) into the Review Queue.
            </div>
            <button
              type="button"
              disabled={
                applying ||
                (selectedImportCount === 0 && selectedReviewFlagCount === 0)
              }
              onClick={handleApply}
              className="rounded-lg bg-accent px-5 py-2.5 text-xs font-semibold text-accent-foreground hover:opacity-90 disabled:opacity-40"
            >
              {applying
                ? "Importing..."
                : `Confirm & Import (${selectedImportCount} + ${selectedReviewFlagCount} flagged)`}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
