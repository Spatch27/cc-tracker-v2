"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, Clock3, MailQuestion, Plus, X } from "lucide-react";
import type { FounderOption } from "@/lib/founders";
import { classifyFollowUpActions } from "@/lib/gold-lists/rules";

export interface SerializedActionItem {
  id: string;
  goldAccountId: string | null;
  companyName: string | null;
  personName: string | null;
  ownerUserId: string;
  ownerName: string;
  title: string;
  dueDate: string;
  status: "open" | "needs_review" | "completed" | "cancelled";
  snoozeHistoryJson: Array<{
    previousDueDate: string;
    newDueDate: string;
    snoozedAt: string;
    reason?: string;
  }>;
}

export interface SerializedAwaitingActivity {
  id: string;
  goldAccountId: string | null;
  companyName: string | null;
  personName: string | null;
  ownerUserId?: string | null;
  ownerName: string | null;
  channel: string;
  subject: string | null;
  occurredAt: string;
}

export function ActionsWorkspaceClient({
  initialActions,
  awaitingReplyActivities,
  founders,
  currentFounderUserId = null,
}: {
  initialActions: SerializedActionItem[];
  awaitingReplyActivities: SerializedAwaitingActivity[];
  founders: FounderOption[];
  currentFounderUserId?: string | null;
}) {
  const router = useRouter();
  const [actions, setActions] = useState<SerializedActionItem[]>(initialActions);
  const [awaitingList, setAwaitingList] = useState<SerializedAwaitingActivity[]>(
    awaitingReplyActivities,
  );
  const [ownerFilter, setOwnerFilter] = useState("all");
  const [queueTab, setQueueTab] = useState<
    "all_open" | "needs_review" | "overdue" | "due_today" | "awaiting_reply" | "completed"
  >("all_open");
  const [snoozeId, setSnoozeId] = useState<string | null>(null);
  const [snoozeDate, setSnoozeDate] = useState("");
  const [snoozeReason, setSnoozeReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Create action form
  const [showNewForm, setShowNewForm] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newOwnerId, setNewOwnerId] = useState(
    currentFounderUserId ?? founders[0]?.id ?? "",
  );
  const [newDueDate, setNewDueDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 2);
    return d.toISOString().slice(0, 16);
  });
  const [newNotes, setNewNotes] = useState("");

  const ownerScoped =
    ownerFilter === "all"
      ? actions
      : actions.filter((a) => a.ownerUserId === ownerFilter);

  const awaitingScoped =
    ownerFilter === "all"
      ? awaitingList
      : awaitingList.filter((a) => a.ownerUserId === ownerFilter);

  const classified = classifyFollowUpActions(
    ownerScoped.map((a) => ({ ...a, dueDate: new Date(a.dueDate) })),
  );

  const displayed = (() => {
    if (queueTab === "needs_review") return classified.needsReview;
    if (queueTab === "overdue") return classified.overdue;
    if (queueTab === "due_today") return classified.dueToday;
    if (queueTab === "completed") return classified.completed;
    return [
      ...classified.needsReview,
      ...classified.overdue.filter((o) => o.status !== "needs_review"),
      ...classified.dueToday.filter((d) => d.status !== "needs_review"),
      ...classified.upcoming.filter((u) => u.status !== "needs_review"),
    ];
  })();

  async function refreshActions() {
    const listRes = await fetch("/api/actions");
    if (listRes.ok) {
      const data = await listRes.json();
      setActions(data.actions ?? []);
      setAwaitingList(data.awaitingReplyActivities ?? []);
    }
  }

  async function mutateAction(id: string, payload: Record<string, unknown>) {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/actions/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Failed to update follow-up action");
        return;
      }
      await refreshActions();
      setSnoozeId(null);
      setSnoozeReason("");
      router.refresh();
    } catch {
      setError("Network error updating follow-up action");
    } finally {
      setBusy(false);
    }
  }

  async function handleCreateAction(e: React.FormEvent) {
    e.preventDefault();
    if (!newTitle.trim() || !newOwnerId || !newDueDate) return;
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/actions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ownerUserId: newOwnerId,
          title: newTitle.trim(),
          notes: newNotes.trim() || null,
          dueDate: new Date(newDueDate).toISOString(),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Failed to create follow-up action");
        return;
      }
      setNewTitle("");
      setNewNotes("");
      setShowNewForm(false);
      await refreshActions();
      router.refresh();
    } catch {
      setError("Network error creating follow-up action");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <Clock3 className="h-5 w-5 text-accent" />
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">
              Actions &amp; Outreach Queue
            </h1>
            <p className="text-sm text-muted">
              Due today, overdue, awaiting reply, and reply-flagged follow-ups.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <select
            value={ownerFilter}
            onChange={(e) => setOwnerFilter(e.target.value)}
            className="rounded-lg border border-border bg-surface-elevated px-3 py-1.5 text-xs"
          >
            <option value="all">Both Founders</option>
            {founders.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => setShowNewForm((prev) => !prev)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3.5 py-1.5 text-xs font-semibold text-accent-foreground hover:opacity-90"
          >
            <Plus className="h-3.5 w-3.5" />
            New Action
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-danger/40 bg-danger/10 p-3 text-xs text-danger flex items-center justify-between">
          <span>{error}</span>
          <button type="button" onClick={() => setError(null)}>
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {showNewForm && (
        <form
          onSubmit={handleCreateAction}
          className="rounded-xl border border-border bg-surface p-4 space-y-3 text-xs"
        >
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-foreground">
              Add Follow-Up Action
            </h2>
            <button
              type="button"
              onClick={() => setShowNewForm(false)}
              className="text-muted hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <input
              type="text"
              required
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              placeholder="Next action title *"
              className="sm:col-span-2 rounded-lg border border-border bg-surface-elevated px-3 py-2"
            />
            <select
              value={newOwnerId}
              onChange={(e) => setNewOwnerId(e.target.value)}
              className="rounded-lg border border-border bg-surface-elevated px-3 py-2"
            >
              {founders.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <input
              type="datetime-local"
              required
              value={newDueDate}
              onChange={(e) => setNewDueDate(e.target.value)}
              className="rounded-lg border border-border bg-surface-elevated px-3 py-2"
            />
            <input
              type="text"
              value={newNotes}
              onChange={(e) => setNewNotes(e.target.value)}
              placeholder="Optional context note"
              className="sm:col-span-2 rounded-lg border border-border bg-surface-elevated px-3 py-2"
            />
          </div>
          <button
            type="submit"
            disabled={busy}
            className="rounded-lg bg-accent px-4 py-1.5 font-semibold text-accent-foreground disabled:opacity-40"
          >
            Save Action
          </button>
        </form>
      )}

      <div className="flex flex-wrap gap-2">
        {(
          [
            [
              "all_open",
              `All Open (${classified.overdue.length + classified.dueToday.length + classified.upcoming.length})`,
            ],
            ["needs_review", `Needs Review (${classified.needsReview.length})`],
            ["overdue", `Overdue (${classified.overdue.length})`],
            ["due_today", `Due Today (${classified.dueToday.length})`],
            ["awaiting_reply", `Awaiting Reply (${awaitingScoped.length})`],
            ["completed", `Completed (${classified.completed.length})`],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setQueueTab(key)}
            className={`rounded-full border px-3 py-1 text-xs transition-colors ${
              queueTab === key
                ? "border-accent bg-accent/15 text-accent font-medium"
                : "border-border bg-surface text-muted hover:text-foreground"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {queueTab === "awaiting_reply" ? (
        <div className="space-y-2.5">
          {awaitingScoped.length === 0 ? (
            <div className="rounded-xl border border-border bg-surface p-6 text-xs text-muted">
              No outbound outreach currently awaiting reply.
            </div>
          ) : (
            awaitingScoped.map((act) => (
              <div
                key={act.id}
                className="rounded-xl border border-border bg-surface p-4 text-xs flex items-center justify-between gap-3"
              >
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <MailQuestion className="h-3.5 w-3.5 text-accent" />
                    <span className="font-semibold text-foreground">
                      {act.companyName ?? "Account"} —{" "}
                      {act.personName ?? "Contact"}
                    </span>
                    <span className="rounded bg-surface-elevated px-1.5 py-0.5 font-mono text-[10px] text-muted">
                      {act.channel}
                    </span>
                  </div>
                  <p className="text-muted">
                    {act.subject ?? "Outbound touchpoint"} ·{" "}
                    {act.ownerName ?? "Founder"} ·{" "}
                    {new Date(act.occurredAt).toLocaleDateString("en-GB")}
                  </p>
                </div>
                {act.goldAccountId && (
                  <Link
                    href={`/gold-lists/${act.goldAccountId}`}
                    className="text-accent hover:underline font-medium shrink-0"
                  >
                    Open account →
                  </Link>
                )}
              </div>
            ))
          )}
        </div>
      ) : displayed.length === 0 ? (
        <div className="rounded-xl border border-border bg-surface p-6 text-xs text-muted">
          No follow-up actions in this queue.
        </div>
      ) : (
        <div className="space-y-2.5">
          {displayed.map((act) => (
            <div
              key={act.id}
              className="rounded-xl border border-border bg-surface p-4 text-xs space-y-2"
            >
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div className="space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-semibold text-foreground">
                      {act.title}
                    </span>
                    {act.status === "needs_review" && (
                      <span className="rounded bg-warning/20 text-warning px-2 py-0.5 text-[10px] font-medium">
                        Reply arrived — review
                      </span>
                    )}
                    {act.status === "cancelled" && (
                      <span className="rounded bg-surface-elevated text-muted px-2 py-0.5 text-[10px]">
                        Cancelled
                      </span>
                    )}
                  </div>
                  <p className="text-muted">
                    Owner: <strong className="text-foreground">{act.ownerName}</strong> ·
                    Due: {act.dueDate.toLocaleDateString("en-GB")}
                    {act.companyName ? ` · ${act.companyName}` : ""}
                    {act.personName ? ` (${act.personName})` : ""}
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {act.goldAccountId && (
                    <Link
                      href={`/gold-lists/${act.goldAccountId}`}
                      className="rounded-lg border border-border px-2.5 py-1 hover:border-accent/50"
                    >
                      Open Account
                    </Link>
                  )}
                  {act.status !== "completed" && act.status !== "cancelled" && (
                    <>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          mutateAction(act.id, { action: "complete" })
                        }
                        className="inline-flex items-center gap-1 rounded-lg border border-success/40 px-2.5 py-1 text-success"
                      >
                        <Check className="h-3 w-3" /> Complete
                      </button>
                      <button
                        type="button"
                        onClick={() => setSnoozeId(act.id)}
                        className="rounded-lg border border-border px-2.5 py-1 text-muted hover:text-foreground"
                      >
                        Snooze
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          mutateAction(act.id, { action: "cancel" })
                        }
                        className="rounded-lg border border-danger/30 px-2.5 py-1 text-danger/90 hover:bg-danger/10"
                      >
                        Cancel
                      </button>
                    </>
                  )}
                </div>
              </div>

              {snoozeId === act.id && (
                <div className="flex flex-wrap gap-2 border-t border-border pt-2">
                  <input
                    type="datetime-local"
                    value={snoozeDate}
                    onChange={(e) => setSnoozeDate(e.target.value)}
                    className="rounded border border-border bg-surface-elevated px-2 py-1"
                  />
                  <input
                    type="text"
                    value={snoozeReason}
                    onChange={(e) => setSnoozeReason(e.target.value)}
                    placeholder="Reason"
                    className="flex-1 rounded border border-border bg-surface-elevated px-2 py-1"
                  />
                  <button
                    type="button"
                    disabled={busy || !snoozeDate}
                    onClick={() =>
                      mutateAction(act.id, {
                        action: "snooze",
                        newDueDate: new Date(snoozeDate).toISOString(),
                        reason: snoozeReason,
                      })
                    }
                    className="rounded bg-accent px-3 py-1 font-semibold text-accent-foreground"
                  >
                    Save Snooze
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
