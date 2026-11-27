"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, Clock3, MailQuestion } from "lucide-react";
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
  ownerName: string | null;
  channel: string;
  subject: string | null;
  occurredAt: string;
}

export function ActionsWorkspaceClient({
  initialActions,
  awaitingReplyActivities,
  founders,
}: {
  initialActions: SerializedActionItem[];
  awaitingReplyActivities: SerializedAwaitingActivity[];
  founders: FounderOption[];
}) {
  const router = useRouter();
  const [actions, setActions] = useState<SerializedActionItem[]>(initialActions);
  const [ownerFilter, setOwnerFilter] = useState("all");
  const [queueTab, setQueueTab] = useState<
    "all_open" | "needs_review" | "overdue" | "due_today" | "awaiting_reply" | "completed"
  >("all_open");
  const [snoozeId, setSnoozeId] = useState<string | null>(null);
  const [snoozeDate, setSnoozeDate] = useState("");
  const [snoozeReason, setSnoozeReason] = useState("");
  const [busy, setBusy] = useState(false);

  const ownerScoped =
    ownerFilter === "all"
      ? actions
      : actions.filter((a) => a.ownerUserId === ownerFilter);

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

  async function mutateAction(id: string, payload: Record<string, unknown>) {
    setBusy(true);
    try {
      const res = await fetch(`/api/actions/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        const listRes = await fetch("/api/actions");
        if (listRes.ok) {
          const data = await listRes.json();
          setActions(data.actions);
        }
        setSnoozeId(null);
        setSnoozeReason("");
        router.refresh();
      }
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
      </div>

      <div className="flex flex-wrap gap-2">
        {(
          [
            ["all_open", `All Open (${classified.overdue.length + classified.dueToday.length + classified.upcoming.length})`],
            ["needs_review", `Needs Review (${classified.needsReview.length})`],
            ["overdue", `Overdue (${classified.overdue.length})`],
            ["due_today", `Due Today (${classified.dueToday.length})`],
            ["awaiting_reply", `Awaiting Reply (${awaitingReplyActivities.length})`],
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
          {awaitingReplyActivities.length === 0 ? (
            <div className="rounded-xl border border-border bg-surface p-6 text-xs text-muted">
              No outbound outreach currently awaiting reply.
            </div>
          ) : (
            awaitingReplyActivities.map((act) => (
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
                    className="text-accent hover:underline font-medium"
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
                  </div>
                  <p className="text-muted">
                    Owner: <strong className="text-foreground">{act.ownerName}</strong> ·
                    Due: {act.dueDate.toLocaleDateString("en-GB")}
                    {act.companyName ? ` · ${act.companyName}` : ""}
                    {act.personName ? ` (${act.personName})` : ""}
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  {act.goldAccountId && (
                    <Link
                      href={`/gold-lists/${act.goldAccountId}`}
                      className="rounded-lg border border-border px-2.5 py-1 hover:border-accent/50"
                    >
                      Open Account
                    </Link>
                  )}
                  {act.status !== "completed" && (
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
