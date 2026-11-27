"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Check,
  Copy,
  Edit3,
  MailCheck,
  Plus,
  Send,
  X,
} from "lucide-react";
import type { FounderOption } from "@/lib/founders";

export interface SerializedMessageApproval {
  id: string;
  goldAccountId: string | null;
  breakfastEventId: string | null;
  folkPersonLinkId: string | null;
  senderUserId: string;
  recipientName: string;
  recipientAddress: string;
  channel: "email" | "linkedin" | "other";
  subject: string | null;
  body: string;
  contentHash: string;
  proposedByAgentId: string | null;
  proposedByUserId: string | null;
  status:
    | "draft"
    | "awaiting_approval"
    | "approved"
    | "rejected"
    | "sent"
    | "failed"
    | "outcome_unknown";
  approvedByUserId: string | null;
  approvedAt: string | null;
  executionIdempotencyKey: string | null;
  executedAt: string | null;
  executionNote: string | null;
  linkedActivityId: string | null;
  createdAt: string;
  updatedAt: string;
}

type MessageTab = "awaiting" | "approved" | "executed" | "rejected";

export function ApprovalsClient({
  initialMessages,
  founders,
  dbReady,
}: {
  initialMessages: SerializedMessageApproval[];
  founders: FounderOption[];
  dbReady: boolean;
}) {
  const router = useRouter();
  const [messages, setMessages] =
    useState<SerializedMessageApproval[]>(initialMessages);
  const [tab, setTab] = useState<MessageTab>("awaiting");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Ephemeral approval tokens issued in the current session (never stored in DB plaintext)
  const [issuedTokens, setIssuedTokens] = useState<Record<string, string>>({});
  const [latestIssued, setLatestIssued] = useState<{
    messageId: string;
    recipientName: string;
    token: string;
  } | null>(null);

  // Editing state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editRecipientName, setEditRecipientName] = useState("");
  const [editRecipientAddress, setEditRecipientAddress] = useState("");
  const [editSubject, setEditSubject] = useState("");
  const [editBody, setEditBody] = useState("");

  // Execution reporting state per message
  const [execOpenId, setExecOpenId] = useState<string | null>(null);
  const [execToken, setExecToken] = useState("");
  const [execOutcome, setExecOutcome] = useState<
    "sent" | "failed" | "outcome_unknown"
  >("sent");
  const [execKey, setExecKey] = useState("");
  const [execNote, setExecNote] = useState("");
  const [execLogActivity, setExecLogActivity] = useState(true);

  // New draft modal
  const [showNewModal, setShowNewModal] = useState(false);
  const [newSenderId, setNewSenderId] = useState(founders[0]?.id ?? "");
  const [newRecipientName, setNewRecipientName] = useState("");
  const [newRecipientAddress, setNewRecipientAddress] = useState("");
  const [newChannel, setNewChannel] = useState<"email" | "linkedin" | "other">(
    "email",
  );
  const [newSubject, setNewSubject] = useState("");
  const [newBody, setNewBody] = useState("");
  const [creating, setCreating] = useState(false);

  const founderMap = new Map(founders.map((f) => [f.id, f]));

  const counts = {
    awaiting: messages.filter(
      (m) => m.status === "draft" || m.status === "awaiting_approval",
    ).length,
    approved: messages.filter((m) => m.status === "approved").length,
    executed: messages.filter((m) =>
      ["sent", "failed", "outcome_unknown"].includes(m.status),
    ).length,
    rejected: messages.filter((m) => m.status === "rejected").length,
  };

  const visibleMessages = messages.filter((m) => {
    if (tab === "awaiting") {
      return m.status === "draft" || m.status === "awaiting_approval";
    }
    if (tab === "approved") return m.status === "approved";
    if (tab === "executed") {
      return ["sent", "failed", "outcome_unknown"].includes(m.status);
    }
    return m.status === "rejected";
  });

  function updateMessageInList(updated: SerializedMessageApproval) {
    setMessages((prev) => prev.map((m) => (m.id === updated.id ? updated : m)));
  }

  async function handleCreateDraft(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    setCreating(true);
    try {
      const res = await fetch("/api/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          senderUserId: newSenderId,
          recipientName: newRecipientName.trim(),
          recipientAddress: newRecipientAddress.trim(),
          channel: newChannel,
          subject: newSubject.trim() || null,
          body: newBody,
          initialStatus: "awaiting_approval",
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Failed to create draft");
        return;
      }
      setMessages((prev) => [data.message, ...prev]);
      setShowNewModal(false);
      setNewRecipientName("");
      setNewRecipientAddress("");
      setNewSubject("");
      setNewBody("");
      setTab("awaiting");
      setNotice("Draft created and queued for approval.");
      router.refresh();
    } catch {
      setError("Network error creating draft");
    } finally {
      setCreating(false);
    }
  }

  function startEdit(msg: SerializedMessageApproval) {
    setEditingId(msg.id);
    setEditRecipientName(msg.recipientName);
    setEditRecipientAddress(msg.recipientAddress);
    setEditSubject(msg.subject ?? "");
    setEditBody(msg.body);
  }

  async function handleSaveEdit(msgId: string) {
    setError(null);
    setNotice(null);
    setBusyId(msgId);
    try {
      const res = await fetch(`/api/messages/${msgId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recipientName: editRecipientName.trim(),
          recipientAddress: editRecipientAddress.trim(),
          subject: editSubject.trim() || null,
          body: editBody,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Failed to update draft");
        return;
      }
      updateMessageInList(data.message);
      setEditingId(null);
      setNotice(
        data.message.status === "awaiting_approval"
          ? "Draft updated — fresh approval required before sending."
          : "Draft updated.",
      );
      router.refresh();
    } catch {
      setError("Network error updating draft");
    } finally {
      setBusyId(null);
    }
  }

  async function handleApproveOrReject(
    msg: SerializedMessageApproval,
    decision: "approve" | "reject",
  ) {
    setError(null);
    setNotice(null);
    setBusyId(msg.id);
    try {
      const res = await fetch(`/api/messages/${msg.id}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          decision,
          expectedContentHash: msg.contentHash,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Failed to update approval");
        return;
      }
      updateMessageInList(data.message);
      if (decision === "approve" && data.approvalToken) {
        setIssuedTokens((prev) => ({ ...prev, [msg.id]: data.approvalToken }));
        setLatestIssued({
          messageId: msg.id,
          recipientName: msg.recipientName,
          token: data.approvalToken,
        });
        setTab("approved");
        setNotice(
          `Approved message to ${msg.recipientName} (status: approved — NOT marked sent yet).`,
        );
      } else {
        setNotice("Message draft rejected.");
      }
      router.refresh();
    } catch {
      setError("Network error processing message decision");
    } finally {
      setBusyId(null);
    }
  }

  function openReportExecution(msg: SerializedMessageApproval) {
    setExecOpenId(msg.id);
    setExecToken(issuedTokens[msg.id] ?? "");
    setExecOutcome("sent");
    setExecKey(`exec-${msg.id.slice(0, 8)}-${Date.now()}`);
    setExecNote("");
    setExecLogActivity(true);
  }

  async function handleReportExecution(msgId: string) {
    setError(null);
    setNotice(null);
    setBusyId(msgId);
    try {
      const res = await fetch(`/api/messages/${msgId}/execute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          approvalToken: execToken.trim(),
          executionIdempotencyKey: execKey.trim(),
          outcome: execOutcome,
          executionNote: execNote.trim() || null,
          logActivity: execLogActivity,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Failed to record execution outcome");
        return;
      }
      updateMessageInList(data.message);
      setExecOpenId(null);
      setTab("executed");
      setNotice(
        data.replayed
          ? `Idempotent replay: execution already recorded (${data.message.status}).`
          : `Execution recorded as '${data.message.status}'.`,
      );
      router.refresh();
    } catch {
      setError("Network error recording message execution");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <MailCheck className="h-5 w-5 text-accent" />
            <h1 className="text-2xl font-semibold tracking-tight">
              Message Approvals
            </h1>
          </div>
          <p className="text-sm text-muted mt-1">
            Exact-hash founder sign-off for outgoing email/LinkedIn drafts.
            Approval never marks a message sent until external execution reports
            back.
          </p>
        </div>

        <button
          type="button"
          disabled={!dbReady || founders.length === 0}
          onClick={() => setShowNewModal(true)}
          className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-4 py-2 text-xs font-semibold text-accent-foreground hover:opacity-90 disabled:opacity-40"
        >
          <Plus className="h-4 w-4" />
          New Message Draft
        </button>
      </div>

      {latestIssued && (
        <div className="rounded-xl border border-success/40 bg-success/10 p-4 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-semibold text-success">
              Single-use approval token for {latestIssued.recipientName} (shown
              once — pass this when reporting execution):
            </p>
            <button
              type="button"
              onClick={() => navigator.clipboard.writeText(latestIssued.token)}
              className="inline-flex items-center gap-1 rounded-md border border-success/40 px-2.5 py-1 text-[11px] text-success"
            >
              <Copy className="h-3 w-3" />
              Copy Token
            </button>
          </div>
          <pre className="rounded-lg bg-background p-2.5 text-xs font-mono text-foreground overflow-x-auto">
            {latestIssued.token}
          </pre>
        </div>
      )}

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
            ["awaiting", "Awaiting Approval"],
            ["approved", "Approved (Not Sent Yet)"],
            ["executed", "Executed"],
            ["rejected", "Rejected"],
          ] as Array<[MessageTab, string]>
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

      {visibleMessages.length === 0 ? (
        <div className="rounded-xl border border-border bg-surface p-8 text-center text-sm text-muted">
          No message drafts in this view.
        </div>
      ) : (
        <div className="space-y-4">
          {visibleMessages.map((m) => {
            const sender = founderMap.get(m.senderUserId);
            const isEditing = editingId === m.id;
            const isExecOpen = execOpenId === m.id;

            return (
              <div
                key={m.id}
                className="rounded-xl border border-border bg-surface p-5 space-y-3"
              >
                <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-2">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={`rounded-full px-2.5 py-0.5 text-[11px] font-mono border ${
                          m.status === "sent"
                            ? "border-success/40 bg-success/10 text-success"
                            : m.status === "approved"
                              ? "border-accent/40 bg-accent/15 text-accent"
                              : m.status === "failed" || m.status === "rejected"
                                ? "border-danger/40 bg-danger/10 text-danger"
                                : "border-warning/40 bg-warning/10 text-warning"
                        }`}
                      >
                        {m.status === "approved"
                          ? "approved — not sent yet"
                          : m.status}
                      </span>
                      <span className="rounded-md border border-border bg-surface-elevated px-2 py-0.5 text-[11px] font-mono text-muted">
                        {m.channel}
                      </span>
                      <span className="text-[11px] text-muted">
                        Sender: {sender?.name ?? m.senderUserId}
                      </span>
                    </div>

                    <h2 className="text-base font-semibold text-foreground mt-1.5">
                      {m.recipientName}{" "}
                      <span className="text-xs font-normal text-muted">
                        ({m.recipientAddress})
                      </span>
                    </h2>
                    <p className="text-[11px] text-muted font-mono">
                      Content hash: {m.contentHash.slice(0, 12)}
                      {m.executedAt
                        ? ` · Executed: ${new Date(m.executedAt).toLocaleString("en-GB")}`
                        : ""}
                    </p>
                  </div>
                </div>

                {isEditing ? (
                  <div className="space-y-3 rounded-lg border border-border bg-surface-elevated p-4">
                    {m.status === "approved" && (
                      <div className="rounded-lg border border-warning/40 bg-warning/10 p-2.5 text-xs text-warning">
                        Editing an approved message clears its approval and
                        requires fresh founder sign-off.
                      </div>
                    )}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <label className="text-xs text-muted block">
                          Recipient Name
                        </label>
                        <input
                          type="text"
                          value={editRecipientName}
                          onChange={(e) => setEditRecipientName(e.target.value)}
                          className="w-full rounded-lg border border-border bg-surface px-3 py-1.5 text-xs text-foreground"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs text-muted block">
                          Recipient Address
                        </label>
                        <input
                          type="text"
                          value={editRecipientAddress}
                          onChange={(e) => setEditRecipientAddress(e.target.value)}
                          className="w-full rounded-lg border border-border bg-surface px-3 py-1.5 text-xs text-foreground"
                        />
                      </div>
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs text-muted block">Subject</label>
                      <input
                        type="text"
                        value={editSubject}
                        onChange={(e) => setEditSubject(e.target.value)}
                        className="w-full rounded-lg border border-border bg-surface px-3 py-1.5 text-xs text-foreground"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs text-muted block">Body</label>
                      <textarea
                        rows={5}
                        value={editBody}
                        onChange={(e) => setEditBody(e.target.value)}
                        className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-xs text-foreground"
                      />
                    </div>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        disabled={busyId === m.id}
                        onClick={() => handleSaveEdit(m.id)}
                        className="rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-accent-foreground"
                      >
                        Save Edits
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditingId(null)}
                        className="rounded-lg border border-border px-3 py-1.5 text-xs text-muted"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="rounded-lg border border-border bg-surface-elevated p-3.5 space-y-1.5 text-xs">
                    {m.subject && (
                      <p className="font-medium text-foreground">
                        Subject: {m.subject}
                      </p>
                    )}
                    <p className="text-foreground/90 whitespace-pre-wrap leading-relaxed">
                      {m.body}
                    </p>
                  </div>
                )}

                {m.executionNote && (
                  <p className="text-xs text-muted">
                    Execution note: <span className="text-foreground">{m.executionNote}</span>
                  </p>
                )}

                {isExecOpen && (
                  <div className="rounded-lg border border-accent/30 bg-surface-elevated p-4 space-y-3">
                    <p className="text-xs font-semibold text-foreground">
                      Report External Send Outcome
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <label className="text-xs text-muted block">
                          Approval Token *
                        </label>
                        <input
                          type="text"
                          value={execToken}
                          onChange={(e) => setExecToken(e.target.value)}
                          placeholder="cc_msg_..."
                          className="w-full rounded-lg border border-border bg-surface px-3 py-1.5 text-xs font-mono text-foreground"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs text-muted block">
                          Outcome *
                        </label>
                        <select
                          value={execOutcome}
                          onChange={(e) =>
                            setExecOutcome(
                              e.target.value as "sent" | "failed" | "outcome_unknown",
                            )
                          }
                          className="w-full rounded-lg border border-border bg-surface px-3 py-1.5 text-xs text-foreground"
                        >
                          <option value="sent">Sent</option>
                          <option value="failed">Failed</option>
                          <option value="outcome_unknown">Outcome Unknown</option>
                        </select>
                      </div>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <label className="text-xs text-muted block">
                          Execution Idempotency Key *
                        </label>
                        <input
                          type="text"
                          value={execKey}
                          onChange={(e) => setExecKey(e.target.value)}
                          className="w-full rounded-lg border border-border bg-surface px-3 py-1.5 text-xs font-mono text-foreground"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs text-muted block">
                          Execution Note
                        </label>
                        <input
                          type="text"
                          value={execNote}
                          onChange={(e) => setExecNote(e.target.value)}
                          placeholder="Optional note or message ID"
                          className="w-full rounded-lg border border-border bg-surface px-3 py-1.5 text-xs text-foreground"
                        />
                      </div>
                    </div>
                    <label className="inline-flex items-center gap-2 text-xs text-muted">
                      <input
                        type="checkbox"
                        checked={execLogActivity}
                        onChange={(e) => setExecLogActivity(e.target.checked)}
                      />
                      Also log outbound activity to Outreach Timeline when outcome is
                      Sent
                    </label>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        disabled={
                          busyId === m.id || !execToken.trim() || !execKey.trim()
                        }
                        onClick={() => handleReportExecution(m.id)}
                        className="inline-flex items-center gap-1 rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-accent-foreground disabled:opacity-40"
                      >
                        <Send className="h-3 w-3" />
                        Submit Outcome
                      </button>
                      <button
                        type="button"
                        onClick={() => setExecOpenId(null)}
                        className="rounded-lg border border-border px-3 py-1.5 text-xs text-muted"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}

                {!isEditing &&
                  ["draft", "awaiting_approval", "approved"].includes(m.status) && (
                    <div className="flex flex-wrap gap-2 pt-1">
                      <button
                        type="button"
                        onClick={() => startEdit(m)}
                        className="inline-flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-xs text-muted hover:text-foreground"
                      >
                        <Edit3 className="h-3 w-3" />
                        Edit Draft
                      </button>

                      {(m.status === "draft" ||
                        m.status === "awaiting_approval") && (
                        <>
                          <button
                            type="button"
                            disabled={busyId === m.id}
                            onClick={() => handleApproveOrReject(m, "approve")}
                            className="inline-flex items-center gap-1 rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-accent-foreground hover:opacity-90"
                          >
                            <Check className="h-3 w-3" />
                            Approve Exact Version
                          </button>
                          <button
                            type="button"
                            disabled={busyId === m.id}
                            onClick={() => handleApproveOrReject(m, "reject")}
                            className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-1.5 text-xs text-danger hover:bg-danger/20"
                          >
                            Reject
                          </button>
                        </>
                      )}

                      {m.status === "approved" && !isExecOpen && (
                        <button
                          type="button"
                          onClick={() => openReportExecution(m)}
                          className="inline-flex items-center gap-1 rounded-lg border border-accent/40 bg-accent/15 px-3 py-1.5 text-xs font-medium text-accent hover:bg-accent/25"
                        >
                          <Send className="h-3 w-3" />
                          Record Execution Outcome
                        </button>
                      )}
                    </div>
                  )}
              </div>
            );
          })}
        </div>
      )}

      {showNewModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-lg rounded-2xl border border-border bg-surface p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold">New Message Draft</h2>
              <button
                type="button"
                onClick={() => setShowNewModal(false)}
                className="text-muted hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <form onSubmit={handleCreateDraft} className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs text-muted block">Sender Founder</label>
                  <select
                    value={newSenderId}
                    onChange={(e) => setNewSenderId(e.target.value)}
                    className="w-full rounded-lg border border-border bg-surface-elevated px-3 py-2 text-xs text-foreground"
                  >
                    {founders.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-muted block">Channel</label>
                  <select
                    value={newChannel}
                    onChange={(e) =>
                      setNewChannel(
                        e.target.value as "email" | "linkedin" | "other",
                      )
                    }
                    className="w-full rounded-lg border border-border bg-surface-elevated px-3 py-2 text-xs text-foreground"
                  >
                    <option value="email">Email</option>
                    <option value="linkedin">LinkedIn</option>
                    <option value="other">Other</option>
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs text-muted block">
                    Recipient Name *
                  </label>
                  <input
                    type="text"
                    required
                    value={newRecipientName}
                    onChange={(e) => setNewRecipientName(e.target.value)}
                    className="w-full rounded-lg border border-border bg-surface-elevated px-3 py-2 text-xs text-foreground"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-muted block">
                    Email or Profile URL *
                  </label>
                  <input
                    type="text"
                    required
                    value={newRecipientAddress}
                    onChange={(e) => setNewRecipientAddress(e.target.value)}
                    className="w-full rounded-lg border border-border bg-surface-elevated px-3 py-2 text-xs text-foreground"
                  />
                </div>
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted block">
                  Subject (optional)
                </label>
                <input
                  type="text"
                  value={newSubject}
                  onChange={(e) => setNewSubject(e.target.value)}
                  className="w-full rounded-lg border border-border bg-surface-elevated px-3 py-2 text-xs text-foreground"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted block">Message Body *</label>
                <textarea
                  rows={5}
                  required
                  value={newBody}
                  onChange={(e) => setNewBody(e.target.value)}
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
                  disabled={creating}
                  className="rounded-lg bg-accent px-4 py-2 text-xs font-semibold text-accent-foreground disabled:opacity-40"
                >
                  {creating ? "Creating..." : "Create Draft"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
