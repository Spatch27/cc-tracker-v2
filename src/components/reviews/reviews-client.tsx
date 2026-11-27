"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  ClipboardCheck,
  Edit3,
  ExternalLink,
  Plus,
  RefreshCw,
  ShieldAlert,
  UserPlus,
  X,
} from "lucide-react";

export interface SerializedProposal {
  id: string;
  targetSystem: "folk" | "tracker";
  entityType: "person" | "company" | "gold_account" | "breakfast_event";
  entityId: string;
  folkRecordId: string | null;
  proposedByAgentId: string | null;
  proposedByUserId: string | null;
  summary: string;
  proposedChangesJson: Record<string, unknown>;
  baseSnapshotJson: Record<string, unknown>;
  payloadHash: string;
  sourceUrl: string | null;
  sourceNote: string | null;
  factType: "verified" | "interpretation" | "unknown";
  evidenceDate: string | null;
  observedAt: string;
  status:
    | "pending_review"
    | "approved"
    | "rejected"
    | "conflict"
    | "applied"
    | "failed";
  reviewedByUserId: string | null;
  reviewedAt: string | null;
  reviewNote: string | null;
  appliedAt: string | null;
  applyError: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SerializedSyncRun {
  id: string;
  source: string;
  scope: string;
  status: "running" | "succeeded" | "partial" | "failed";
  recordsRead: number;
  visibilityGapNote: string | null;
  errorSummary: string | null;
  startedAt: string;
  finishedAt: string | null;
}

interface RecheckState {
  liveRecord: Record<string, unknown> | null;
  conflicts: Array<{
    field: string;
    baseValue: unknown;
    liveFolkValue: unknown;
    proposedValue: unknown;
  }>;
  note?: string;
}

type FilterTab = "pending_review" | "conflict" | "approved" | "history";

function formatValue(val: unknown): string {
  if (val === null || val === undefined) return "—";
  if (typeof val === "string") return val || "—";
  return JSON.stringify(val);
}

export function ReviewsClient({
  initialProposals,
  initialLastReconcileRun,
  dbReady,
  folkConfigured,
}: {
  initialProposals: SerializedProposal[];
  initialLastReconcileRun: SerializedSyncRun | null;
  dbReady: boolean;
  folkConfigured: boolean;
}) {
  const router = useRouter();
  const [proposals, setProposals] = useState<SerializedProposal[]>(initialProposals);
  const [lastRun, setLastRun] = useState<SerializedSyncRun | null>(
    initialLastReconcileRun,
  );
  const [tab, setTab] = useState<FilterTab>("pending_review");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [reconciling, setReconciling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [recheckById, setRecheckById] = useState<Record<string, RecheckState>>({});
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editSummary, setEditSummary] = useState("");
  const [editChangesText, setEditChangesText] = useState("");
  const [reviewNotes, setReviewNotes] = useState<Record<string, string>>({});

  // Create new Folk person / proposal modal
  const [showNewModal, setShowNewModal] = useState(false);
  const [newFullName, setNewFullName] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newJobTitle, setNewJobTitle] = useState("");
  const [newLinkedin, setNewLinkedin] = useState("");
  const [newSourceNote, setNewSourceNote] = useState("");
  const [creating, setCreating] = useState(false);

  const counts = {
    pending_review: proposals.filter((p) => p.status === "pending_review").length,
    conflict: proposals.filter((p) => p.status === "conflict").length,
    approved: proposals.filter((p) => p.status === "approved").length,
    history: proposals.filter((p) =>
      ["applied", "rejected", "failed"].includes(p.status),
    ).length,
  };

  const visibleProposals = proposals.filter((p) => {
    if (tab === "history") {
      return ["applied", "rejected", "failed"].includes(p.status);
    }
    return p.status === tab;
  });

  function updateProposalInList(updated: SerializedProposal) {
    setProposals((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
  }

  async function handleRunReconcile() {
    setError(null);
    setNotice(null);
    setReconciling(true);
    try {
      const res = await fetch("/api/folk/reconcile", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Folk reconciliation failed");
        return;
      }
      setLastRun(data.run);
      const listRes = await fetch("/api/proposals");
      if (listRes.ok) {
        const listData = await listRes.json();
        setProposals(listData.proposals ?? []);
      }
      setNotice(
        `Folk check finished (${data.summary.status}): ${data.summary.recordsChecked} linked record(s) checked, ${data.summary.conflictsCreated} new conflict(s) flagged.`,
      );
      if (data.summary.conflictsCreated > 0) {
        setTab("conflict");
      }
      router.refresh();
    } catch {
      setError("Network error running Folk reconciliation");
    } finally {
      setReconciling(false);
    }
  }

  async function handleRecheck(proposalId: string) {
    setError(null);
    setBusyId(proposalId);
    try {
      const res = await fetch(`/api/proposals/${proposalId}/recheck`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Failed to fetch live Folk record");
        return;
      }
      setRecheckById((prev) => ({
        ...prev,
        [proposalId]: {
          liveRecord: data.liveRecord,
          conflicts: data.conflicts ?? [],
          note: data.note,
        },
      }));
    } catch {
      setError("Network error checking live Folk record");
    } finally {
      setBusyId(null);
    }
  }

  async function handleDecision(
    proposal: SerializedProposal,
    decision:
      | "approve"
      | "reject"
      | "approve_and_apply"
      | "apply"
      | "resolve_conflict_apply"
      | "accept_live_folk_to_tracker",
    extra?: {
      resolvedChangesJson?: Record<string, unknown>;
      refreshedBaseSnapshotJson?: Record<string, unknown>;
    },
  ) {
    setError(null);
    setNotice(null);
    setBusyId(proposal.id);
    try {
      const res = await fetch(`/api/proposals/${proposal.id}/review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          decision,
          expectedPayloadHash: proposal.payloadHash,
          reviewNote: reviewNotes[proposal.id] || null,
          ...extra,
        }),
      });
      const data = await res.json();
      if (data.proposal) {
        updateProposalInList(data.proposal);
      }
      if (!res.ok) {
        if (data.outcome === "conflict") {
          setError(
            "Live Folk values changed since this proposal was prepared — moved to Data Conflicts for review.",
          );
          setTab("conflict");
        } else {
          setError(data.error ?? "Failed to process proposal action");
        }
        return;
      }
      if (data.createdFolkId) {
        setNotice(
          `Created Folk record (${data.createdFolkId}) and synced link to Tracker.`,
        );
      } else {
        setNotice(`Proposal updated (${data.proposal?.status ?? decision}).`);
      }
      router.refresh();
    } catch {
      setError("Network error updating proposal");
    } finally {
      setBusyId(null);
    }
  }

  function startEdit(proposal: SerializedProposal) {
    setEditingId(proposal.id);
    setEditSummary(proposal.summary);
    setEditChangesText(JSON.stringify(proposal.proposedChangesJson, null, 2));
  }

  async function handleSaveEdit(proposalId: string) {
    setError(null);
    setBusyId(proposalId);
    try {
      const parsedChanges = JSON.parse(editChangesText) as Record<string, unknown>;
      const res = await fetch(`/api/proposals/${proposalId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          summary: editSummary,
          proposedChangesJson: parsedChanges,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Failed to update proposal");
        return;
      }
      updateProposalInList(data.proposal);
      setEditingId(null);
      setNotice("Proposal updated; approval status reset to pending_review if changed.");
      router.refresh();
    } catch (err) {
      setError(
        err instanceof SyntaxError
          ? "Proposed changes JSON is invalid"
          : "Network error saving proposal edit",
      );
    } finally {
      setBusyId(null);
    }
  }

  async function handleCreateMissingContact(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setCreating(true);
    try {
      const proposedChangesJson: Record<string, unknown> = {
        _operation: "create_person",
        fullName: newFullName.trim(),
        ...(newJobTitle.trim() ? { jobTitle: newJobTitle.trim() } : {}),
        ...(newEmail.trim() ? { emails: [newEmail.trim()] } : {}),
        ...(newLinkedin.trim() ? { urls: [newLinkedin.trim()] } : {}),
      };
      const res = await fetch("/api/proposals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetSystem: "folk",
          entityType: "person",
          entityId: `new:${crypto.randomUUID()}`,
          folkRecordId: null,
          summary: `Create Folk person: ${newFullName.trim()}`,
          proposedChangesJson,
          baseSnapshotJson: {},
          sourceNote:
            newSourceNote.trim() || "Flagged in Review Queue for Folk creation",
          factType: "verified",
          evidenceDate: new Date().toISOString(),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Failed to create proposal");
        return;
      }
      setProposals((prev) => [data.proposal, ...prev]);
      setShowNewModal(false);
      setNewFullName("");
      setNewEmail("");
      setNewJobTitle("");
      setNewLinkedin("");
      setNewSourceNote("");
      setTab("pending_review");
      setNotice("Added missing contact to Review Queue awaiting founder approval.");
      router.refresh();
    } catch {
      setError("Network error submitting proposal");
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <ClipboardCheck className="h-5 w-5 text-accent" />
            <h1 className="text-2xl font-semibold tracking-tight">
              Review Queue &amp; Folk Conflicts
            </h1>
          </div>
          <p className="text-sm text-muted mt-1">
            Approve or edit proposed Folk updates, resolve side-by-side sync
            conflicts, and review contacts not yet linked in Folk.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={!dbReady}
            onClick={() => setShowNewModal(true)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface-elevated px-3.5 py-2 text-xs font-medium text-foreground hover:border-accent disabled:opacity-40"
          >
            <UserPlus className="h-3.5 w-3.5 text-accent" />
            Flag Missing Contact
          </button>
          <button
            type="button"
            disabled={!dbReady || !folkConfigured || reconciling}
            onClick={handleRunReconcile}
            className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-4 py-2 text-xs font-semibold text-accent-foreground hover:opacity-90 disabled:opacity-40"
          >
            <RefreshCw
              className={`h-3.5 w-3.5 ${reconciling ? "animate-spin" : ""}`}
            />
            {reconciling ? "Checking Folk..." : "Run Folk Sync Check"}
          </button>
        </div>
      </div>

      {/* Last reconciliation freshness bar — never claim "in sync" on partial/failed */}
      <div
        className={`rounded-xl border p-4 text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-2 ${
          !lastRun
            ? "border-border bg-surface text-muted"
            : lastRun.status === "succeeded"
              ? "border-success/30 bg-success/10 text-foreground"
              : "border-warning/40 bg-warning/10 text-warning"
        }`}
      >
        <div className="space-y-0.5">
          <p className="font-medium flex items-center gap-1.5">
            {lastRun?.status === "succeeded" ? (
              <CheckCircle2 className="h-3.5 w-3.5 text-success" />
            ) : (
              <AlertTriangle className="h-3.5 w-3.5" />
            )}
            <span>
              Folk Reconciliation:{" "}
              {lastRun ? lastRun.status.toUpperCase() : "NOT RUN YET"}
            </span>
          </p>
          {lastRun ? (
            <p className="text-muted">
              Checked {lastRun.recordsRead} linked record(s) at{" "}
              {new Date(lastRun.finishedAt ?? lastRun.startedAt).toLocaleString(
                "en-GB",
              )}
              {lastRun.visibilityGapNote ? ` · ${lastRun.visibilityGapNote}` : ""}
              {lastRun.errorSummary ? ` · Errors: ${lastRun.errorSummary}` : ""}
            </p>
          ) : (
            <p className="text-muted">
              Click <strong>Run Folk Sync Check</strong> to compare linked people
              and companies against live Folk CRM records.
            </p>
          )}
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-danger/40 bg-danger/10 p-3.5 text-xs text-danger">
          {error}
        </div>
      )}

      {notice && (
        <div className="rounded-xl border border-success/40 bg-success/10 p-3.5 text-xs text-success">
          {notice}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {(
          [
            ["pending_review", "Pending Proposals"],
            ["conflict", "Data Conflicts"],
            ["approved", "Approved (Ready to Apply)"],
            ["history", "History"],
          ] as Array<[FilterTab, string]>
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={`rounded-full px-3.5 py-1.5 text-xs font-medium border transition-colors ${
              tab === key
                ? "border-accent bg-accent/15 text-accent"
                : "border-border bg-surface text-muted hover:text-foreground"
            }`}
          >
            {label} ({counts[key]})
          </button>
        ))}
      </div>

      {visibleProposals.length === 0 ? (
        <div className="rounded-xl border border-border bg-surface p-8 text-center text-sm text-muted">
          No items in this queue right now.
        </div>
      ) : (
        <div className="space-y-4">
          {visibleProposals.map((p) => {
            const recheck = recheckById[p.id];
            const isEditing = editingId === p.id;
            const displayFields = Array.from(
              new Set([
                ...Object.keys(p.baseSnapshotJson ?? {}),
                ...Object.keys(p.proposedChangesJson ?? {}),
              ]),
            ).filter((k) => !k.startsWith("_"));

            const isCreatePerson =
              p.targetSystem === "folk" &&
              p.entityType === "person" &&
              !p.folkRecordId &&
              (p.entityId.startsWith("new:") ||
                p.proposedChangesJson._operation === "create_person");

            return (
              <div
                key={p.id}
                className="rounded-xl border border-border bg-surface p-5 space-y-4"
              >
                <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={`rounded-full px-2.5 py-0.5 text-[11px] font-mono border ${
                          p.status === "conflict"
                            ? "border-danger/40 bg-danger/10 text-danger"
                            : p.status === "pending_review"
                              ? "border-warning/40 bg-warning/10 text-warning"
                              : p.status === "approved"
                                ? "border-accent/40 bg-accent/15 text-accent"
                                : p.status === "applied"
                                  ? "border-success/40 bg-success/10 text-success"
                                  : "border-border bg-surface-elevated text-muted"
                        }`}
                      >
                        {p.status}
                      </span>
                      <span className="rounded-md border border-border bg-surface-elevated px-2 py-0.5 text-[11px] font-mono text-muted">
                        {p.targetSystem} · {p.entityType}
                      </span>
                      {isCreatePerson && (
                        <span className="rounded-md border border-accent/30 bg-accent/10 px-2 py-0.5 text-[11px] text-accent">
                          New Folk Contact
                        </span>
                      )}
                      <span className="rounded-md border border-border bg-surface-elevated px-2 py-0.5 text-[11px] text-muted">
                        {p.factType}
                      </span>
                    </div>

                    <h2 className="text-base font-semibold text-foreground">
                      {p.summary}
                    </h2>

                    <p className="text-xs text-muted">
                      Record: <code className="font-mono">{p.folkRecordId ?? p.entityId}</code>
                      {" · "}Hash:{" "}
                      <code className="font-mono">{p.payloadHash.slice(0, 12)}</code>
                      {p.evidenceDate
                        ? ` · Evidence: ${new Date(p.evidenceDate).toLocaleDateString("en-GB")}`
                        : ""}
                    </p>
                  </div>

                  {p.sourceUrl && (
                    <a
                      href={p.sourceUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-xs text-accent hover:underline shrink-0"
                    >
                      Source <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                </div>

                {p.sourceNote && (
                  <p className="text-xs text-muted bg-surface-elevated rounded-lg px-3 py-2 border border-border">
                    {p.sourceNote}
                  </p>
                )}

                {p.applyError && (
                  <div className="rounded-lg border border-danger/30 bg-danger/10 p-3 text-xs text-danger flex items-center gap-2">
                    <ShieldAlert className="h-4 w-4 shrink-0" />
                    <span>{p.applyError}</span>
                  </div>
                )}

                {isEditing ? (
                  <div className="space-y-3 rounded-lg border border-border bg-surface-elevated p-4">
                    <div className="space-y-1">
                      <label className="text-xs text-muted block">Summary</label>
                      <input
                        type="text"
                        value={editSummary}
                        onChange={(e) => setEditSummary(e.target.value)}
                        className="w-full rounded-lg border border-border bg-surface px-3 py-1.5 text-xs text-foreground"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs text-muted block">
                        {p.status === "conflict"
                          ? "Resolved Values (JSON)"
                          : "Proposed Changes (JSON)"}
                      </label>
                      <textarea
                        rows={5}
                        value={editChangesText}
                        onChange={(e) => setEditChangesText(e.target.value)}
                        className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-xs font-mono text-foreground"
                      />
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {p.status === "conflict" && p.targetSystem === "folk" ? (
                        <button
                          type="button"
                          disabled={busyId === p.id}
                          onClick={async () => {
                            try {
                              const resolved = JSON.parse(editChangesText) as Record<
                                string,
                                unknown
                              >;
                              const refreshedBase =
                                recheck?.liveRecord ?? p.baseSnapshotJson;
                              await handleDecision(p, "resolve_conflict_apply", {
                                resolvedChangesJson: resolved,
                                refreshedBaseSnapshotJson: refreshedBase,
                              });
                              setEditingId(null);
                            } catch {
                              setError("Resolved values JSON is invalid");
                            }
                          }}
                          className="rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-accent-foreground"
                        >
                          Resolve &amp; Apply to Folk
                        </button>
                      ) : (
                        <button
                          type="button"
                          disabled={busyId === p.id}
                          onClick={() => handleSaveEdit(p.id)}
                          className="rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-accent-foreground"
                        >
                          Save Proposal Edits
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => setEditingId(null)}
                        className="rounded-lg border border-border px-3 py-1.5 text-xs text-muted hover:text-foreground"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="overflow-x-auto rounded-lg border border-border">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-surface-elevated text-muted border-b border-border">
                        <tr>
                          <th className="px-3 py-2 font-medium">Field</th>
                          <th className="px-3 py-2 font-medium">
                            {p.targetSystem === "tracker"
                              ? "Tracker Current"
                              : "Base Snapshot"}
                          </th>
                          <th className="px-3 py-2 font-medium">
                            {p.targetSystem === "tracker"
                              ? "Live Folk Value"
                              : "Proposed Change"}
                          </th>
                          {recheck?.liveRecord && (
                            <th className="px-3 py-2 font-medium text-accent">
                              Live Folk Now
                            </th>
                          )}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {displayFields.map((field) => {
                          const liveConflict = recheck?.conflicts.find(
                            (c) => c.field === field,
                          );
                          return (
                            <tr key={field}>
                              <td className="px-3 py-2 font-mono text-foreground">
                                {field}
                              </td>
                              <td className="px-3 py-2 text-muted break-all">
                                {formatValue(p.baseSnapshotJson?.[field])}
                              </td>
                              <td className="px-3 py-2 text-foreground font-medium break-all">
                                {formatValue(p.proposedChangesJson?.[field])}
                              </td>
                              {recheck?.liveRecord && (
                                <td
                                  className={`px-3 py-2 break-all ${
                                    liveConflict
                                      ? "text-danger font-medium"
                                      : "text-success"
                                  }`}
                                >
                                  {formatValue(recheck.liveRecord[field])}
                                </td>
                              )}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}

                {recheck?.note && (
                  <p className="text-xs text-muted">{recheck.note}</p>
                )}

                {["pending_review", "conflict", "approved"].includes(p.status) && (
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-1">
                    <input
                      type="text"
                      value={reviewNotes[p.id] ?? ""}
                      onChange={(e) =>
                        setReviewNotes((prev) => ({
                          ...prev,
                          [p.id]: e.target.value,
                        }))
                      }
                      placeholder="Optional review note..."
                      className="flex-1 rounded-lg border border-border bg-surface-elevated px-3 py-1.5 text-xs text-foreground"
                    />

                    <div className="flex flex-wrap items-center gap-2">
                      {p.folkRecordId && p.targetSystem === "folk" && (
                        <button
                          type="button"
                          disabled={busyId === p.id}
                          onClick={() => handleRecheck(p.id)}
                          className="rounded-lg border border-border px-3 py-1.5 text-xs text-muted hover:text-foreground"
                        >
                          Check Live Folk
                        </button>
                      )}

                      {!isEditing && (
                        <button
                          type="button"
                          onClick={() => startEdit(p)}
                          className="inline-flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-xs text-muted hover:text-foreground"
                        >
                          <Edit3 className="h-3 w-3" />
                          {p.status === "conflict" ? "Resolve Fields" : "Edit"}
                        </button>
                      )}

                      {p.status === "pending_review" && (
                        <>
                          <button
                            type="button"
                            disabled={busyId === p.id}
                            onClick={() => handleDecision(p, "approve")}
                            className="inline-flex items-center gap-1 rounded-lg border border-accent/40 bg-accent/15 px-3 py-1.5 text-xs font-medium text-accent hover:bg-accent/25"
                          >
                            <Check className="h-3 w-3" />
                            Approve
                          </button>
                          <button
                            type="button"
                            disabled={busyId === p.id}
                            onClick={() => handleDecision(p, "approve_and_apply")}
                            className="inline-flex items-center gap-1 rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-accent-foreground hover:opacity-90"
                          >
                            Approve &amp; Apply
                          </button>
                        </>
                      )}

                      {p.status === "approved" && (
                        <button
                          type="button"
                          disabled={busyId === p.id}
                          onClick={() => handleDecision(p, "apply")}
                          className="inline-flex items-center gap-1 rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-accent-foreground hover:opacity-90"
                        >
                          Apply Now
                        </button>
                      )}

                      {p.status === "conflict" &&
                        p.targetSystem === "tracker" && (
                          <button
                            type="button"
                            disabled={busyId === p.id}
                            onClick={() =>
                              handleDecision(p, "accept_live_folk_to_tracker")
                            }
                            className="inline-flex items-center gap-1 rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-accent-foreground hover:opacity-90"
                          >
                            Accept Live Folk → Update Tracker
                          </button>
                        )}

                      <button
                        type="button"
                        disabled={busyId === p.id}
                        onClick={() => handleDecision(p, "reject")}
                        className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-1.5 text-xs text-danger hover:bg-danger/20"
                      >
                        {p.status === "conflict" && p.targetSystem === "tracker"
                          ? "Keep Tracker Value"
                          : "Reject"}
                      </button>
                    </div>
                  </div>
                )}

                {p.reviewNote && (
                  <p className="text-xs text-muted">
                    Review note: <span className="text-foreground">{p.reviewNote}</span>
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}

      {showNewModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-md rounded-2xl border border-border bg-surface p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold">
                Flag Contact Not in Folk (Requires Approval)
              </h2>
              <button
                type="button"
                onClick={() => setShowNewModal(false)}
                className="text-muted hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="text-xs text-muted">
              Adds a pending proposal in the Review Queue. Nothing is created in
              Folk until a founder clicks Approve &amp; Apply.
            </p>
            <form onSubmit={handleCreateMissingContact} className="space-y-3">
              <div className="space-y-1">
                <label className="text-xs text-muted block">Full Name *</label>
                <input
                  type="text"
                  required
                  value={newFullName}
                  onChange={(e) => setNewFullName(e.target.value)}
                  className="w-full rounded-lg border border-border bg-surface-elevated px-3 py-2 text-xs text-foreground"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted block">Email</label>
                <input
                  type="email"
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  className="w-full rounded-lg border border-border bg-surface-elevated px-3 py-2 text-xs text-foreground"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted block">Job Title</label>
                <input
                  type="text"
                  value={newJobTitle}
                  onChange={(e) => setNewJobTitle(e.target.value)}
                  className="w-full rounded-lg border border-border bg-surface-elevated px-3 py-2 text-xs text-foreground"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted block">LinkedIn URL</label>
                <input
                  type="url"
                  value={newLinkedin}
                  onChange={(e) => setNewLinkedin(e.target.value)}
                  className="w-full rounded-lg border border-border bg-surface-elevated px-3 py-2 text-xs text-foreground"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted block">Source / Note</label>
                <input
                  type="text"
                  value={newSourceNote}
                  onChange={(e) => setNewSourceNote(e.target.value)}
                  placeholder="e.g. From Bristol breakfast invite sheet"
                  className="w-full rounded-lg border border-border bg-surface-elevated px-3 py-2 text-xs text-foreground"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowNewModal(false)}
                  className="rounded-lg border border-border px-4 py-2 text-xs text-muted"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={creating || !newFullName.trim()}
                  className="inline-flex items-center gap-1 rounded-lg bg-accent px-4 py-2 text-xs font-semibold text-accent-foreground disabled:opacity-40"
                >
                  <Plus className="h-3.5 w-3.5" />
                  {creating ? "Queueing..." : "Queue for Review"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
