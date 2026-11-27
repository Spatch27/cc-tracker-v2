"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  ArrowLeft,
  Building2,
  CalendarDays,
  Check,
  Clock3,
  ExternalLink,
  Layers,
  MessageSquarePlus,
  RefreshCw,
  Search,
  Sparkles,
  Trash2,
  UserPlus,
  X,
} from "lucide-react";
import type { FounderOption } from "@/lib/founders";
import {
  MAX_GOLD_ACCOUNTS_PER_FOUNDER,
  type AccountFitSummary,
} from "@/lib/gold-lists/rules";

export interface SerializedGoldWorkspace {
  account: {
    id: string;
    ownerUserId: string;
    status: "active" | "archived";
    marketingTeamSize: number | null;
    legacySetupNotes: string | null;
    fitNotes: string | null;
    legacyScoreMetadataJson: Record<string, unknown> | null;
    lastInteractionsSyncAt: string | null;
    lastInteractionsSyncNote: string | null;
    fit: AccountFitSummary;
  };
  company: {
    id: string;
    folkCompanyId: string;
    name: string;
    domain: string | null;
  } | null;
  founders: FounderOption[];
  ownerCounts: Record<string, number>;
  contacts: Array<{
    id: string;
    folkPersonLinkId: string | null;
    roleCategory: "cmo" | "vp_marketing" | "marketing_director" | "marketing_ops" | "other";
    isPrimaryDecisionMaker: boolean;
    coverageStatus: "mapped" | "gap" | "former";
    notes: string | null;
    person: {
      id: string;
      folkPersonId: string;
      fullName: string;
      email: string | null;
      jobTitle: string | null;
      linkedinUrl: string | null;
      contactSuppressed?: boolean;
      suppressionReason?: string | null;
    } | null;
  }>;
  intelligence: Array<{
    id: string;
    dimension: "team" | "process" | "data" | "tech";
    summary: string;
    factType: "verified" | "interpretation" | "unknown";
    evidenceDate: string | null;
    observedAt: string;
    sourceUrl: string | null;
    sourceNote: string | null;
  }>;
  signals: Array<{
    id: string;
    signalType:
      | "leadership_change"
      | "funding"
      | "consolidation"
      | "integration"
      | "acquisition"
      | "other";
    title: string;
    details: string | null;
    factType: "verified" | "interpretation" | "unknown";
    signalDate: string | null;
    observedAt: string;
    sourceUrl: string | null;
    sourceNote: string | null;
  }>;
  activities: Array<{
    id: string;
    folkPersonLinkId: string | null;
    channel: string;
    direction: string;
    ownerUserId: string | null;
    ownerName: string | null;
    personName: string | null;
    conversationKey: string | null;
    subject: string | null;
    bodyPreview: string | null;
    sourceSystem: string;
    folkInteractionId: string | null;
    executionStatus: string;
    visibilityRestricted: boolean;
    occurredAt: string;
  }>;
  actions: Array<{
    id: string;
    folkPersonLinkId: string | null;
    personName: string | null;
    ownerUserId: string;
    ownerName: string;
    title: string;
    notes: string | null;
    dueDate: string;
    status: "open" | "needs_review" | "completed" | "cancelled";
    flaggedByReplyActivityId: string | null;
    snoozeHistoryJson: Array<{
      previousDueDate: string;
      newDueDate: string;
      snoozedAt: string;
      reason?: string;
    }>;
  }>;
  relatedBreakfasts: Array<{
    invitationId: string;
    eventId: string;
    eventTitle: string;
    locale: string;
    eventDate: string | null;
    personName: string;
    responseStatus: string;
    attendanceOutcome: string;
  }>;
}

interface FolkPersonOption {
  folkPersonId: string;
  fullName: string;
  email: string | null;
  jobTitle: string | null;
  linkedinUrl: string | null;
}

const FACT_BADGE_STYLES: Record<string, string> = {
  verified: "border-success/30 bg-success/10 text-success",
  interpretation: "border-warning/30 bg-warning/10 text-warning",
  unknown: "border-border bg-surface text-muted",
};

function safeExternalUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const trimmed = url.trim();
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return null;
}

export function GoldAccountWorkspaceClient({
  initialWorkspace,
  currentFounderUserId,
}: {
  initialWorkspace: SerializedGoldWorkspace;
  currentFounderUserId: string | null;
}) {
  const router = useRouter();
  const [ws, setWs] = useState<SerializedGoldWorkspace>(initialWorkspace);
  const [activeTab, setActiveTab] = useState<
    "outreach" | "contacts" | "intelligence" | "signals"
  >("outreach");
  const [banner, setBanner] = useState<{
    kind: "info" | "warning" | "error";
    text: string;
  } | null>(null);
  const [busy, setBusy] = useState(false);

  // Fit editor
  const [teamSize, setTeamSize] = useState(
    ws.account.marketingTeamSize !== null
      ? String(ws.account.marketingTeamSize)
      : "",
  );
  const [legacyNotes, setLegacyNotes] = useState(
    ws.account.legacySetupNotes ?? "",
  );
  const [fitNotes, setFitNotes] = useState(ws.account.fitNotes ?? "");

  // Log activity form
  const [actChannel, setActChannel] = useState<
    "linkedin" | "postcard" | "call" | "meeting" | "email" | "other"
  >("linkedin");
  const [actDirection, setActDirection] = useState<
    "outbound" | "inbound" | "note"
  >("outbound");
  const [actPersonId, setActPersonId] = useState("");
  const [actOwnerId, setActOwnerId] = useState(
    currentFounderUserId ?? ws.account.ownerUserId,
  );
  const [actConvKey, setActConvKey] = useState("");
  const [actSubject, setActSubject] = useState("");
  const [actBody, setActBody] = useState("");
  const [actOccurredAt, setActOccurredAt] = useState("");
  const [alsoLogToFolk, setAlsoLogToFolk] = useState(false);

  // Create action form
  const [actionTitle, setActionTitle] = useState("");
  const [actionOwnerId, setActionOwnerId] = useState(
    currentFounderUserId ?? ws.account.ownerUserId,
  );
  const [actionPersonId, setActionPersonId] = useState("");
  const [actionDueDate, setActionDueDate] = useState("");
  const [snoozeTargetId, setSnoozeTargetId] = useState<string | null>(null);
  const [snoozeDate, setSnoozeDate] = useState("");
  const [snoozeReason, setSnoozeReason] = useState("");

  // Contacts & Gaps modal
  const [showFolkModal, setShowFolkModal] = useState(false);
  const [folkQuery, setFolkQuery] = useState("");
  const [folkPeople, setFolkPeople] = useState<FolkPersonOption[]>([]);
  const [searchingFolk, setSearchingFolk] = useState(false);
  const [contactRole, setContactRole] = useState<
    "cmo" | "vp_marketing" | "marketing_director" | "marketing_ops" | "other"
  >("cmo");
  const [isPrimaryDm, setIsPrimaryDm] = useState(true);
  const [gapRole, setGapRole] = useState<
    "cmo" | "vp_marketing" | "marketing_director" | "marketing_ops" | "other"
  >("marketing_ops");
  const [gapNotes, setGapNotes] = useState("");

  // Intelligence form
  const [intelDim, setIntelDim] = useState<"team" | "process" | "data" | "tech">(
    "team",
  );
  const [intelSummary, setIntelSummary] = useState("");
  const [intelFactType, setIntelFactType] = useState<
    "verified" | "interpretation" | "unknown"
  >("verified");
  const [intelEvidenceDate, setIntelEvidenceDate] = useState("");
  const [intelSourceUrl, setIntelSourceUrl] = useState("");

  // Signals form
  const [sigType, setSigType] = useState<
    | "leadership_change"
    | "funding"
    | "consolidation"
    | "integration"
    | "acquisition"
    | "other"
  >("leadership_change");
  const [sigTitle, setSigTitle] = useState("");
  const [sigDetails, setSigDetails] = useState("");
  const [sigFactType, setSigFactType] = useState<
    "verified" | "interpretation" | "unknown"
  >("verified");
  const [sigDate, setSigDate] = useState("");
  const [sigSourceUrl, setSigSourceUrl] = useState("");

  async function refreshWorkspace() {
    const res = await fetch(`/api/gold-lists/${ws.account.id}`);
    if (res.ok) {
      setWs(await res.json());
    }
    router.refresh();
  }

  async function patchAccount(payload: Record<string, unknown>, msg?: string) {
    setBusy(true);
    setBanner(null);
    try {
      const res = await fetch(`/api/gold-lists/${ws.account.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        setBanner({ kind: "error", text: data.error ?? "Update failed" });
        return;
      }
      setWs(data);
      if (msg) setBanner({ kind: "info", text: msg });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function syncFolkInteractions() {
    setBusy(true);
    setBanner(null);
    try {
      const res = await fetch(`/api/gold-lists/${ws.account.id}/sync-folk`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) {
        setBanner({ kind: "error", text: data.error ?? "Folk sync failed" });
        return;
      }
      setBanner({
        kind: data.errors?.length ? "warning" : "info",
        text: data.syncNote,
      });
      await refreshWorkspace();
    } finally {
      setBusy(false);
    }
  }

  async function logActivity(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setBanner(null);
    try {
      const res = await fetch(`/api/gold-lists/${ws.account.id}/activities`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          folkPersonLinkId: actPersonId || null,
          channel: actChannel,
          direction: actDirection,
          ownerUserId: actOwnerId || null,
          conversationKey: actConvKey.trim() || null,
          subject: actSubject.trim() || null,
          bodyPreview: actBody.trim() || null,
          occurredAt: actOccurredAt
            ? new Date(actOccurredAt).toISOString()
            : null,
          alsoLogToFolk,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setBanner({ kind: "error", text: data.error ?? "Failed to log activity" });
        return;
      }
      if (data.folkSyncWarning) {
        setBanner({ kind: "warning", text: data.folkSyncWarning });
      } else if (data.flaggedActionIds?.length > 0) {
        setBanner({
          kind: "warning",
          text: `Inbound reply logged and flagged ${data.flaggedActionIds.length} open follow-up action(s) for review.`,
        });
      } else {
        setBanner({
          kind: "info",
          text: "Outreach activity recorded (note: logging an activity never sends a message).",
        });
      }
      setActSubject("");
      setActBody("");
      setActConvKey("");
      await refreshWorkspace();
    } finally {
      setBusy(false);
    }
  }

  async function createAction(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setBanner(null);
    try {
      const res = await fetch("/api/actions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          goldAccountId: ws.account.id,
          folkPersonLinkId: actionPersonId || null,
          ownerUserId: actionOwnerId,
          title: actionTitle,
          dueDate: new Date(actionDueDate).toISOString(),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setBanner({
          kind: "error",
          text: data.error ?? "Failed to create follow-up action",
        });
        return;
      }
      setActionTitle("");
      await refreshWorkspace();
    } catch {
      setBanner({
        kind: "error",
        text: "Network error creating follow-up action",
      });
    } finally {
      setBusy(false);
    }
  }

  async function updateAction(
    id: string,
    payload: Record<string, unknown>,
  ) {
    setBusy(true);
    setBanner(null);
    try {
      const res = await fetch(`/api/actions/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setBanner({
          kind: "error",
          text: data.error ?? "Failed to update follow-up action",
        });
        return;
      }
      setSnoozeTargetId(null);
      setSnoozeReason("");
      await refreshWorkspace();
    } catch {
      setBanner({
        kind: "error",
        text: "Network error updating follow-up action",
      });
    } finally {
      setBusy(false);
    }
  }

  async function searchFolkPeople(q: string) {
    setSearchingFolk(true);
    try {
      const res = await fetch(`/api/folk/people?q=${encodeURIComponent(q)}`);
      const data = await res.json();
      if (!res.ok) {
        setBanner({
          kind: "error",
          text: data.error ?? "Failed to search Folk contacts",
        });
        return;
      }
      setFolkPeople(data.people ?? []);
    } catch {
      setBanner({
        kind: "error",
        text: "Network error searching Folk contacts",
      });
    } finally {
      setSearchingFolk(false);
    }
  }

  async function linkFolkContact(p: FolkPersonOption) {
    setBusy(true);
    setBanner(null);
    try {
      const res = await fetch(`/api/gold-lists/${ws.account.id}/contacts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "folk",
          folkPersonId: p.folkPersonId,
          fullName: p.fullName,
          email: p.email,
          jobTitle: p.jobTitle,
          linkedinUrl: p.linkedinUrl,
          roleCategory: contactRole,
          isPrimaryDecisionMaker: isPrimaryDm,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setBanner({
          kind: "error",
          text: data.error ?? `Failed to map ${p.fullName}`,
        });
        return;
      }
      setBanner({ kind: "info", text: `Mapped ${p.fullName} (${contactRole}).` });
      await refreshWorkspace();
    } catch {
      setBanner({
        kind: "error",
        text: "Network error mapping Folk contact",
      });
    } finally {
      setBusy(false);
    }
  }

  const mappedContacts = ws.contacts.filter((c) => c.coverageStatus !== "gap");
  const gapContacts = ws.contacts.filter((c) => c.coverageStatus === "gap");

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4">
        <div className="space-y-1">
          <Link
            href="/gold-lists"
            className="inline-flex items-center gap-1 text-xs text-muted hover:text-foreground"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            All Gold Lists
          </Link>
          <div className="flex items-center gap-2.5 flex-wrap">
            <Building2 className="h-5 w-5 text-accent" />
            <h1 className="text-2xl font-semibold tracking-tight">
              {ws.company?.name ?? "Gold Account"}
            </h1>
            {ws.company?.domain && (
              <span className="text-xs font-mono text-muted">
                {ws.company.domain}
              </span>
            )}
          </div>
          <p className="text-xs text-muted">
            Folk ID: <code className="font-mono">{ws.company?.folkCompanyId}</code> ·{" "}
            {ws.account.lastInteractionsSyncAt
              ? `Folk synced ${new Date(ws.account.lastInteractionsSyncAt).toLocaleString("en-GB")}`
              : "Folk interactions not synced yet"}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs">
          <select
            aria-label="Account owner"
            disabled={busy}
            value={ws.account.ownerUserId}
            onChange={(e) =>
              patchAccount(
                { ownerUserId: e.target.value },
                "Updated Gold-list account owner.",
              )
            }
            className="rounded-lg border border-border bg-surface-elevated px-3 py-1.5"
          >
            {ws.founders.map((f) => (
              <option key={f.id} value={f.id}>
                Owner: {f.name} ({ws.ownerCounts[f.id] ?? 0}/
                {MAX_GOLD_ACCOUNTS_PER_FOUNDER})
              </option>
            ))}
          </select>

          <button
            type="button"
            disabled={busy}
            onClick={syncFolkInteractions}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface-elevated px-3 py-1.5 font-medium hover:border-accent/60"
          >
            <RefreshCw className={`h-3.5 w-3.5 text-accent ${busy ? "animate-spin" : ""}`} />
            Refresh Folk Interactions
          </button>

          <button
            type="button"
            disabled={busy}
            onClick={() =>
              patchAccount({
                status:
                  ws.account.status === "active" ? "archived" : "active",
              })
            }
            className="rounded-lg border border-border px-3 py-1.5 text-muted hover:text-foreground"
          >
            {ws.account.status === "active" ? "Archive" : "Restore"}
          </button>

          <button
            type="button"
            disabled={busy}
            onClick={async () => {
              const name = ws.company?.name ?? "this Gold account";
              if (
                !window.confirm(
                  `Permanently delete ${name} from Gold Lists? Your Folk CRM company and contacts will not be affected.`,
                )
              ) {
                return;
              }
              setBusy(true);
              try {
                const res = await fetch(`/api/gold-lists/${ws.account.id}`, {
                  method: "DELETE",
                });
                if (!res.ok) {
                  const data = await res.json();
                  setBanner({
                    kind: "error",
                    text: data.error ?? "Failed to delete Gold account",
                  });
                  return;
                }
                router.push("/gold-lists");
                router.refresh();
              } finally {
                setBusy(false);
              }
            }}
            className="inline-flex items-center gap-1 rounded-lg border border-danger/40 bg-danger/10 px-3 py-1.5 text-danger hover:bg-danger/20"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Delete
          </button>
        </div>
      </div>

      {ws.account.lastInteractionsSyncNote && (
        <div className="rounded-lg border border-border bg-surface-elevated px-3.5 py-2 text-xs text-muted">
          <strong className="text-foreground">Folk Sync Status:</strong>{" "}
          {ws.account.lastInteractionsSyncNote}
        </div>
      )}

      {banner && (
        <div
          className={`rounded-xl border p-3.5 text-xs flex items-center justify-between gap-3 ${
            banner.kind === "error"
              ? "border-danger/40 bg-danger/10 text-danger"
              : banner.kind === "warning"
                ? "border-warning/40 bg-warning/10 text-warning"
                : "border-success/40 bg-success/10 text-success"
          }`}
        >
          <span>{banner.text}</span>
          <button type="button" onClick={() => setBanner(null)}>
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* Fit Indicators Strip */}
      <section className="rounded-xl border border-border bg-surface p-4 space-y-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <span className="text-xs font-semibold text-foreground">
            Account Fit Indicators (Distinct from Buying Signals)
          </span>
          <span
            className={`rounded-full px-2.5 py-0.5 text-[11px] border ${
              ws.account.fit.meetsTeamSizeCriteria
                ? "border-success/30 bg-success/10 text-success"
                : "border-border bg-surface-elevated text-muted"
            }`}
          >
            {ws.account.fit.summaryLabel}
          </span>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            patchAccount(
              {
                marketingTeamSize: teamSize.trim() ? Number(teamSize) : null,
                legacySetupNotes: legacyNotes,
                fitNotes,
              },
              "Saved account fit indicators.",
            );
          }}
          className="grid grid-cols-1 md:grid-cols-4 gap-3 text-xs"
        >
          <input
            type="number"
            min={0}
            value={teamSize}
            onChange={(e) => setTeamSize(e.target.value)}
            placeholder="Marketing team size (ICP > 10)"
            className="rounded-lg border border-border bg-surface-elevated px-2.5 py-1.5"
          />
          <input
            type="text"
            value={legacyNotes}
            onChange={(e) => setLegacyNotes(e.target.value)}
            placeholder="Legacy technology / setup notes"
            className="rounded-lg border border-border bg-surface-elevated px-2.5 py-1.5"
          />
          <input
            type="text"
            value={fitNotes}
            onChange={(e) => setFitNotes(e.target.value)}
            placeholder="Additional fit notes"
            className="rounded-lg border border-border bg-surface-elevated px-2.5 py-1.5"
          />
          <button
            type="submit"
            disabled={busy}
            className="rounded-lg bg-accent px-3 py-1.5 font-semibold text-accent-foreground"
          >
            Save Fit
          </button>
        </form>

        {ws.account.legacyScoreMetadataJson &&
          Object.keys(ws.account.legacyScoreMetadataJson).length > 0 && (
            <div className="rounded-lg border border-border bg-surface-elevated p-3 text-xs space-y-1.5">
              <p className="font-medium text-muted">
                Legacy spreadsheet metadata (read-only archive — not used for ranking)
              </p>
              <div className="flex flex-wrap gap-2">
                {Object.entries(ws.account.legacyScoreMetadataJson).map(
                  ([key, val]) => (
                    <span
                      key={key}
                      className="rounded border border-border bg-surface px-2 py-0.5 text-[11px] text-muted"
                    >
                      <strong className="text-foreground">{key}:</strong>{" "}
                      {typeof val === "string" || typeof val === "number"
                        ? String(val)
                        : JSON.stringify(val)}
                    </span>
                  ),
                )}
              </div>
            </div>
          )}
      </section>

      {/* Tabs */}
      <div className="flex flex-wrap gap-2 border-b border-border pb-2">
        {(
          [
            ["outreach", `Outreach & Actions (${ws.activities.length})`],
            ["contacts", `Decision-Makers & Breakfasts (${ws.contacts.length})`],
            ["intelligence", `Team / Process / Data / Tech (${ws.intelligence.length})`],
            ["signals", `Buying Signals (${ws.signals.length})`],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setActiveTab(key)}
            className={`rounded-lg px-3.5 py-1.5 text-xs font-medium transition-colors ${
              activeTab === key
                ? "bg-surface-elevated text-foreground border border-border"
                : "text-muted hover:text-foreground"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* TAB 1: Outreach & Next Actions */}
      {activeTab === "outreach" && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-4">
            <form
              onSubmit={logActivity}
              className="rounded-xl border border-border bg-surface p-4 space-y-3 text-xs"
            >
              <div className="flex items-center justify-between">
                <span className="font-semibold flex items-center gap-1.5 text-foreground">
                  <MessageSquarePlus className="h-4 w-4 text-accent" />
                  Log Outreach or Inbound Reply
                </span>
                <span className="text-[11px] text-muted">
                  Logs activity only — does not send messages
                </span>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <select
                  value={actChannel}
                  onChange={(e) =>
                    setActChannel(e.target.value as typeof actChannel)
                  }
                  className="rounded-lg border border-border bg-surface-elevated px-2.5 py-1.5"
                >
                  <option value="linkedin">LinkedIn</option>
                  <option value="postcard">Postcard</option>
                  <option value="email">Email (manual)</option>
                  <option value="call">Call</option>
                  <option value="meeting">Meeting</option>
                  <option value="other">Other</option>
                </select>
                <select
                  value={actDirection}
                  onChange={(e) =>
                    setActDirection(e.target.value as typeof actDirection)
                  }
                  className="rounded-lg border border-border bg-surface-elevated px-2.5 py-1.5"
                >
                  <option value="outbound">Outbound</option>
                  <option value="inbound">Inbound Reply</option>
                  <option value="note">Note</option>
                </select>
                <select
                  value={actOwnerId}
                  onChange={(e) => setActOwnerId(e.target.value)}
                  className="rounded-lg border border-border bg-surface-elevated px-2.5 py-1.5"
                >
                  {ws.founders.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name}
                    </option>
                  ))}
                </select>
                <select
                  value={actPersonId}
                  onChange={(e) => setActPersonId(e.target.value)}
                  className="rounded-lg border border-border bg-surface-elevated px-2.5 py-1.5"
                >
                  <option value="">Account-level / no person</option>
                  {mappedContacts.map(
                    (c) =>
                      c.person && (
                        <option key={c.id} value={c.person.id}>
                          {c.person.fullName}
                        </option>
                      ),
                  )}
                </select>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <input
                  type="text"
                  value={actSubject}
                  onChange={(e) => setActSubject(e.target.value)}
                  placeholder="Subject / summary"
                  className="rounded-lg border border-border bg-surface-elevated px-2.5 py-1.5"
                />
                <input
                  type="text"
                  value={actConvKey}
                  onChange={(e) => setActConvKey(e.target.value)}
                  placeholder="Conversation key (optional)"
                  className="rounded-lg border border-border bg-surface-elevated px-2.5 py-1.5"
                />
                <input
                  type="datetime-local"
                  value={actOccurredAt}
                  onChange={(e) => setActOccurredAt(e.target.value)}
                  className="rounded-lg border border-border bg-surface-elevated px-2.5 py-1.5"
                />
              </div>

              <textarea
                rows={2}
                value={actBody}
                onChange={(e) => setActBody(e.target.value)}
                placeholder="Notes or message summary..."
                className="w-full rounded-lg border border-border bg-surface-elevated px-2.5 py-1.5"
              />

              <div className="flex items-center justify-between flex-wrap gap-2">
                <label className="inline-flex items-center gap-1.5 text-muted">
                  <input
                    type="checkbox"
                    checked={alsoLogToFolk}
                    onChange={(e) => setAlsoLogToFolk(e.target.checked)}
                  />
                  Also record on person&apos;s Folk timeline (when contact selected)
                </label>
                <button
                  type="submit"
                  disabled={busy}
                  className="rounded-lg bg-accent px-4 py-1.5 font-semibold text-accent-foreground"
                >
                  Log Activity
                </button>
              </div>
            </form>

            {/* Unified Cross-Founder Timeline */}
            <div className="rounded-xl border border-border bg-surface p-4 space-y-3">
              <h2 className="text-sm font-semibold">
                Cross-Founder Account Timeline
              </h2>
              {ws.activities.length === 0 ? (
                <p className="text-xs text-muted">
                  No outreach recorded yet. Click{" "}
                  <strong className="text-foreground">
                    Refresh Folk Interactions
                  </strong>{" "}
                  above or log a LinkedIn message / postcard.
                </p>
              ) : (
                <ul className="space-y-2.5">
                  {ws.activities.map((act) => (
                    <li
                      key={act.id}
                      className="rounded-lg border border-border bg-surface-elevated p-3 text-xs space-y-1"
                    >
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="rounded bg-accent/15 text-accent px-1.5 py-0.5 font-mono text-[10px]">
                            {act.channel}
                          </span>
                          <span className="rounded border border-border px-1.5 py-0.5 font-mono text-[10px] text-muted">
                            {act.direction}
                          </span>
                          {act.ownerName && (
                            <span className="font-medium text-foreground">
                              {act.ownerName}
                            </span>
                          )}
                          {act.personName && (
                            <span className="text-muted">
                              → {act.personName}
                            </span>
                          )}
                          {act.conversationKey && (
                            <span className="font-mono text-[10px] text-muted">
                              #{act.conversationKey}
                            </span>
                          )}
                        </div>
                        <span className="text-[11px] text-muted">
                          {new Date(act.occurredAt).toLocaleString("en-GB")}
                        </span>
                      </div>
                      {act.subject && (
                        <p className="font-medium text-foreground">
                          {act.subject}
                        </p>
                      )}
                      {act.bodyPreview && (
                        <p className="text-muted whitespace-pre-line">
                          {act.bodyPreview}
                        </p>
                      )}
                      <div className="flex items-center gap-2 text-[10px] font-mono text-muted">
                        <span>source: {act.sourceSystem}</span>
                        <span>· status: {act.executionStatus}</span>
                        {act.visibilityRestricted && (
                          <span className="text-warning">
                            · privacy restricted in Folk
                          </span>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          {/* Right Column: Founder-Owned Next Actions */}
          <div className="space-y-4">
            <form
              onSubmit={createAction}
              className="rounded-xl border border-border bg-surface p-4 space-y-2.5 text-xs"
            >
              <h2 className="text-sm font-semibold flex items-center gap-1.5">
                <Clock3 className="h-4 w-4 text-accent" />
                Add Next Action
              </h2>
              <input
                type="text"
                required
                value={actionTitle}
                onChange={(e) => setActionTitle(e.target.value)}
                placeholder="e.g. Follow up on postcard"
                className="w-full rounded-lg border border-border bg-surface-elevated px-2.5 py-1.5"
              />
              <div className="grid grid-cols-2 gap-2">
                <select
                  value={actionOwnerId}
                  onChange={(e) => setActionOwnerId(e.target.value)}
                  className="rounded-lg border border-border bg-surface-elevated px-2 py-1.5"
                >
                  {ws.founders.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name}
                    </option>
                  ))}
                </select>
                <input
                  type="datetime-local"
                  required
                  value={actionDueDate}
                  onChange={(e) => setActionDueDate(e.target.value)}
                  className="rounded-lg border border-border bg-surface-elevated px-2 py-1.5"
                />
              </div>
              <select
                value={actionPersonId}
                onChange={(e) => setActionPersonId(e.target.value)}
                className="w-full rounded-lg border border-border bg-surface-elevated px-2 py-1.5"
              >
                <option value="">Account-level action</option>
                {mappedContacts.map(
                  (c) =>
                    c.person && (
                      <option key={c.id} value={c.person.id}>
                        {c.person.fullName}
                      </option>
                    ),
                )}
              </select>
              <button
                type="submit"
                disabled={busy}
                className="w-full rounded-lg bg-accent px-3 py-1.5 font-semibold text-accent-foreground"
              >
                Save Next Action
              </button>
            </form>

            <div className="rounded-xl border border-border bg-surface p-4 space-y-2.5">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">
                Account Next Actions ({ws.actions.length})
              </h3>
              {ws.actions.length === 0 ? (
                <p className="text-xs text-muted">No actions yet.</p>
              ) : (
                <div className="space-y-2">
                  {ws.actions.map((act) => (
                    <div
                      key={act.id}
                      className="rounded-lg border border-border bg-surface-elevated p-3 text-xs space-y-2"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <p className="font-medium text-foreground">
                          {act.title}
                        </p>
                        {act.status === "needs_review" && (
                          <span className="rounded bg-warning/20 text-warning px-1.5 py-0.5 text-[10px] font-medium shrink-0">
                            Reply arrived
                          </span>
                        )}
                      </div>
                      <p className="text-muted">
                        Owner: {act.ownerName} · Due{" "}
                        {new Date(act.dueDate).toLocaleDateString("en-GB")} ·{" "}
                        <span className="font-mono">{act.status}</span>
                      </p>
                      {act.snoozeHistoryJson.length > 0 && (
                        <p className="text-[10px] text-muted">
                          Snoozed {act.snoozeHistoryJson.length} time(s)
                        </p>
                      )}
                      {act.status !== "completed" && (
                        <div className="flex gap-2">
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() =>
                              updateAction(act.id, { action: "complete" })
                            }
                            className="inline-flex items-center gap-1 rounded border border-success/40 px-2 py-1 text-[11px] text-success"
                          >
                            <Check className="h-3 w-3" /> Complete
                          </button>
                          <button
                            type="button"
                            onClick={() => setSnoozeTargetId(act.id)}
                            className="rounded border border-border px-2 py-1 text-[11px] text-muted hover:text-foreground"
                          >
                            Snooze
                          </button>
                        </div>
                      )}
                      {snoozeTargetId === act.id && (
                        <div className="space-y-1.5 border-t border-border pt-2">
                          <input
                            type="datetime-local"
                            value={snoozeDate}
                            onChange={(e) => setSnoozeDate(e.target.value)}
                            className="w-full rounded border border-border bg-background px-2 py-1 text-[11px]"
                          />
                          <input
                            type="text"
                            value={snoozeReason}
                            onChange={(e) => setSnoozeReason(e.target.value)}
                            placeholder="Reason (preserved in history)"
                            className="w-full rounded border border-border bg-background px-2 py-1 text-[11px]"
                          />
                          <button
                            type="button"
                            disabled={busy || !snoozeDate}
                            onClick={() =>
                              updateAction(act.id, {
                                action: "snooze",
                                newDueDate: new Date(snoozeDate).toISOString(),
                                reason: snoozeReason,
                              })
                            }
                            className="rounded bg-accent px-2.5 py-1 text-[11px] font-semibold text-accent-foreground"
                          >
                            Confirm Snooze
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: Decision-Makers & Related Breakfasts */}
      {activeTab === "contacts" && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="rounded-xl border border-border bg-surface p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold">
                Marketing Decision-Makers ({mappedContacts.length})
              </h2>
              <button
                type="button"
                onClick={() => {
                  setShowFolkModal(true);
                  searchFolkPeople(ws.company?.name ?? "");
                }}
                className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-accent-foreground"
              >
                <UserPlus className="h-3.5 w-3.5" />
                Map from Folk
              </button>
            </div>

            {mappedContacts.length === 0 ? (
              <p className="text-xs text-muted">
                No decision-makers mapped yet. Map contacts from Folk so their
                Gmail and interaction history syncs to this account.
              </p>
            ) : (
              <ul className="space-y-2">
                {mappedContacts.map((c) => (
                  <li
                    key={c.id}
                    className="rounded-lg border border-border bg-surface-elevated p-3 text-xs flex items-center justify-between gap-2"
                  >
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-semibold text-foreground">
                          {c.person?.fullName ?? "Unknown"}{" "}
                          <span className="font-mono text-[10px] text-accent">
                            [{c.roleCategory}]
                          </span>
                        </p>
                        {c.person?.contactSuppressed && (
                          <span
                            title={
                              c.person.suppressionReason ??
                              "Marked Do Not Contact"
                            }
                            className="rounded border border-danger/40 bg-danger/15 px-1.5 py-0.5 text-[10px] font-medium text-danger"
                          >
                            Do Not Contact
                          </span>
                        )}
                      </div>
                      <p className="text-muted">
                        {[c.person?.jobTitle, c.person?.email]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={async () => {
                        setBanner(null);
                        const res = await fetch(
                          `/api/gold-lists/${ws.account.id}/contacts?contactId=${c.id}`,
                          { method: "DELETE" },
                        );
                        if (!res.ok) {
                          const data = await res.json().catch(() => ({}));
                          setBanner({
                            kind: "error",
                            text: data.error ?? "Failed to remove mapped contact",
                          });
                          return;
                        }
                        await refreshWorkspace();
                      }}
                      className="text-muted hover:text-danger"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            )}

            <div className="border-t border-border pt-4 space-y-3 text-xs">
              <h3 className="font-semibold text-foreground">
                Decision-Maker Coverage Gaps ({gapContacts.length})
              </h3>
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  setBanner(null);
                  const res = await fetch(
                    `/api/gold-lists/${ws.account.id}/contacts`,
                    {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({
                        mode: "gap",
                        roleCategory: gapRole,
                        notes: gapNotes || null,
                      }),
                    },
                  );
                  if (!res.ok) {
                    const data = await res.json().catch(() => ({}));
                    setBanner({
                      kind: "error",
                      text: data.error ?? "Failed to record coverage gap",
                    });
                    return;
                  }
                  setGapNotes("");
                  await refreshWorkspace();
                }}
                className="flex flex-wrap gap-2"
              >
                <select
                  value={gapRole}
                  onChange={(e) =>
                    setGapRole(e.target.value as typeof gapRole)
                  }
                  className="rounded-lg border border-border bg-surface-elevated px-2.5 py-1.5"
                >
                  <option value="cmo">CMO gap</option>
                  <option value="vp_marketing">VP Marketing gap</option>
                  <option value="marketing_director">
                    Marketing Director gap
                  </option>
                  <option value="marketing_ops">Marketing Ops gap</option>
                  <option value="other">Other role gap</option>
                </select>
                <input
                  type="text"
                  value={gapNotes}
                  onChange={(e) => setGapNotes(e.target.value)}
                  placeholder="Coverage gap note"
                  className="flex-1 rounded-lg border border-border bg-surface-elevated px-2.5 py-1.5"
                />
                <button
                  type="submit"
                  className="rounded-lg border border-border px-3 py-1.5 font-medium hover:border-accent/50"
                >
                  Record Gap
                </button>
              </form>

              {gapContacts.map((g) => (
                <div
                  key={g.id}
                  className="rounded-lg border border-warning/30 bg-warning/10 p-2.5 text-xs flex items-center justify-between"
                >
                  <span>
                    <strong className="text-warning">
                      [Gap: {g.roleCategory}]
                    </strong>{" "}
                    {g.notes ?? "Needs identification"}
                  </span>
                  <button
                    type="button"
                    onClick={async () => {
                      await fetch(
                        `/api/gold-lists/${ws.account.id}/contacts?contactId=${g.id}`,
                        { method: "DELETE" },
                      );
                      await refreshWorkspace();
                    }}
                    className="text-muted hover:text-danger"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-xl border border-border bg-surface p-5 space-y-3">
            <h2 className="text-sm font-semibold flex items-center gap-2">
              <CalendarDays className="h-4 w-4 text-accent" />
              Related CMO Breakfast Activity ({ws.relatedBreakfasts.length})
            </h2>
            {ws.relatedBreakfasts.length === 0 ? (
              <p className="text-xs text-muted">
                No mapped contacts from this account have been invited to a CMO
                Breakfast yet.
              </p>
            ) : (
              <ul className="space-y-2 text-xs">
                {ws.relatedBreakfasts.map((rb) => (
                  <li
                    key={rb.invitationId}
                    className="rounded-lg border border-border bg-surface-elevated p-3 flex items-center justify-between gap-2"
                  >
                    <div>
                      <Link
                        href={`/breakfasts/${rb.eventId}`}
                        className="font-semibold text-accent hover:underline"
                      >
                        {rb.eventTitle} ({rb.locale})
                      </Link>
                      <p className="text-muted">{rb.personName}</p>
                    </div>
                    <span className="font-mono text-[11px] text-muted">
                      {rb.responseStatus} / {rb.attendanceOutcome}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      {/* TAB 3: Team / Process / Data / Tech Intelligence */}
      {activeTab === "intelligence" && (
        <div className="space-y-5">
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              try {
                const res = await fetch(
                  `/api/gold-lists/${ws.account.id}/intelligence`,
                  {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      dimension: intelDim,
                      summary: intelSummary,
                      factType: intelFactType,
                      evidenceDate: intelEvidenceDate
                        ? new Date(intelEvidenceDate).toISOString()
                        : null,
                      sourceUrl: intelSourceUrl || null,
                    }),
                  },
                );
                if (res.ok) {
                  setIntelSummary("");
                  setIntelSourceUrl("");
                  await refreshWorkspace();
                }
              } finally {
                setBusy(false);
              }
            }}
            className="rounded-xl border border-border bg-surface p-4 space-y-3 text-xs"
          >
            <div className="flex items-center gap-2 font-semibold text-foreground">
              <Layers className="h-4 w-4 text-accent" />
              Add Team / Process / Data / Tech Intelligence
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
              <select
                value={intelDim}
                onChange={(e) =>
                  setIntelDim(e.target.value as typeof intelDim)
                }
                className="rounded-lg border border-border bg-surface-elevated px-2.5 py-1.5"
              >
                <option value="team">Team</option>
                <option value="process">Process</option>
                <option value="data">Data</option>
                <option value="tech">Tech</option>
              </select>
              <select
                value={intelFactType}
                onChange={(e) =>
                  setIntelFactType(e.target.value as typeof intelFactType)
                }
                className="rounded-lg border border-border bg-surface-elevated px-2.5 py-1.5"
              >
                <option value="verified">Verified Fact</option>
                <option value="interpretation">Interpretation / Hypothesis</option>
                <option value="unknown">Unknown / Gap</option>
              </select>
              <input
                type="date"
                value={intelEvidenceDate}
                onChange={(e) => setIntelEvidenceDate(e.target.value)}
                title="Date of underlying evidence"
                className="rounded-lg border border-border bg-surface-elevated px-2.5 py-1.5"
              />
              <input
                type="url"
                value={intelSourceUrl}
                onChange={(e) => setIntelSourceUrl(e.target.value)}
                placeholder="Source URL (optional)"
                className="rounded-lg border border-border bg-surface-elevated px-2.5 py-1.5"
              />
            </div>
            <textarea
              rows={2}
              required
              value={intelSummary}
              onChange={(e) => setIntelSummary(e.target.value)}
              placeholder="Evidence-backed observation..."
              className="w-full rounded-lg border border-border bg-surface-elevated px-2.5 py-1.5"
            />
            <button
              type="submit"
              disabled={busy}
              className="rounded-lg bg-accent px-4 py-1.5 font-semibold text-accent-foreground"
            >
              Save Intelligence
            </button>
          </form>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {(["team", "process", "data", "tech"] as const).map((dim) => {
              const items = ws.intelligence.filter((i) => i.dimension === dim);
              return (
                <div
                  key={dim}
                  className="rounded-xl border border-border bg-surface p-4 space-y-3"
                >
                  <h3 className="text-sm font-semibold uppercase tracking-wide text-accent">
                    {dim}
                  </h3>
                  {items.length === 0 ? (
                    <p className="text-xs text-muted">No entries yet.</p>
                  ) : (
                    <ul className="space-y-2 text-xs">
                      {items.map((item) => {
                        const validUrl = safeExternalUrl(item.sourceUrl);
                        return (
                          <li
                            key={item.id}
                            className="rounded-lg border border-border bg-surface-elevated p-3 space-y-1.5"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span
                                className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${FACT_BADGE_STYLES[item.factType]}`}
                              >
                                {item.factType}
                              </span>
                              <div className="flex items-center gap-2">
                                <span className="text-[10px] text-muted">
                                  {item.evidenceDate
                                    ? `Evidence: ${new Date(item.evidenceDate).toLocaleDateString("en-GB")}`
                                    : `Observed: ${new Date(item.observedAt).toLocaleDateString("en-GB")}`}
                                </span>
                                <button
                                  type="button"
                                  disabled={busy}
                                  title="Delete entry"
                                  onClick={async () => {
                                    setBusy(true);
                                    setBanner(null);
                                    try {
                                      const res = await fetch(
                                        `/api/gold-lists/${ws.account.id}/intelligence?intelligenceId=${item.id}`,
                                        { method: "DELETE" },
                                      );
                                      if (!res.ok) {
                                        const data = await res
                                          .json()
                                          .catch(() => ({}));
                                        setBanner({
                                          kind: "error",
                                          text:
                                            data.error ??
                                            "Failed to delete intelligence entry",
                                        });
                                        return;
                                      }
                                      await refreshWorkspace();
                                    } finally {
                                      setBusy(false);
                                    }
                                  }}
                                  className="text-muted hover:text-danger"
                                >
                                  <Trash2 className="h-3 w-3" />
                                </button>
                              </div>
                            </div>
                            <p className="text-foreground">{item.summary}</p>
                            {(validUrl || item.sourceNote) && (
                              <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted pt-0.5">
                                {validUrl && (
                                  <a
                                    href={validUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex items-center gap-1 text-accent hover:underline"
                                  >
                                    Source <ExternalLink className="h-3 w-3" />
                                  </a>
                                )}
                                {item.sourceNote && (
                                  <span>{item.sourceNote}</span>
                                )}
                              </div>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* TAB 4: Buying Signals */}
      {activeTab === "signals" && (
        <div className="space-y-4">
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              try {
                const res = await fetch(
                  `/api/gold-lists/${ws.account.id}/signals`,
                  {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      signalType: sigType,
                      title: sigTitle,
                      details: sigDetails || null,
                      factType: sigFactType,
                      signalDate: sigDate
                        ? new Date(sigDate).toISOString()
                        : null,
                      sourceUrl: sigSourceUrl || null,
                    }),
                  },
                );
                if (res.ok) {
                  setSigTitle("");
                  setSigDetails("");
                  setSigSourceUrl("");
                  await refreshWorkspace();
                }
              } finally {
                setBusy(false);
              }
            }}
            className="rounded-xl border border-border bg-surface p-4 space-y-3 text-xs"
          >
            <div className="flex items-center gap-2 font-semibold text-foreground">
              <Sparkles className="h-4 w-4 text-accent" />
              Record Dated Buying Signal
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
              <select
                value={sigType}
                onChange={(e) => setSigType(e.target.value as typeof sigType)}
                className="rounded-lg border border-border bg-surface-elevated px-2.5 py-1.5"
              >
                <option value="leadership_change">New marketing leader</option>
                <option value="funding">Funding raised</option>
                <option value="consolidation">Brand consolidation</option>
                <option value="integration">Integration</option>
                <option value="acquisition">Acquisition</option>
                <option value="other">Other signal</option>
              </select>
              <select
                value={sigFactType}
                onChange={(e) =>
                  setSigFactType(e.target.value as typeof sigFactType)
                }
                className="rounded-lg border border-border bg-surface-elevated px-2.5 py-1.5"
              >
                <option value="verified">Verified Fact</option>
                <option value="interpretation">Interpretation</option>
                <option value="unknown">Unverified</option>
              </select>
              <input
                type="date"
                value={sigDate}
                onChange={(e) => setSigDate(e.target.value)}
                className="rounded-lg border border-border bg-surface-elevated px-2.5 py-1.5"
              />
              <input
                type="url"
                value={sigSourceUrl}
                onChange={(e) => setSigSourceUrl(e.target.value)}
                placeholder="Source URL"
                className="rounded-lg border border-border bg-surface-elevated px-2.5 py-1.5"
              />
            </div>
            <input
              type="text"
              required
              value={sigTitle}
              onChange={(e) => setSigTitle(e.target.value)}
              placeholder="Headline (e.g. Appointed new VP Marketing from Acme)"
              className="w-full rounded-lg border border-border bg-surface-elevated px-2.5 py-1.5"
            />
            <textarea
              rows={2}
              value={sigDetails}
              onChange={(e) => setSigDetails(e.target.value)}
              placeholder="Supporting context..."
              className="w-full rounded-lg border border-border bg-surface-elevated px-2.5 py-1.5"
            />
            <button
              type="submit"
              disabled={busy}
              className="rounded-lg bg-accent px-4 py-1.5 font-semibold text-accent-foreground"
            >
              Add Buying Signal
            </button>
          </form>

          <div className="space-y-2.5">
            {ws.signals.length === 0 ? (
              <div className="rounded-xl border border-border bg-surface p-6 text-xs text-muted">
                No buying signals recorded yet.
              </div>
            ) : (
              ws.signals.map((s) => {
                const validUrl = safeExternalUrl(s.sourceUrl);
                return (
                  <div
                    key={s.id}
                    className="rounded-xl border border-border bg-surface p-4 text-xs space-y-1.5"
                  >
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-accent">
                          [{s.signalType}]
                        </span>
                        <span
                          className={`rounded-full border px-2 py-0.5 text-[10px] ${FACT_BADGE_STYLES[s.factType]}`}
                        >
                          {s.factType}
                        </span>
                      </div>
                      <div className="flex items-center gap-2.5">
                        <span className="text-muted">
                          {s.signalDate
                            ? `Signal date: ${new Date(s.signalDate).toLocaleDateString("en-GB")}`
                            : `Observed: ${new Date(s.observedAt).toLocaleDateString("en-GB")}`}
                        </span>
                        <button
                          type="button"
                          disabled={busy}
                          title="Delete buying signal"
                          onClick={async () => {
                            setBusy(true);
                            setBanner(null);
                            try {
                              const res = await fetch(
                                `/api/gold-lists/${ws.account.id}/signals?signalId=${s.id}`,
                                { method: "DELETE" },
                              );
                              if (!res.ok) {
                                const data = await res.json().catch(() => ({}));
                                setBanner({
                                  kind: "error",
                                  text:
                                    data.error ??
                                    "Failed to delete buying signal",
                                });
                                return;
                              }
                              await refreshWorkspace();
                            } finally {
                              setBusy(false);
                            }
                          }}
                          className="text-muted hover:text-danger"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                    <p className="text-sm font-semibold text-foreground">
                      {s.title}
                    </p>
                    {s.details && <p className="text-muted">{s.details}</p>}
                    {(validUrl || s.sourceNote) && (
                      <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted pt-0.5">
                        {validUrl && (
                          <a
                            href={validUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-accent hover:underline"
                          >
                            Source <ExternalLink className="h-3 w-3" />
                          </a>
                        )}
                        {s.sourceNote && <span>{s.sourceNote}</span>}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {/* Modal: Map Decision-Maker from Folk */}
      {showFolkModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-2xl rounded-2xl border border-border bg-surface p-6 space-y-4 max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold">
                Map Marketing Decision-Maker from Folk
              </h2>
              <button
                type="button"
                onClick={() => setShowFolkModal(false)}
                className="text-muted hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-2 text-xs">
              <select
                value={contactRole}
                onChange={(e) =>
                  setContactRole(e.target.value as typeof contactRole)
                }
                className="rounded-lg border border-border bg-surface-elevated px-2.5 py-2"
              >
                <option value="cmo">CMO</option>
                <option value="vp_marketing">VP Marketing</option>
                <option value="marketing_director">Marketing Director</option>
                <option value="marketing_ops">Marketing Ops</option>
                <option value="other">Other</option>
              </select>
              <label className="inline-flex items-center gap-2 px-2">
                <input
                  type="checkbox"
                  checked={isPrimaryDm}
                  onChange={(e) => setIsPrimaryDm(e.target.checked)}
                />
                Primary decision-maker
              </label>
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                searchFolkPeople(folkQuery);
              }}
              className="flex gap-2"
            >
              <div className="relative flex-1">
                <Search className="h-4 w-4 text-muted absolute left-3 top-2.5" />
                <input
                  type="text"
                  value={folkQuery}
                  onChange={(e) => setFolkQuery(e.target.value)}
                  placeholder="Search Folk people..."
                  className="w-full rounded-lg border border-border bg-surface-elevated pl-9 pr-3 py-2 text-xs"
                />
              </div>
              <button
                type="submit"
                disabled={searchingFolk}
                className="rounded-lg bg-accent px-4 py-2 text-xs font-semibold text-accent-foreground"
              >
                Search
              </button>
            </form>

            <div className="overflow-y-auto space-y-2 flex-1 pr-1">
              {folkPeople.map((p) => (
                <div
                  key={p.folkPersonId}
                  className="flex items-center justify-between gap-3 rounded-lg border border-border bg-surface-elevated p-3 text-xs"
                >
                  <div>
                    <p className="font-medium text-foreground">{p.fullName}</p>
                    <p className="text-muted">
                      {[p.jobTitle, p.email].filter(Boolean).join(" · ") ||
                        p.folkPersonId}
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => linkFolkContact(p)}
                    className="rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-accent-foreground"
                  >
                    Map
                  </button>
                </div>
              ))}
              {folkPeople.length === 0 && (
                <p className="text-xs text-muted text-center py-4">
                  {searchingFolk
                    ? "Searching Folk..."
                    : "No matching Folk contacts."}
                </p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
