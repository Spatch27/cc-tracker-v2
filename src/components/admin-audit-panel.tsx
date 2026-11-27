"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, History, RefreshCw, Search } from "lucide-react";

export interface SerializedAuditEvent {
  id: string;
  actorType: "human" | "agent" | "system";
  actorLabel: string;
  action: string;
  entityType: string;
  entityId: string | null;
  fieldName: string | null;
  previousValueJson: unknown;
  newValueJson: unknown;
  source: string | null;
  outcome: "succeeded" | "denied" | "failed" | "pending";
  metadataJson: unknown;
  createdAt: string;
}

const OUTCOME_BADGES: Record<string, string> = {
  succeeded: "border-success/30 bg-success/10 text-success",
  denied: "border-warning/30 bg-warning/10 text-warning",
  failed: "border-danger/30 bg-danger/10 text-danger",
  pending: "border-border bg-surface text-muted",
};

export function AdminAuditPanel({
  initialEvents,
  dbReady,
}: {
  initialEvents: SerializedAuditEvent[];
  dbReady: boolean;
}) {
  const [events, setEvents] = useState<SerializedAuditEvent[]>(initialEvents);
  const [actorFilter, setActorFilter] = useState<string>("all");
  const [query, setQuery] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function refreshAudit() {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: "100" });
      if (actorFilter !== "all") params.set("actorType", actorFilter);
      if (query.trim()) params.set("q", query.trim());
      const res = await fetch(`/api/admin/audit?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        setEvents(data.events ?? []);
      }
    } finally {
      setLoading(false);
    }
  }

  const qLower = query.trim().toLowerCase();
  const visible = events.filter((ev) => {
    if (actorFilter !== "all" && ev.actorType !== actorFilter) return false;
    if (!qLower) return true;
    const hay = [
      ev.action,
      ev.entityType,
      ev.entityId,
      ev.actorLabel,
      ev.outcome,
      ev.source,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return hay.includes(qLower);
  });

  return (
    <section className="rounded-xl border border-border bg-surface p-5 space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold flex items-center gap-2">
            <History className="h-4 w-4 text-accent" />
            Activity &amp; Audit History
          </h2>
          <p className="text-xs text-muted mt-0.5">
            Append-only log of human founder updates, MCP agent actions,
            approvals, and Folk sync runs.
          </p>
        </div>

        <button
          type="button"
          disabled={!dbReady || loading}
          onClick={refreshAudit}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface-elevated px-3 py-1.5 text-xs hover:border-accent/50 disabled:opacity-40 self-start"
        >
          <RefreshCw className={`h-3.5 w-3.5 text-accent ${loading ? "animate-spin" : ""}`} />
          Refresh Log
        </button>
      </div>

      <div className="flex flex-col sm:flex-row gap-2 text-xs">
        <div className="relative flex-1">
          <Search className="h-3.5 w-3.5 text-muted absolute left-3 top-2.5" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter by action, entity type, actor, or outcome..."
            className="w-full rounded-lg border border-border bg-surface-elevated pl-8 pr-3 py-1.5"
          />
        </div>
        <select
          value={actorFilter}
          onChange={(e) => setActorFilter(e.target.value)}
          className="rounded-lg border border-border bg-surface-elevated px-3 py-1.5"
        >
          <option value="all">All Actors</option>
          <option value="human">Human Founders</option>
          <option value="agent">AI Agents</option>
          <option value="system">System</option>
        </select>
      </div>

      {visible.length === 0 ? (
        <p className="text-xs text-muted py-4">
          No audit events match the current filter.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-left text-xs border-collapse min-w-[680px]">
            <thead>
              <tr className="border-b border-border bg-surface-elevated/60 text-[11px] text-muted">
                <th className="py-2 px-3 font-medium">When</th>
                <th className="py-2 px-3 font-medium">Actor</th>
                <th className="py-2 px-3 font-medium">Action</th>
                <th className="py-2 px-3 font-medium">Entity</th>
                <th className="py-2 px-3 font-medium">Outcome</th>
                <th className="py-2 px-3 font-medium text-right">Details</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {visible.map((ev) => {
                const isOpen = expandedId === ev.id;
                const hasDetails =
                  ev.previousValueJson !== null ||
                  ev.newValueJson !== null ||
                  ev.metadataJson !== null ||
                  ev.source !== null;
                return (
                  <tr key={ev.id} className="align-top">
                    <td className="py-2.5 px-3 text-[11px] text-muted whitespace-nowrap">
                      {new Date(ev.createdAt).toLocaleString("en-GB")}
                    </td>
                    <td className="py-2.5 px-3 whitespace-nowrap">
                      <span className="rounded border border-border bg-surface-elevated px-1.5 py-0.5 text-[10px] font-mono mr-1.5 text-muted">
                        {ev.actorType}
                      </span>
                      <span className="text-foreground font-medium">
                        {ev.actorLabel}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 font-mono text-[11px] text-foreground">
                      {ev.action}
                      {isOpen && hasDetails && (
                        <div className="mt-2 rounded border border-border bg-surface-elevated p-2.5 text-[11px] font-sans text-muted space-y-1.5 max-w-md overflow-x-auto">
                          {ev.source && (
                            <p>
                              <strong className="text-foreground">Source:</strong>{" "}
                              {ev.source}
                            </p>
                          )}
                          {ev.previousValueJson !== null && (
                            <pre className="whitespace-pre-wrap break-all font-mono text-[10px]">
                              Before: {JSON.stringify(ev.previousValueJson, null, 2)}
                            </pre>
                          )}
                          {ev.newValueJson !== null && (
                            <pre className="whitespace-pre-wrap break-all font-mono text-[10px]">
                              After: {JSON.stringify(ev.newValueJson, null, 2)}
                            </pre>
                          )}
                          {ev.metadataJson !== null && (
                            <pre className="whitespace-pre-wrap break-all font-mono text-[10px]">
                              Meta: {JSON.stringify(ev.metadataJson, null, 2)}
                            </pre>
                          )}
                        </div>
                      )}
                    </td>
                    <td className="py-2.5 px-3 text-muted">
                      <span className="text-foreground">{ev.entityType}</span>
                      {ev.entityId && (
                        <span className="block font-mono text-[10px] truncate max-w-[140px]">
                          {ev.entityId}
                        </span>
                      )}
                    </td>
                    <td className="py-2.5 px-3 whitespace-nowrap">
                      <span
                        className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${
                          OUTCOME_BADGES[ev.outcome] ?? OUTCOME_BADGES.pending
                        }`}
                      >
                        {ev.outcome}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 text-right">
                      {hasDetails && (
                        <button
                          type="button"
                          onClick={() =>
                            setExpandedId(isOpen ? null : ev.id)
                          }
                          className="inline-flex items-center gap-0.5 text-accent hover:underline text-[11px]"
                        >
                          {isOpen ? (
                            <>
                              Hide <ChevronDown className="h-3 w-3" />
                            </>
                          ) : (
                            <>
                              Inspect <ChevronRight className="h-3 w-3" />
                            </>
                          )}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
