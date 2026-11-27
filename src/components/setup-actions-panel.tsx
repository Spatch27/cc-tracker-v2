"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Copy, Database, Play, Sparkles } from "lucide-react";
import type { FolkProbeReport } from "@/lib/folk/probe";

export function SetupActionsPanel({
  dbReady,
  databaseConfigured,
  folkConfigured,
}: {
  dbReady: boolean;
  databaseConfigured: boolean;
  folkConfigured: boolean;
}) {
  const router = useRouter();
  const [migrating, setMigrating] = useState(false);
  const [migrateMsg, setMigrateMsg] = useState<string | null>(null);
  const [migrateErr, setMigrateErr] = useState<string | null>(null);

  const [probing, setProbing] = useState(false);
  const [probeErr, setProbeErr] = useState<string | null>(null);
  const [report, setReport] = useState<FolkProbeReport | null>(null);
  const [copied, setCopied] = useState(false);

  async function handleMigrate() {
    setMigrating(true);
    setMigrateMsg(null);
    setMigrateErr(null);
    try {
      const res = await fetch("/api/admin/migrate", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setMigrateErr(data.error ?? "Database migration failed");
        return;
      }
      setMigrateMsg(data.message ?? "Database tables created.");
      router.refresh();
    } catch {
      setMigrateErr("Network error while running database migration.");
    } finally {
      setMigrating(false);
    }
  }

  async function handleProbe() {
    setProbing(true);
    setProbeErr(null);
    try {
      const res = await fetch("/api/admin/folk-probe", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setProbeErr(data.error ?? "Folk API probe failed");
        return;
      }
      setReport(data.report);
      router.refresh();
    } catch {
      setProbeErr("Network error while running Folk API probe.");
    } finally {
      setProbing(false);
    }
  }

  async function handleCopyMarkdown() {
    if (!report) return;
    await navigator.clipboard.writeText(report.markdownReport);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          onClick={handleMigrate}
          disabled={migrating || !databaseConfigured}
          className="inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-xs font-semibold text-accent-foreground hover:opacity-90 disabled:opacity-40 transition-opacity"
        >
          <Database className="h-3.5 w-3.5" />
          {migrating
            ? "Creating Postgres Tables..."
            : dbReady
              ? "Re-check / Update Database Tables"
              : "Initialize Database Tables"}
        </button>

        <button
          type="button"
          onClick={handleProbe}
          disabled={probing || !folkConfigured}
          className="inline-flex items-center gap-2 rounded-lg border border-border bg-surface-elevated px-4 py-2 text-xs font-semibold text-foreground hover:border-accent/60 disabled:opacity-40 transition-colors"
        >
          <Play className="h-3.5 w-3.5 text-accent" />
          {probing ? "Probing Folk (Read-Only)..." : "Run Read-Only Folk API Probe"}
        </button>
      </div>

      {migrateMsg && (
        <div className="rounded-lg border border-success/40 bg-success/10 p-3 text-xs text-success">
          {migrateMsg}
        </div>
      )}
      {migrateErr && (
        <div className="rounded-lg border border-danger/40 bg-danger/10 p-3 text-xs text-danger">
          {migrateErr}
        </div>
      )}
      {probeErr && (
        <div className="rounded-lg border border-danger/40 bg-danger/10 p-3 text-xs text-danger">
          {probeErr}
        </div>
      )}

      {report && (
        <div className="rounded-xl border border-border bg-surface-elevated p-4 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-xs font-medium text-foreground">
              <Sparkles className="h-3.5 w-3.5 text-accent" />
              <span>Phase 0 Folk Capability Report (Read-Only, PII Redacted)</span>
            </div>
            <button
              type="button"
              onClick={handleCopyMarkdown}
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 py-1 text-xs text-muted hover:text-foreground"
            >
              {copied ? (
                <>
                  <Check className="h-3 w-3 text-success" /> Copied
                </>
              ) : (
                <>
                  <Copy className="h-3 w-3" /> Copy Markdown Report
                </>
              )}
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-border text-muted">
                <tr>
                  <th className="py-1.5 pr-3">Endpoint</th>
                  <th className="py-1.5 pr-3">Status</th>
                  <th className="py-1.5 pr-3">Items</th>
                  <th className="py-1.5 pr-3">Cursor</th>
                  <th className="py-1.5">Notes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {report.results.map((r) => (
                  <tr key={r.endpoint}>
                    <td className="py-1.5 pr-3 font-mono text-foreground">
                      {r.endpoint}
                    </td>
                    <td
                      className={`py-1.5 pr-3 font-mono ${
                        r.status === "OK" ? "text-success" : "text-danger"
                      }`}
                    >
                      {r.status}
                    </td>
                    <td className="py-1.5 pr-3 font-mono">{r.itemCount}</td>
                    <td className="py-1.5 pr-3">
                      {r.hasNextCursor ? "yes" : "no"}
                    </td>
                    <td className="py-1.5 text-muted">{r.notes}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <ul className="text-xs text-muted list-disc pl-5 space-y-1">
            {report.observations.map((obs) => (
              <li key={obs}>{obs}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
