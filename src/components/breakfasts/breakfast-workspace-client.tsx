"use client";

import { Fragment, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  ArrowLeft,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  CreditCard,
  History,
  Link2,
  MailPlus,
  MapPin,
  Pencil,
  RefreshCw,
  Search,
  Sparkles,
  Trash2,
  UserPlus,
  X,
} from "lucide-react";
import type { FounderOption } from "@/lib/founders";
import type { BreakfastCapacityMetrics } from "@/lib/breakfasts/rules";

export interface SerializedInvitee {
  id: string;
  eventId: string;
  folkPersonLinkId: string;
  responseStatus: "provisional" | "no_response" | "accepted" | "maybe" | "declined";
  attendanceOutcome: "pending" | "attended" | "cancelled_in_advance" | "no_show";
  waitlistStatus: "none" | "waitlisted" | "offered_place" | "confirmed_replacement";
  chaseStatus: string;
  carriedForwardFromEventId: string | null;
  dietaryNotes: string | null;
  specialRequests: string | null;
  earlyDepartureNote: string | null;
  person: {
    id: string;
    folkPersonId: string;
    fullName: string;
    email: string | null;
    jobTitle: string | null;
    linkedinUrl: string | null;
    contactSuppressed: boolean;
    suppressionReason: string | null;
    companyName: string | null;
  } | null;
  history: Array<{
    id: string;
    previousResponseStatus: string | null;
    newResponseStatus: string | null;
    previousAttendanceOutcome: string | null;
    newAttendanceOutcome: string | null;
    previousWaitlistStatus: string | null;
    newWaitlistStatus: string | null;
    note: string | null;
    createdAt: string;
  }>;
  postEventFollowUp?: {
    status: "not_started" | "drafted" | "approved" | "sent" | "replied";
    referralCount: number;
    latestMessageId: string | null;
  };
}

export interface SerializedBreakfastWorkspace {
  event: {
    id: string;
    locale: string;
    title: string;
    eventDate: string;
    venueName: string | null;
    venueAddress: string | null;
    totalCapacity: number;
    status: "planning" | "inviting" | "confirmed" | "completed" | "cancelled";
    bookingStatus: string | null;
    bookingReference: string | null;
    venueContact: string | null;
    bookingDocsUrl: string | null;
    depositAmountPence: number | null;
    depositDueDate: string | null;
    depositInvoiceRef: string | null;
    depositPaid: boolean;
    balanceAmountPence: number | null;
    balanceDueDate: string | null;
    balanceInvoiceRef: string | null;
    balancePaid: boolean;
    logisticsOwnerUserId: string | null;
    prereadUrl: string | null;
    prereadNotes: string | null;
  };
  founders: FounderOption[];
  hosts: Array<{ id: string; userId: string; attending: boolean }>;
  capacity: BreakfastCapacityMetrics;
  invitations: SerializedInvitee[];
  feedback: Array<{
    id: string;
    category: string;
    summary: string;
    createdAt: string;
  }>;
  referrals: Array<{
    id: string;
    referredByFolkPersonLinkId: string | null;
    referredName: string;
    referredCompany: string | null;
    referredRole: string | null;
    referredEmail: string | null;
    status: "new" | "researching" | "added_to_folk" | "invited" | "dismissed";
    notes: string | null;
    createdAt: string;
  }>;
  manualCarryForwardOptions: Array<{
    folkPersonLinkId: string;
    fullName: string;
    email: string | null;
    jobTitle: string | null;
    companyName: string | null;
    sourceEventId: string;
    sourceEventTitle: string;
    sourceResponseStatus: string;
    sourceAttendanceOutcome: string;
  }>;
}

interface FolkSearchPerson {
  folkPersonId: string;
  fullName: string;
  email: string | null;
  jobTitle: string | null;
  folkCompanyId: string | null;
  companyName: string | null;
  linkedinUrl: string | null;
}

function penceToGbpString(pence: number | null): string {
  if (pence === null || pence === undefined) return "";
  return (pence / 100).toFixed(2);
}

function gbpStringToPence(val: string): number | null {
  const trimmed = val.trim();
  if (!trimmed) return null;
  const num = Number(trimmed);
  if (Number.isNaN(num) || num < 0) return null;
  return Math.round(num * 100);
}

function formatDateInput(iso: string | null): string {
  if (!iso) return "";
  return iso.slice(0, 10);
}

function formatDateTimeLocalInput(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const RESPONSE_LABELS: Record<SerializedInvitee["responseStatus"], string> = {
  provisional: "Not invited yet",
  no_response: "Invited (no reply)",
  accepted: "Accepted",
  maybe: "Maybe",
  declined: "Declined",
};

const ATTENDANCE_LABELS: Record<SerializedInvitee["attendanceOutcome"], string> = {
  pending: "Upcoming",
  attended: "Attended",
  cancelled_in_advance: "Cancelled",
  no_show: "No-show",
};

const CHASE_LABELS: Record<string, string> = {
  none: "Not chased",
  invited: "Invite sent",
  chased_1: "Chased (1st)",
  chased_2: "Chased (2nd)",
};

function responseSelectTone(status: SerializedInvitee["responseStatus"]): string {
  switch (status) {
    case "accepted":
      return "border-success/40 text-success";
    case "declined":
      return "border-danger/40 text-danger";
    case "maybe":
      return "border-warning/40 text-warning";
    case "no_response":
      return "border-accent/40 text-accent";
    default:
      return "border-border text-muted";
  }
}

function matchesInviteFilter(inv: SerializedInvitee, filter: string): boolean {
  if (filter === "all") return true;
  if (filter === "confirmed") {
    return (
      inv.attendanceOutcome !== "cancelled_in_advance" &&
      inv.attendanceOutcome !== "no_show" &&
      ((inv.responseStatus === "accepted" && inv.waitlistStatus === "none") ||
        inv.waitlistStatus === "confirmed_replacement")
    );
  }
  if (filter === "waitlist") {
    return (
      inv.waitlistStatus === "waitlisted" ||
      inv.waitlistStatus === "offered_place"
    );
  }
  if (filter === "cancelled_noshow") {
    return (
      inv.attendanceOutcome === "cancelled_in_advance" ||
      inv.attendanceOutcome === "no_show"
    );
  }
  return inv.responseStatus === filter;
}

function invitePriorityRank(inv: SerializedInvitee): number {
  if (
    inv.attendanceOutcome !== "cancelled_in_advance" &&
    inv.attendanceOutcome !== "no_show" &&
    ((inv.responseStatus === "accepted" && inv.waitlistStatus === "none") ||
      inv.waitlistStatus === "confirmed_replacement")
  ) {
    return 0;
  }
  if (inv.waitlistStatus === "waitlisted" || inv.waitlistStatus === "offered_place") {
    return 1;
  }
  if (inv.responseStatus === "maybe") return 2;
  if (inv.responseStatus === "no_response") return 3;
  if (inv.responseStatus === "provisional") return 4;
  return 5;
}

export function BreakfastWorkspaceClient({
  initialWorkspace,
  currentFounderUserId,
}: {
  initialWorkspace: SerializedBreakfastWorkspace;
  currentFounderUserId: string | null;
}) {
  const router = useRouter();
  const [ws, setWs] = useState<SerializedBreakfastWorkspace>(initialWorkspace);
  const [activeTab, setActiveTab] = useState<
    "invitees" | "logistics" | "preread"
  >("invitees");
  const [inviteFilter, setInviteFilter] = useState<string>("all");
  const [inviteSearch, setInviteSearch] = useState<string>("");
  const [banner, setBanner] = useState<{
    kind: "info" | "warning" | "error";
    text: string;
  } | null>(null);
  const [busy, setBusy] = useState(false);

  // Edit event details modal
  const [showEditModal, setShowEditModal] = useState(false);
  const [editTitle, setEditTitle] = useState(ws.event.title);
  const [editLocale, setEditLocale] = useState(ws.event.locale);
  const [editEventDate, setEditEventDate] = useState(() =>
    formatDateTimeLocalInput(ws.event.eventDate),
  );
  const [editVenueName, setEditVenueName] = useState(ws.event.venueName ?? "");
  const [editTotalCapacity, setEditTotalCapacity] = useState(
    ws.event.totalCapacity,
  );

  // Folk search modal
  const [showFolkModal, setShowFolkModal] = useState(false);
  const [folkQuery, setFolkQuery] = useState("");
  const [folkPeople, setFolkPeople] = useState<FolkSearchPerson[]>([]);
  const [searchingFolk, setSearchingFolk] = useState(false);
  const [folkConfigured, setFolkConfigured] = useState(true);

  // Manual carry-forward modal
  const [showCarryModal, setShowCarryModal] = useState(false);

  // Expanded invitee drawer & relink Folk contact picker
  const [expandedInvId, setExpandedInvId] = useState<string | null>(null);
  const [noteEdits, setNoteEdits] = useState<
    Record<
      string,
      { dietaryNotes: string; specialRequests: string; earlyDepartureNote: string }
    >
  >({});
  const [relinkingInvId, setRelinkingInvId] = useState<string | null>(null);
  const [relinkQuery, setRelinkQuery] = useState("");
  const [relinkResults, setRelinkResults] = useState<FolkSearchPerson[]>([]);
  const [relinkLoading, setRelinkLoading] = useState(false);

  // Logistics form state
  const [venueName, setVenueName] = useState(ws.event.venueName ?? "");
  const [venueAddress, setVenueAddress] = useState(ws.event.venueAddress ?? "");
  const [bookingStatus, setBookingStatus] = useState(
    ws.event.bookingStatus ?? "unconfirmed",
  );
  const [bookingReference, setBookingReference] = useState(
    ws.event.bookingReference ?? "",
  );
  const [venueContact, setVenueContact] = useState(ws.event.venueContact ?? "");
  const [bookingDocsUrl, setBookingDocsUrl] = useState(
    ws.event.bookingDocsUrl ?? "",
  );
  const [logisticsOwnerUserId, setLogisticsOwnerUserId] = useState(
    ws.event.logisticsOwnerUserId ?? "",
  );
  const [depositGbp, setDepositGbp] = useState(
    penceToGbpString(ws.event.depositAmountPence),
  );
  const [depositDueDate, setDepositDueDate] = useState(
    formatDateInput(ws.event.depositDueDate),
  );
  const [depositInvoiceRef, setDepositInvoiceRef] = useState(
    ws.event.depositInvoiceRef ?? "",
  );
  const [depositPaid, setDepositPaid] = useState(ws.event.depositPaid);
  const [balanceGbp, setBalanceGbp] = useState(
    penceToGbpString(ws.event.balanceAmountPence),
  );
  const [balanceDueDate, setBalanceDueDate] = useState(
    formatDateInput(ws.event.balanceDueDate),
  );
  const [balanceInvoiceRef, setBalanceInvoiceRef] = useState(
    ws.event.balanceInvoiceRef ?? "",
  );
  const [balancePaid, setBalancePaid] = useState(ws.event.balancePaid);

  // Preread + Feedback + Referrals state
  const [prereadUrl, setPrereadUrl] = useState(ws.event.prereadUrl ?? "");
  const [prereadNotes, setPrereadNotes] = useState(ws.event.prereadNotes ?? "");
  const [copiedPreread, setCopiedPreread] = useState(false);

  const [fbCategory, setFbCategory] = useState<
    "event" | "format" | "venue" | "attendee_mix" | "content"
  >("event");
  const [fbSummary, setFbSummary] = useState("");

  const [refName, setRefName] = useState("");
  const [refCompany, setRefCompany] = useState("");
  const [refRole, setRefRole] = useState("");
  const [refEmail, setRefEmail] = useState("");
  const [refByPersonId, setRefByPersonId] = useState("");
  const [refNotes, setRefNotes] = useState("");

  async function refreshWorkspace() {
    const res = await fetch(`/api/breakfasts/${ws.event.id}`);
    if (res.ok) {
      const data = await res.json();
      setWs(data);
    }
    router.refresh();
  }

  async function patchEvent(payload: Record<string, unknown>, message?: string) {
    setBusy(true);
    setBanner(null);
    try {
      const res = await fetch(`/api/breakfasts/${ws.event.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        setBanner({ kind: "error", text: data.error ?? "Failed to update event" });
        return;
      }
      setWs(data);
      if (message) setBanner({ kind: "info", text: message });
      router.refresh();
    } catch {
      setBanner({ kind: "error", text: "Network error updating event" });
    } finally {
      setBusy(false);
    }
  }

  async function toggleHost(userId: string) {
    const current = ws.hosts.filter((h) => h.attending).map((h) => h.userId);
    const next = current.includes(userId)
      ? current.filter((id) => id !== userId)
      : [...current, userId];
    await patchEvent({ attendingHostUserIds: next });
  }

  async function searchFolk(q: string) {
    setSearchingFolk(true);
    try {
      const res = await fetch(`/api/folk/people?q=${encodeURIComponent(q)}`);
      const data = await res.json();
      setFolkConfigured(data.folkConfigured !== false);
      setFolkPeople(data.people ?? []);
    } catch {
      setBanner({ kind: "error", text: "Failed to search Folk contacts" });
    } finally {
      setSearchingFolk(false);
    }
  }

  async function addFromFolk(person: FolkSearchPerson) {
    setBusy(true);
    setBanner(null);
    try {
      const res = await fetch(`/api/breakfasts/${ws.event.id}/invitees`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "folk",
          folkPersonId: person.folkPersonId,
          fullName: person.fullName,
          email: person.email,
          jobTitle: person.jobTitle,
          folkCompanyId: person.folkCompanyId,
          companyName: person.companyName,
          linkedinUrl: person.linkedinUrl,
          initialResponseStatus: "provisional",
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setBanner({ kind: "error", text: data.error ?? "Could not add contact" });
        return;
      }
      setBanner({
        kind: "info",
        text: `Added ${person.fullName} to the provisional list.`,
      });
      await refreshWorkspace();
    } catch {
      setBanner({ kind: "error", text: "Network error adding invitee" });
    } finally {
      setBusy(false);
    }
  }

  async function addManualCarryForward(opt: SerializedBreakfastWorkspace["manualCarryForwardOptions"][number]) {
    setBusy(true);
    setBanner(null);
    try {
      const res = await fetch(`/api/breakfasts/${ws.event.id}/invitees`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "existing_link",
          folkPersonLinkId: opt.folkPersonLinkId,
          carriedForwardFromEventId: opt.sourceEventId,
          initialResponseStatus: "provisional",
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setBanner({ kind: "error", text: data.error ?? "Could not carry forward" });
        return;
      }
      setBanner({
        kind: "info",
        text: `Carried forward ${opt.fullName} as provisional (zero event notes copied).`,
      });
      await refreshWorkspace();
    } finally {
      setBusy(false);
    }
  }

  async function removeInvitee(inv: SerializedInvitee) {
    const label = inv.person?.fullName ?? "this invitee";
    if (
      !window.confirm(
        `Remove ${label} from this breakfast list? Their Folk CRM contact will not be affected.`,
      )
    ) {
      return;
    }

    setBusy(true);
    setBanner(null);
    try {
      const res = await fetch(
        `/api/breakfasts/${ws.event.id}/invitees/${inv.id}`,
        { method: "DELETE" },
      );
      const data = await res.json();
      if (!res.ok) {
        setBanner({ kind: "error", text: data.error ?? "Failed to remove invitee" });
        return;
      }
      setExpandedInvId(null);
      setBanner({
        kind: "info",
        text: `Removed ${label} from this breakfast list (Folk CRM untouched).`,
      });
      await refreshWorkspace();
    } catch {
      setBanner({ kind: "error", text: "Network error removing invitee" });
    } finally {
      setBusy(false);
    }
  }

  async function queueAllPostEventDrafts() {
    setBusy(true);
    setBanner(null);
    try {
      const res = await fetch(
        `/api/breakfasts/${ws.event.id}/post-event-followup`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            mode: "queue_all_attendee_drafts",
            senderUserId: currentFounderUserId ?? ws.founders[0]?.id,
          }),
        },
      );
      const data = await res.json();
      if (!res.ok) {
        setBanner({
          kind: "error",
          text: data.error ?? "Failed to queue post-event drafts",
        });
        return;
      }
      setBanner({
        kind: data.createdCount > 0 ? "info" : "warning",
        text: `Queued ${data.createdCount} thank-you & referral draft(s) in Message Approvals (${data.skippedCount} skipped).`,
      });
      await refreshWorkspace();
    } catch {
      setBanner({
        kind: "error",
        text: "Network error queueing post-event drafts",
      });
    } finally {
      setBusy(false);
    }
  }

  async function markPostEventFollowUpStatus(
    folkPersonLinkId: string,
    status: "sent" | "replied",
  ) {
    setBusy(true);
    setBanner(null);
    try {
      const res = await fetch(
        `/api/breakfasts/${ws.event.id}/post-event-followup`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            mode: "mark_status",
            folkPersonLinkId,
            status,
          }),
        },
      );
      const data = await res.json();
      if (!res.ok) {
        setBanner({
          kind: "error",
          text: data.error ?? "Failed to record post-event follow-up status",
        });
        return;
      }
      setBanner({
        kind: "info",
        text:
          status === "replied"
            ? "Marked attendee post-event reply received."
            : "Marked attendee post-event thank-you email sent.",
      });
      await refreshWorkspace();
    } catch {
      setBanner({
        kind: "error",
        text: "Network error recording post-event follow-up status",
      });
    } finally {
      setBusy(false);
    }
  }

  async function patchInvitee(
    invitationId: string,
    payload: Record<string, unknown>,
  ) {
    setBusy(true);
    setBanner(null);
    try {
      const res = await fetch(
        `/api/breakfasts/${ws.event.id}/invitees/${invitationId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      );
      const data = await res.json();
      if (!res.ok) {
        setBanner({ kind: "error", text: data.error ?? "Update failed" });
        return;
      }

      if (data.wasAutoWaitlisted) {
        setBanner({
          kind: "warning",
          text: "Event is at guest capacity — acceptance recorded on the waitlist (never overbooks).",
        });
      } else if (data.carryForwardAction === "carried_to_next_event") {
        setBanner({
          kind: "info",
          text: "Automatically added to the provisional list for the next same-locale breakfast.",
        });
      } else if (data.carryForwardAction === "queued_for_locale") {
        setBanner({
          kind: "info",
          text: `Queued for automatic provisional inclusion when the next ${ws.event.locale} breakfast is created.`,
        });
      } else if (data.carryForwardAction === "skipped_suppressed") {
        setBanner({
          kind: "warning",
          text: "Contact is marked Do Not Contact — excluded from automatic carry-forward.",
        });
      }

      await refreshWorkspace();
    } catch {
      setBanner({ kind: "error", text: "Network error updating invitee" });
    } finally {
      setBusy(false);
    }
  }

  async function searchRelinkFolk(queryText: string) {
    setRelinkLoading(true);
    setBanner(null);
    try {
      const res = await fetch(
        `/api/folk/people?q=${encodeURIComponent(queryText.trim())}`,
      );
      const data = await res.json();
      if (!res.ok) {
        setBanner({ kind: "error", text: data.error ?? "Failed to search Folk CRM" });
        return;
      }
      setRelinkResults(data.people ?? []);
    } catch {
      setBanner({ kind: "error", text: "Network error searching Folk CRM" });
    } finally {
      setRelinkLoading(false);
    }
  }

  async function openRelinkPicker(inv: SerializedInvitee) {
    setExpandedInvId(inv.id);
    if (relinkingInvId === inv.id) {
      setRelinkingInvId(null);
      return;
    }
    const rawName = inv.person?.fullName?.trim() ?? "";
    const tokens = rawName.split(/\s+/).filter(Boolean);
    const defaultQ = tokens.length >= 2 ? tokens[tokens.length - 1] : rawName;
    setRelinkingInvId(inv.id);
    setRelinkQuery(defaultQ);
    setRelinkResults([]);
    await searchRelinkFolk(defaultQ);
  }

  async function applyRelinkFolk(
    inv: SerializedInvitee,
    picked: FolkSearchPerson,
  ) {
    await patchInvitee(inv.id, { relinkFolkPerson: picked });
    setRelinkingInvId(null);
    setBanner({
      kind: "info",
      text: `Updated Folk link to ${picked.fullName}${picked.email ? ` (${picked.email})` : ""}.`,
    });
  }

  async function draftApprovalMessage(inv: SerializedInvitee) {
    if (!inv.person?.email) {
      setBanner({
        kind: "warning",
        text: `${inv.person?.fullName ?? "This contact"} has no email address linked in Folk yet.`,
      });
      return;
    }
    const senderId = currentFounderUserId ?? ws.founders[0]?.id;
    if (!senderId) {
      setBanner({ kind: "error", text: "No founder user record found" });
      return;
    }

    setBusy(true);
    try {
      const isWaitlistOffer = inv.waitlistStatus === "offered_place";
      const res = await fetch("/api/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          breakfastEventId: ws.event.id,
          folkPersonLinkId: inv.folkPersonLinkId,
          senderUserId: senderId,
          recipientName: inv.person.fullName,
          recipientAddress: inv.person.email,
          channel: "email",
          subject: isWaitlistOffer
            ? `Seat opened: ${ws.event.title}`
            : `Invitation: ${ws.event.title}`,
          body: isWaitlistOffer
            ? `Hi ${inv.person.fullName.split(" ")[0]},\n\nA place has just opened up for our ${ws.event.locale} CMO breakfast (${ws.event.title}). Would you like me to confirm your seat?\n\nBest,`
            : `Hi ${inv.person.fullName.split(" ")[0]},\n\nWe're hosting a small CMO breakfast in ${ws.event.locale} (${ws.event.title}) and would love to have you join us.\n\nBest,`,
          initialStatus: "awaiting_approval",
        }),
      });
      if (!res.ok) {
        const d = await res.json();
        setBanner({ kind: "error", text: d.error ?? "Failed to create draft" });
        return;
      }
      setBanner({
        kind: "info",
        text: `Draft message queued in Message Approvals for ${inv.person.fullName} (approval required before sending).`,
      });
    } finally {
      setBusy(false);
    }
  }

  async function copyPrereadContext() {
    const res = await fetch(`/api/breakfasts/${ws.event.id}/preread-context`);
    if (!res.ok) {
      setBanner({ kind: "error", text: "Failed to build preread context" });
      return;
    }
    const data = await res.json();
    await navigator.clipboard.writeText(data.markdown);
    setCopiedPreread(true);
    setTimeout(() => setCopiedPreread(false), 2000);
  }

  async function submitFeedback(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await fetch(`/api/breakfasts/${ws.event.id}/feedback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category: fbCategory, summary: fbSummary }),
      });
      if (res.ok) {
        setFbSummary("");
        await refreshWorkspace();
      }
    } finally {
      setBusy(false);
    }
  }

  async function submitReferral(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await fetch(`/api/breakfasts/${ws.event.id}/referrals`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          referredByFolkPersonLinkId: refByPersonId || null,
          referredName: refName,
          referredCompany: refCompany || null,
          referredRole: refRole || null,
          referredEmail: refEmail || null,
          notes: refNotes || null,
        }),
      });
      if (res.ok) {
        setRefName("");
        setRefCompany("");
        setRefRole("");
        setRefEmail("");
        setRefNotes("");
        await refreshWorkspace();
      }
    } finally {
      setBusy(false);
    }
  }

  const attendingHostIds = new Set(
    ws.hosts.filter((h) => h.attending).map((h) => h.userId),
  );

  const normalizedSearch = inviteSearch.trim().toLowerCase();
  const filteredInvitees = ws.invitations
    .filter((inv) => {
      if (!matchesInviteFilter(inv, inviteFilter)) return false;
      if (!normalizedSearch) return true;
      const haystack = [
        inv.person?.fullName ?? "",
        inv.person?.companyName ?? "",
        inv.person?.jobTitle ?? "",
        inv.person?.email ?? "",
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(normalizedSearch);
    })
    .sort((a, b) => {
      const rankDiff = invitePriorityRank(a) - invitePriorityRank(b);
      if (rankDiff !== 0) return rankDiff;
      return (a.person?.fullName ?? "").localeCompare(b.person?.fullName ?? "");
    });

  const existingPersonLinkIds = new Set(
    ws.invitations.map((i) => i.folkPersonLinkId),
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="space-y-1">
          <Link
            href="/breakfasts"
            className="inline-flex items-center gap-1 text-xs text-muted hover:text-foreground"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            All CMO Breakfasts
          </Link>
          <div className="flex items-center gap-2.5 flex-wrap">
            <h1 className="text-2xl font-semibold tracking-tight">
              {ws.event.title}
            </h1>
            <span className="inline-flex items-center gap-1 rounded-md bg-accent/15 px-2.5 py-0.5 text-xs font-medium text-accent">
              <MapPin className="h-3.5 w-3.5" />
              {ws.event.locale}
            </span>
          </div>
          <p className="text-xs text-muted flex items-center gap-2">
            <CalendarDays className="h-3.5 w-3.5" />
            {new Date(ws.event.eventDate).toLocaleString("en-GB", {
              weekday: "short",
              day: "numeric",
              month: "short",
              year: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            })}
            · {ws.event.venueName ?? "Venue TBC"}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <label className="text-xs text-muted">Status:</label>
          <select
            value={ws.event.status}
            disabled={busy}
            onChange={(e) => patchEvent({ status: e.target.value })}
            className="rounded-lg border border-border bg-surface-elevated px-3 py-1.5 text-xs font-medium text-foreground"
          >
            <option value="planning">planning</option>
            <option value="inviting">inviting</option>
            <option value="confirmed">confirmed</option>
            <option value="completed">completed</option>
            <option value="cancelled">cancelled</option>
          </select>

          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setEditTitle(ws.event.title);
              setEditLocale(ws.event.locale);
              setEditEventDate(formatDateTimeLocalInput(ws.event.eventDate));
              setEditVenueName(ws.event.venueName ?? "");
              setEditTotalCapacity(ws.event.totalCapacity);
              setShowEditModal(true);
            }}
            className="inline-flex items-center gap-1 rounded-lg border border-border bg-surface-elevated px-3 py-1.5 text-xs font-medium text-foreground hover:border-accent/60"
          >
            <Pencil className="h-3.5 w-3.5 text-accent" />
            Edit Details
          </button>

          <button
            type="button"
            disabled={busy}
            onClick={async () => {
              if (
                !window.confirm(
                  `Permanently delete "${ws.event.title}"? Your Folk CRM contacts will not be affected.`,
                )
              ) {
                return;
              }
              setBusy(true);
              try {
                const res = await fetch(`/api/breakfasts/${ws.event.id}`, {
                  method: "DELETE",
                });
                if (!res.ok) {
                  const data = await res.json();
                  setBanner({
                    kind: "error",
                    text: data.error ?? "Failed to delete breakfast",
                  });
                  return;
                }
                router.push("/breakfasts");
                router.refresh();
              } finally {
                setBusy(false);
              }
            }}
            className="inline-flex items-center gap-1 rounded-lg border border-danger/40 bg-danger/10 px-3 py-1.5 text-xs text-danger hover:bg-danger/20"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Delete
          </button>
        </div>
      </div>

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

      {/* Capacity & Host-aware Strip */}
      <section className="rounded-xl border border-border bg-surface p-4 space-y-3">
        <div className="grid grid-cols-2 sm:grid-cols-6 gap-3 text-xs">
          <div className="rounded-lg bg-surface-elevated border border-border p-3">
            <span className="text-muted block">Room Capacity</span>
            <input
              key={ws.event.totalCapacity}
              type="number"
              min={2}
              max={100}
              defaultValue={ws.event.totalCapacity}
              onBlur={(e) => {
                const val = Number(e.target.value);
                if (val >= 2 && val !== ws.event.totalCapacity) {
                  patchEvent({ totalCapacity: val });
                }
              }}
              className="mt-1 w-16 rounded border border-border bg-background px-2 py-0.5 text-sm font-semibold text-foreground"
            />
          </div>
          <div className="rounded-lg bg-surface-elevated border border-border p-3">
            <span className="text-muted block">Attending Hosts</span>
            <span className="mt-1 block text-lg font-semibold">
              {ws.capacity.attendingHostCount}
            </span>
          </div>
          <div className="rounded-lg bg-surface-elevated border border-border p-3">
            <span className="text-muted block">Guest Places</span>
            <span className="mt-1 block text-lg font-semibold text-accent">
              {ws.capacity.guestCapacity}
            </span>
          </div>
          <div className="rounded-lg bg-surface-elevated border border-border p-3">
            <span className="text-muted block">Confirmed</span>
            <span className="mt-1 block text-lg font-semibold">
              {ws.capacity.confirmedGuestCount}
            </span>
          </div>
          <div className="rounded-lg bg-surface-elevated border border-border p-3">
            <span className="text-muted block">Open Guest Seats</span>
            <span className="mt-1 block text-lg font-semibold text-success">
              {ws.capacity.availableGuestPlaces}
            </span>
          </div>
          <div className="rounded-lg bg-surface-elevated border border-border p-3">
            <span className="text-muted block">Waitlist / Offered</span>
            <span className="mt-1 block text-lg font-semibold">
              {ws.capacity.waitlistedCount} / {ws.capacity.offeredPlaceCount}
            </span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="text-muted">Hosts attending (count toward room cap):</span>
          {ws.founders.map((f) => {
            const attending = attendingHostIds.has(f.id);
            return (
              <button
                key={f.id}
                type="button"
                disabled={busy}
                onClick={() => toggleHost(f.id)}
                className={`rounded-lg border px-2.5 py-1 transition-colors ${
                  attending
                    ? "border-accent bg-accent/15 text-accent font-medium"
                    : "border-border bg-surface-elevated text-muted"
                }`}
              >
                {attending ? "✓ " : ""}
                {f.name}
              </button>
            );
          })}
        </div>
      </section>

      {ws.capacity.hasFreedPlaceForWaitlist && (
        <div className="rounded-xl border border-warning/40 bg-warning/10 p-4 flex items-start gap-3 text-xs text-warning">
          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold">
              {ws.capacity.availableGuestPlaces} guest seat(s) free with{" "}
              {ws.capacity.waitlistedCount} contact(s) on the waitlist
            </p>
            <p className="mt-0.5 opacity-90">
              No automatic promotion or sending occurs. Choose a waitlisted
              person below and click <strong>Offer Place</strong> manually.
            </p>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-2 border-b border-border pb-2">
        {(
          [
            ["invitees", `Invitees & Waitlist (${ws.invitations.length})`],
            ["logistics", "Booking & Payments"],
            ["preread", "Preread & Post-Event"],
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

      {/* TAB 1: Invitees & Waitlist */}
      {activeTab === "invitees" && (
        <div className="space-y-4">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
            <div className="relative flex-1 max-w-sm">
              <Search className="h-3.5 w-3.5 text-muted absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={inviteSearch}
                onChange={(e) => setInviteSearch(e.target.value)}
                placeholder="Search invitees by name, company, or role..."
                className="w-full rounded-lg border border-border bg-surface pl-8 pr-3 py-1.5 text-xs text-foreground focus:outline-none focus:border-accent"
              />
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => {
                  setShowFolkModal(true);
                  searchFolk("");
                }}
                className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3.5 py-2 text-xs font-semibold text-accent-foreground"
              >
                <UserPlus className="h-3.5 w-3.5" />
                Add from Folk CRM
              </button>
              <button
                type="button"
                onClick={() => setShowCarryModal(true)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface-elevated px-3.5 py-2 text-xs font-medium text-foreground hover:border-accent/50"
              >
                Manual Carry-Forward ({ws.manualCarryForwardOptions.length})
              </button>
            </div>
          </div>

          <div className="flex flex-wrap gap-1.5">
            {(
              [
                ["all", "All"],
                ["confirmed", "Confirmed"],
                ["provisional", "Not invited yet"],
                ["no_response", "Invited — no reply"],
                ["maybe", "Maybe"],
                ["waitlist", "Waitlist"],
                ["declined", "Declined"],
                ["cancelled_noshow", "Cancelled / No-show"],
              ] as const
            ).map(([key, label]) => {
              const count = ws.invitations.filter((inv) =>
                matchesInviteFilter(inv, key),
              ).length;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => setInviteFilter(key)}
                  className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${
                    inviteFilter === key
                      ? "border-accent bg-accent/15 text-accent font-medium"
                      : "border-border bg-surface text-muted hover:text-foreground"
                  }`}
                >
                  {label} ({count})
                </button>
              );
            })}
          </div>

          {filteredInvitees.length === 0 ? (
            <div className="rounded-xl border border-border bg-surface p-6 text-sm text-muted">
              No invitees match this view. Click{" "}
              <strong className="text-foreground">Add from Folk CRM</strong> to
              link prospects directly from Folk.
            </div>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-border bg-surface">
              <table className="w-full text-left text-xs border-collapse">
                <thead className="bg-surface-elevated text-muted border-b border-border">
                  <tr>
                    <th className="px-4 py-2.5 font-medium min-w-[190px]">
                      Contact
                    </th>
                    <th className="px-4 py-2.5 font-medium min-w-[200px] max-w-[270px]">
                      Company &amp; Role
                    </th>
                    <th className="px-3 py-2.5 font-medium w-[170px]">
                      Invite Status
                    </th>
                    <th className="px-3 py-2.5 font-medium w-[125px]">
                      Attendance
                    </th>
                    <th className="px-3 py-2.5 font-medium w-[130px]">
                      Chase
                    </th>
                    <th className="px-4 py-2.5 font-medium text-right w-[120px]">
                      Details
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {filteredInvitees.map((inv) => {
                    const isExpanded = expandedInvId === inv.id;
                    const notes = noteEdits[inv.id] ?? {
                      dietaryNotes: inv.dietaryNotes ?? "",
                      specialRequests: inv.specialRequests ?? "",
                      earlyDepartureNote: inv.earlyDepartureNote ?? "",
                    };
                    const hasSavedNotes = Boolean(
                      inv.dietaryNotes ||
                        inv.specialRequests ||
                        inv.earlyDepartureNote,
                    );

                    return (
                      <Fragment key={inv.id}>
                        <tr className="hover:bg-surface-elevated/30 transition-colors">
                          <td className="px-4 py-3 align-top">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="font-semibold text-foreground">
                                {inv.person?.fullName ?? "Unknown Contact"}
                              </span>
                              {inv.carriedForwardFromEventId && (
                                <span className="rounded bg-accent/15 px-1.5 py-0.5 text-[10px] font-medium text-accent">
                                  Carried forward
                                </span>
                              )}
                              {inv.waitlistStatus !== "none" && (
                                <span className="rounded bg-warning/15 border border-warning/30 px-1.5 py-0.5 text-[10px] font-mono text-warning">
                                  {inv.waitlistStatus === "offered_place"
                                    ? "offered place"
                                    : inv.waitlistStatus === "confirmed_replacement"
                                      ? "replacement"
                                      : "waitlisted"}
                                </span>
                              )}
                              {inv.person?.contactSuppressed && (
                                <span className="rounded bg-danger/15 px-1.5 py-0.5 text-[10px] font-medium text-danger">
                                  DNC
                                </span>
                              )}
                            </div>
                            <p className="text-[11px] text-muted mt-0.5 truncate max-w-[230px]">
                              {inv.person?.email ? (
                                inv.person.email
                              ) : (
                                <>
                                  No email in Folk ·{" "}
                                  <button
                                    type="button"
                                    onClick={() => openRelinkPicker(inv)}
                                    className="text-accent hover:underline"
                                  >
                                    Fix Folk link
                                  </button>
                                </>
                              )}
                            </p>
                          </td>

                          <td className="px-4 py-3 align-top max-w-[270px]">
                            {inv.person?.companyName || inv.person?.jobTitle ? (
                              <div className="space-y-0.5">
                                <p
                                  title={inv.person.companyName ?? undefined}
                                  className="font-medium text-foreground truncate"
                                >
                                  {inv.person.companyName ?? "—"}
                                </p>
                                <p
                                  title={inv.person.jobTitle ?? undefined}
                                  className="text-[11px] text-muted truncate"
                                >
                                  {inv.person.jobTitle ?? ""}
                                </p>
                              </div>
                            ) : (
                              <span className="text-muted">—</span>
                            )}
                          </td>

                          <td className="px-3 py-3 align-top">
                            <select
                              aria-label="Invite status"
                              disabled={busy}
                              value={inv.responseStatus}
                              onChange={(e) =>
                                patchInvitee(inv.id, {
                                  responseStatus: e.target.value,
                                })
                              }
                              className={`w-full rounded-lg border bg-surface-elevated px-2.5 py-1.5 text-xs font-medium ${responseSelectTone(inv.responseStatus)}`}
                            >
                              {(
                                Object.entries(RESPONSE_LABELS) as Array<
                                  [SerializedInvitee["responseStatus"], string]
                                >
                              ).map(([val, lbl]) => (
                                <option key={val} value={val}>
                                  {lbl}
                                </option>
                              ))}
                            </select>
                          </td>

                          <td className="px-3 py-3 align-top">
                            <select
                              aria-label="Attendance outcome"
                              disabled={busy}
                              value={inv.attendanceOutcome}
                              onChange={(e) =>
                                patchInvitee(inv.id, {
                                  attendanceOutcome: e.target.value,
                                })
                              }
                              className="w-full rounded-lg border border-border bg-surface-elevated px-2.5 py-1.5 text-xs text-foreground"
                            >
                              {(
                                Object.entries(ATTENDANCE_LABELS) as Array<
                                  [SerializedInvitee["attendanceOutcome"], string]
                                >
                              ).map(([val, lbl]) => (
                                <option key={val} value={val}>
                                  {lbl}
                                </option>
                              ))}
                            </select>
                          </td>

                          <td className="px-3 py-3 align-top">
                            <select
                              aria-label="Chase status"
                              disabled={busy}
                              value={inv.chaseStatus}
                              onChange={(e) =>
                                patchInvitee(inv.id, {
                                  chaseStatus: e.target.value,
                                })
                              }
                              className="w-full rounded-lg border border-border bg-surface-elevated px-2.5 py-1.5 text-xs text-foreground"
                            >
                              {Object.entries(CHASE_LABELS).map(([val, lbl]) => (
                                <option key={val} value={val}>
                                  {lbl}
                                </option>
                              ))}
                            </select>
                          </td>

                          <td className="px-4 py-3 align-top text-right whitespace-nowrap">
                            <div className="inline-flex items-center gap-1.5 justify-end">
                              {inv.waitlistStatus === "waitlisted" &&
                                ws.capacity.availableGuestPlaces > 0 && (
                                  <button
                                    type="button"
                                    disabled={busy}
                                    onClick={() =>
                                      patchInvitee(inv.id, {
                                        waitlistAction: "offer_place",
                                      })
                                    }
                                    className="rounded-lg bg-warning px-2.5 py-1 text-[11px] font-semibold text-black"
                                  >
                                    Offer Place
                                  </button>
                                )}

                              {inv.waitlistStatus === "offered_place" &&
                                ws.capacity.availableGuestPlaces > 0 && (
                                  <button
                                    type="button"
                                    disabled={busy}
                                    onClick={() =>
                                      patchInvitee(inv.id, {
                                        waitlistAction: "confirm_replacement",
                                      })
                                    }
                                    className="rounded-lg bg-success px-2.5 py-1 text-[11px] font-semibold text-black"
                                  >
                                    Confirm
                                  </button>
                                )}

                              <button
                                type="button"
                                onClick={() =>
                                  setExpandedInvId(isExpanded ? null : inv.id)
                                }
                                className="inline-flex items-center gap-1 rounded-lg border border-border bg-surface-elevated px-2.5 py-1.5 text-xs text-muted hover:text-foreground"
                              >
                                {hasSavedNotes && (
                                  <span className="h-1.5 w-1.5 rounded-full bg-accent" />
                                )}
                                <span>Notes</span>
                                {isExpanded ? (
                                  <ChevronUp className="h-3.5 w-3.5" />
                                ) : (
                                  <ChevronDown className="h-3.5 w-3.5" />
                                )}
                              </button>
                            </div>
                          </td>
                        </tr>

                        {isExpanded && (
                          <tr className="bg-surface-elevated/40">
                            <td colSpan={6} className="px-4 py-4 space-y-4">
                              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                                <div className="space-y-1">
                                  <label className="text-[11px] text-muted block">
                                    Dietary Requirements (event-only)
                                  </label>
                                  <input
                                    type="text"
                                    value={notes.dietaryNotes}
                                    onChange={(e) =>
                                      setNoteEdits((prev) => ({
                                        ...prev,
                                        [inv.id]: {
                                          ...notes,
                                          dietaryNotes: e.target.value,
                                        },
                                      }))
                                    }
                                    placeholder="e.g. Vegetarian"
                                    className="w-full rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs"
                                  />
                                </div>
                                <div className="space-y-1">
                                  <label className="text-[11px] text-muted block">
                                    Special Requests (event-only)
                                  </label>
                                  <input
                                    type="text"
                                    value={notes.specialRequests}
                                    onChange={(e) =>
                                      setNoteEdits((prev) => ({
                                        ...prev,
                                        [inv.id]: {
                                          ...notes,
                                          specialRequests: e.target.value,
                                        },
                                      }))
                                    }
                                    placeholder="e.g. Quiet seat"
                                    className="w-full rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs"
                                  />
                                </div>
                                <div className="space-y-1">
                                  <label className="text-[11px] text-muted block">
                                    Timing / Early Departure (event-only)
                                  </label>
                                  <input
                                    type="text"
                                    value={notes.earlyDepartureNote}
                                    onChange={(e) =>
                                      setNoteEdits((prev) => ({
                                        ...prev,
                                        [inv.id]: {
                                          ...notes,
                                          earlyDepartureNote: e.target.value,
                                        },
                                      }))
                                    }
                                    placeholder="e.g. Leaves 9:15am"
                                    className="w-full rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs"
                                  />
                                </div>
                              </div>

                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <div className="flex flex-wrap gap-2">
                                  <button
                                    type="button"
                                    disabled={busy}
                                    onClick={() => patchInvitee(inv.id, notes)}
                                    className="rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-accent-foreground"
                                  >
                                    Save Event Notes
                                  </button>
                                  <button
                                    type="button"
                                    disabled={busy}
                                    onClick={() => draftApprovalMessage(inv)}
                                    className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-1.5 text-xs hover:border-accent/50"
                                  >
                                    <MailPlus className="h-3.5 w-3.5 text-accent" />
                                    Queue Message Draft for Approval
                                  </button>
                                  <button
                                    type="button"
                                    disabled={busy}
                                    onClick={() =>
                                      patchInvitee(inv.id, { syncFromFolk: true })
                                    }
                                    className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-1.5 text-xs hover:border-accent/50"
                                  >
                                    <RefreshCw className="h-3.5 w-3.5 text-accent" />
                                    Refresh from Folk
                                  </button>
                                  <button
                                    type="button"
                                    disabled={busy}
                                    onClick={() => openRelinkPicker(inv)}
                                    className="inline-flex items-center gap-1.5 rounded-lg border border-accent/40 bg-accent/10 px-3 py-1.5 text-xs font-medium text-accent hover:bg-accent/20"
                                  >
                                    <Link2 className="h-3.5 w-3.5" />
                                    Change Linked Folk Record
                                  </button>
                                </div>

                                <div className="flex flex-wrap gap-2">
                                  <button
                                    type="button"
                                    disabled={busy}
                                    onClick={() =>
                                      patchInvitee(inv.id, {
                                        contactSuppressed:
                                          !inv.person?.contactSuppressed,
                                      })
                                    }
                                    className="rounded-lg border border-danger/40 px-3 py-1.5 text-xs text-danger hover:bg-danger/10"
                                  >
                                    {inv.person?.contactSuppressed
                                      ? "Remove Do Not Contact Flag"
                                      : "Mark Do Not Contact"}
                                  </button>
                                  <button
                                    type="button"
                                    disabled={busy}
                                    onClick={() => removeInvitee(inv)}
                                    className="inline-flex items-center gap-1.5 rounded-lg border border-danger/40 bg-danger/10 px-3 py-1.5 text-xs text-danger hover:bg-danger/20"
                                  >
                                    <Trash2 className="h-3.5 w-3.5" />
                                    Remove from Event
                                  </button>
                                </div>
                              </div>

                              {relinkingInvId === inv.id && (
                                <div className="rounded-lg border border-accent/40 bg-surface p-3.5 space-y-3">
                                  <div className="flex items-center justify-between gap-2">
                                    <p className="text-xs font-semibold text-foreground">
                                      Pick the Right Folk CRM Record for{" "}
                                      {inv.person?.fullName}
                                    </p>
                                    <button
                                      type="button"
                                      onClick={() => setRelinkingInvId(null)}
                                      className="text-muted hover:text-foreground"
                                    >
                                      <X className="h-3.5 w-3.5" />
                                    </button>
                                  </div>

                                  <div className="flex gap-2">
                                    <input
                                      type="text"
                                      value={relinkQuery}
                                      onChange={(e) =>
                                        setRelinkQuery(e.target.value)
                                      }
                                      onKeyDown={(e) => {
                                        if (e.key === "Enter") {
                                          e.preventDefault();
                                          void searchRelinkFolk(relinkQuery);
                                        }
                                      }}
                                      placeholder="Search Folk by name, email, or company..."
                                      className="flex-1 rounded-lg border border-border bg-surface-elevated px-3 py-1.5 text-xs text-foreground"
                                    />
                                    <button
                                      type="button"
                                      disabled={relinkLoading}
                                      onClick={() =>
                                        searchRelinkFolk(relinkQuery)
                                      }
                                      className="inline-flex items-center gap-1 rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-accent-foreground disabled:opacity-40"
                                    >
                                      <Search className="h-3 w-3" />
                                      {relinkLoading ? "Searching..." : "Search"}
                                    </button>
                                  </div>

                                  {relinkLoading ? (
                                    <p className="text-xs text-muted">
                                      Searching Folk CRM...
                                    </p>
                                  ) : relinkResults.length === 0 ? (
                                    <p className="text-xs text-muted">
                                      No Folk contacts matched &ldquo;
                                      {relinkQuery}&rdquo;. Try searching by
                                      surname or company name.
                                    </p>
                                  ) : (
                                    <div className="max-h-56 overflow-y-auto divide-y divide-border rounded-lg border border-border">
                                      {relinkResults.map((person) => (
                                        <div
                                          key={person.folkPersonId}
                                          className="flex items-center justify-between gap-3 px-3 py-2 text-xs bg-surface-elevated/40"
                                        >
                                          <div className="min-w-0">
                                            <p className="font-medium text-foreground truncate">
                                              {person.fullName}
                                              {person.companyName
                                                ? ` — ${person.companyName}`
                                                : ""}
                                            </p>
                                            <p className="text-[11px] text-muted truncate">
                                              {[person.jobTitle, person.email]
                                                .filter(Boolean)
                                                .join(" · ") ||
                                                person.folkPersonId}
                                            </p>
                                          </div>
                                          <button
                                            type="button"
                                            disabled={busy}
                                            onClick={() =>
                                              applyRelinkFolk(inv, person)
                                            }
                                            className="shrink-0 rounded-md border border-accent/40 bg-accent/15 px-2.5 py-1 text-[11px] font-medium text-accent hover:bg-accent/25"
                                          >
                                            Use This Folk Record
                                          </button>
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              )}

                              {inv.history.length > 0 && (
                                <div className="space-y-1.5 text-[11px] text-muted">
                                  <div className="flex items-center gap-1 text-foreground font-medium">
                                    <History className="h-3 w-3" />
                                    Status History
                                  </div>
                                  <ul className="space-y-1">
                                    {inv.history.map((h) => (
                                      <li key={h.id}>
                                        {new Date(h.createdAt).toLocaleString(
                                          "en-GB",
                                        )}{" "}
                                        — status:{" "}
                                        {h.previousResponseStatus
                                          ? (RESPONSE_LABELS[
                                              h.previousResponseStatus as SerializedInvitee["responseStatus"]
                                            ] ?? h.previousResponseStatus)
                                          : "—"}{" "}
                                        →{" "}
                                        <strong className="text-foreground">
                                          {RESPONSE_LABELS[
                                            h.newResponseStatus as SerializedInvitee["responseStatus"]
                                          ] ?? h.newResponseStatus}
                                        </strong>
                                        , attendance:{" "}
                                        {h.previousAttendanceOutcome
                                          ? (ATTENDANCE_LABELS[
                                              h.previousAttendanceOutcome as SerializedInvitee["attendanceOutcome"]
                                            ] ?? h.previousAttendanceOutcome)
                                          : "—"}{" "}
                                        →{" "}
                                        <strong className="text-foreground">
                                          {ATTENDANCE_LABELS[
                                            h.newAttendanceOutcome as SerializedInvitee["attendanceOutcome"]
                                          ] ?? h.newAttendanceOutcome}
                                        </strong>
                                        {h.newWaitlistStatus !== "none"
                                          ? `, waitlist: ${h.newWaitlistStatus}`
                                          : ""}
                                        {h.note ? ` (${h.note})` : ""}
                                      </li>
                                    ))}
                                  </ul>
                                </div>
                              )}

                              {inv.person?.folkPersonId && (
                                <p className="text-[11px] text-muted font-mono">
                                  Folk ID: {inv.person.folkPersonId}
                                </p>
                              )}
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* TAB 2: Booking & Payments */}
      {activeTab === "logistics" && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            patchEvent(
              {
                venueName,
                venueAddress,
                bookingStatus,
                bookingReference,
                venueContact,
                bookingDocsUrl,
                logisticsOwnerUserId: logisticsOwnerUserId || null,
                depositAmountPence: gbpStringToPence(depositGbp),
                depositDueDate: depositDueDate
                  ? new Date(depositDueDate).toISOString()
                  : null,
                depositInvoiceRef,
                depositPaid,
                balanceAmountPence: gbpStringToPence(balanceGbp),
                balanceDueDate: balanceDueDate
                  ? new Date(balanceDueDate).toISOString()
                  : null,
                balanceInvoiceRef,
                balancePaid,
              },
              "Saved venue booking and payment obligations.",
            );
          }}
          className="space-y-6"
        >
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="rounded-xl border border-border bg-surface p-5 space-y-4">
              <h2 className="text-sm font-semibold">Venue &amp; Booking</h2>
              <div className="space-y-3 text-xs">
                <div>
                  <label className="text-muted block mb-1">Venue Name</label>
                  <input
                    type="text"
                    value={venueName}
                    onChange={(e) => setVenueName(e.target.value)}
                    className="w-full rounded-lg border border-border bg-surface-elevated px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="text-muted block mb-1">Venue Address</label>
                  <input
                    type="text"
                    value={venueAddress}
                    onChange={(e) => setVenueAddress(e.target.value)}
                    className="w-full rounded-lg border border-border bg-surface-elevated px-3 py-2 text-sm"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-muted block mb-1">
                      Booking Status
                    </label>
                    <select
                      value={bookingStatus}
                      onChange={(e) => setBookingStatus(e.target.value)}
                      className="w-full rounded-lg border border-border bg-surface-elevated px-3 py-2 text-sm"
                    >
                      <option value="unconfirmed">unconfirmed</option>
                      <option value="provisional_hold">provisional hold</option>
                      <option value="confirmed">confirmed</option>
                      <option value="cancelled">cancelled</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-muted block mb-1">
                      Booking Reference
                    </label>
                    <input
                      type="text"
                      value={bookingReference}
                      onChange={(e) => setBookingReference(e.target.value)}
                      className="w-full rounded-lg border border-border bg-surface-elevated px-3 py-2 text-sm"
                    />
                  </div>
                </div>
                <div>
                  <label className="text-muted block mb-1">Venue Contact</label>
                  <input
                    type="text"
                    value={venueContact}
                    onChange={(e) => setVenueContact(e.target.value)}
                    placeholder="Events manager name / email / phone"
                    className="w-full rounded-lg border border-border bg-surface-elevated px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="text-muted block mb-1">
                    Confirmation / Contract Docs URL
                  </label>
                  <input
                    type="url"
                    value={bookingDocsUrl}
                    onChange={(e) => setBookingDocsUrl(e.target.value)}
                    placeholder="https://..."
                    className="w-full rounded-lg border border-border bg-surface-elevated px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="text-muted block mb-1">
                    Founder Responsible for Logistics
                  </label>
                  <select
                    value={logisticsOwnerUserId}
                    onChange={(e) => setLogisticsOwnerUserId(e.target.value)}
                    className="w-full rounded-lg border border-border bg-surface-elevated px-3 py-2 text-sm"
                  >
                    <option value="">Unassigned</option>
                    {ws.founders.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            <div className="rounded-xl border border-border bg-surface p-5 space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold flex items-center gap-2">
                  <CreditCard className="h-4 w-4 text-accent" />
                  Payment Obligations (Tracking Only)
                </h2>
                <span className="text-[11px] text-muted">
                  No payments executed here
                </span>
              </div>

              <div className="rounded-lg border border-border bg-surface-elevated p-3.5 space-y-3 text-xs">
                <p className="font-medium text-foreground">Deposit</p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-muted block mb-1">Amount (£)</label>
                    <input
                      type="text"
                      value={depositGbp}
                      onChange={(e) => setDepositGbp(e.target.value)}
                      placeholder="0.00"
                      className="w-full rounded border border-border bg-background px-2.5 py-1.5 text-sm"
                    />
                  </div>
                  <div>
                    <label className="text-muted block mb-1">Due Date</label>
                    <input
                      type="date"
                      value={depositDueDate}
                      onChange={(e) => setDepositDueDate(e.target.value)}
                      className="w-full rounded border border-border bg-background px-2.5 py-1.5 text-sm"
                    />
                  </div>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <input
                    type="text"
                    value={depositInvoiceRef}
                    onChange={(e) => setDepositInvoiceRef(e.target.value)}
                    placeholder="Invoice / receipt ref"
                    className="flex-1 rounded border border-border bg-background px-2.5 py-1.5 text-xs"
                  />
                  <label className="inline-flex items-center gap-1.5 font-medium">
                    <input
                      type="checkbox"
                      checked={depositPaid}
                      onChange={(e) => setDepositPaid(e.target.checked)}
                    />
                    Paid
                  </label>
                </div>
              </div>

              <div className="rounded-lg border border-border bg-surface-elevated p-3.5 space-y-3 text-xs">
                <p className="font-medium text-foreground">Remaining Balance</p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-muted block mb-1">Amount (£)</label>
                    <input
                      type="text"
                      value={balanceGbp}
                      onChange={(e) => setBalanceGbp(e.target.value)}
                      placeholder="0.00"
                      className="w-full rounded border border-border bg-background px-2.5 py-1.5 text-sm"
                    />
                  </div>
                  <div>
                    <label className="text-muted block mb-1">Due Date</label>
                    <input
                      type="date"
                      value={balanceDueDate}
                      onChange={(e) => setBalanceDueDate(e.target.value)}
                      className="w-full rounded border border-border bg-background px-2.5 py-1.5 text-sm"
                    />
                  </div>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <input
                    type="text"
                    value={balanceInvoiceRef}
                    onChange={(e) => setBalanceInvoiceRef(e.target.value)}
                    placeholder="Invoice / receipt ref"
                    className="flex-1 rounded border border-border bg-background px-2.5 py-1.5 text-xs"
                  />
                  <label className="inline-flex items-center gap-1.5 font-medium">
                    <input
                      type="checkbox"
                      checked={balancePaid}
                      onChange={(e) => setBalancePaid(e.target.checked)}
                    />
                    Paid
                  </label>
                </div>
              </div>
            </div>
          </div>

          <button
            type="submit"
            disabled={busy}
            className="rounded-lg bg-accent px-5 py-2 text-xs font-semibold text-accent-foreground"
          >
            Save Booking &amp; Payments
          </button>
        </form>
      )}

      {/* TAB 3: Preread & Post-Event */}
      {activeTab === "preread" && (
        <div className="space-y-6">
          <div className="rounded-xl border border-border bg-surface p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-accent" />
                <h2 className="text-sm font-semibold">
                  Claude Preread Workflow
                </h2>
              </div>
              <button
                type="button"
                onClick={copyPrereadContext}
                className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface-elevated px-3 py-1.5 text-xs font-medium hover:border-accent/50"
              >
                {copiedPreread ? (
                  <>
                    <Check className="h-3.5 w-3.5 text-success" /> Copied
                    Markdown for Claude
                  </>
                ) : (
                  <>
                    <Copy className="h-3.5 w-3.5 text-accent" /> Copy Claude
                    Preread Context
                  </>
                )}
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="text-muted block mb-1">
                  Finished Preread Link (Google Doc / Notion / Claude)
                </label>
                <input
                  type="url"
                  value={prereadUrl}
                  onChange={(e) => setPrereadUrl(e.target.value)}
                  placeholder="https://..."
                  className="w-full rounded-lg border border-border bg-surface-elevated px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="text-muted block mb-1">
                  Host Priorities / Room Context Notes for Claude
                </label>
                <textarea
                  rows={3}
                  value={prereadNotes}
                  onChange={(e) => setPrereadNotes(e.target.value)}
                  placeholder="Key themes, introductions to facilitate, hosting goals..."
                  className="w-full rounded-lg border border-border bg-surface-elevated px-3 py-2 text-sm"
                />
              </div>
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  patchEvent(
                    { prereadUrl, prereadNotes },
                    "Saved preread link and context notes.",
                  )
                }
                className="rounded-lg bg-accent px-4 py-2 text-xs font-semibold text-accent-foreground"
              >
                Save Preread Details
              </button>
            </div>
          </div>

          {/* Post-Event Attendee Follow-Up Tracker */}
          {(() => {
            const attendees = ws.invitations.filter(
              (i) => i.attendanceOutcome === "attended",
            );
            const followedUpCount = attendees.filter((a) =>
              ["sent", "replied"].includes(
                a.postEventFollowUp?.status ?? "not_started",
              ),
            ).length;
            const repliedCount = attendees.filter(
              (a) => a.postEventFollowUp?.status === "replied",
            ).length;
            const FOLLOW_LABELS: Record<
              "not_started" | "drafted" | "approved" | "sent" | "replied",
              { label: string; style: string }
            > = {
              not_started: {
                label: "Not started",
                style: "border-border bg-surface-elevated text-muted",
              },
              drafted: {
                label: "Draft in Approvals",
                style: "border-warning/30 bg-warning/10 text-warning",
              },
              approved: {
                label: "Approved (ready)",
                style: "border-accent/40 bg-accent/15 text-accent",
              },
              sent: {
                label: "Sent",
                style: "border-success/30 bg-success/10 text-success",
              },
              replied: {
                label: "Replied / Referred",
                style: "border-success/40 bg-success/20 text-success font-medium",
              },
            };

            return (
              <div className="rounded-xl border border-border bg-surface p-5 space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <h2 className="text-sm font-semibold">
                      Post-Event Attendee Follow-Up &amp; Recommendation Ask
                    </h2>
                    <p className="text-[11px] text-muted mt-0.5">
                      {attendees.length === 0
                        ? "Mark attendees as Attended on the Invitees tab after the breakfast to track post-event thank-you & referral emails."
                        : `${followedUpCount} of ${attendees.length} attendees followed up · ${repliedCount} replied · ${ws.referrals.length} referral(s) captured`}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Link
                      href="/approvals"
                      className="rounded-lg border border-border bg-surface-elevated px-3 py-1.5 text-xs hover:border-accent/50"
                    >
                      Open Message Approvals →
                    </Link>
                    <button
                      type="button"
                      disabled={busy || attendees.length === 0}
                      onClick={queueAllPostEventDrafts}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3.5 py-1.5 text-xs font-semibold text-accent-foreground disabled:opacity-40"
                    >
                      <MailPlus className="h-3.5 w-3.5" />
                      Queue Thank-You &amp; Referral Drafts
                    </button>
                  </div>
                </div>

                {attendees.length > 0 && (
                  <div className="overflow-x-auto rounded-lg border border-border">
                    <table className="w-full text-left text-xs border-collapse min-w-[640px]">
                      <thead>
                        <tr className="border-b border-border bg-surface-elevated/60 text-[11px] text-muted">
                          <th className="py-2 px-3 font-medium">Attendee</th>
                          <th className="py-2 px-3 font-medium">Company</th>
                          <th className="py-2 px-3 font-medium">Follow-Up Status</th>
                          <th className="py-2 px-3 font-medium">Referrals</th>
                          <th className="py-2 px-3 font-medium text-right">
                            Actions
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {attendees.map((att) => {
                          const st =
                            att.postEventFollowUp?.status ?? "not_started";
                          const badge = FOLLOW_LABELS[st];
                          const refs = att.postEventFollowUp?.referralCount ?? 0;
                          return (
                            <tr key={att.id}>
                              <td className="py-2.5 px-3">
                                <span className="font-medium text-foreground block">
                                  {att.person?.fullName ?? "Attendee"}
                                </span>
                                <span className="text-[11px] text-muted">
                                  {att.person?.email ?? "No email in Folk"}
                                </span>
                              </td>
                              <td className="py-2.5 px-3 text-muted">
                                {att.person?.companyName ?? "—"}
                              </td>
                              <td className="py-2.5 px-3">
                                <span
                                  className={`rounded-full border px-2 py-0.5 text-[11px] ${badge.style}`}
                                >
                                  {badge.label}
                                </span>
                              </td>
                              <td className="py-2.5 px-3 tabular-nums text-muted">
                                {refs}
                              </td>
                              <td className="py-2.5 px-3 text-right">
                                <div className="inline-flex items-center gap-1.5">
                                  {st !== "sent" && st !== "replied" && (
                                    <button
                                      type="button"
                                      disabled={busy}
                                      onClick={() =>
                                        markPostEventFollowUpStatus(
                                          att.folkPersonLinkId,
                                          "sent",
                                        )
                                      }
                                      className="rounded border border-border px-2 py-1 text-[11px] hover:border-accent/50"
                                    >
                                      Mark Sent
                                    </button>
                                  )}
                                  {st !== "replied" && (
                                    <button
                                      type="button"
                                      disabled={busy}
                                      onClick={() =>
                                        markPostEventFollowUpStatus(
                                          att.folkPersonLinkId,
                                          "replied",
                                        )
                                      }
                                      className="rounded border border-success/40 px-2 py-1 text-[11px] text-success hover:bg-success/10"
                                    >
                                      Mark Replied
                                    </button>
                                  )}
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })()}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="rounded-xl border border-border bg-surface p-5 space-y-4">
              <div>
                <h2 className="text-sm font-semibold">
                  Event-Level Feedback
                </h2>
                <p className="text-[11px] text-muted mt-0.5">
                  Feedback on format, venue, and attendee mix stays here (never
                  mixed into personal Folk records).
                </p>
              </div>

              <form onSubmit={submitFeedback} className="space-y-2.5 text-xs">
                <select
                  value={fbCategory}
                  onChange={(e) =>
                    setFbCategory(
                      e.target.value as
                        | "event"
                        | "format"
                        | "venue"
                        | "attendee_mix"
                        | "content",
                    )
                  }
                  className="w-full rounded-lg border border-border bg-surface-elevated px-3 py-2 text-xs"
                >
                  <option value="event">Overall Event</option>
                  <option value="format">Format</option>
                  <option value="venue">Venue</option>
                  <option value="attendee_mix">Attendee Mix</option>
                  <option value="content">Content / Discussion</option>
                </select>
                <textarea
                  rows={2}
                  required
                  value={fbSummary}
                  onChange={(e) => setFbSummary(e.target.value)}
                  placeholder="Record feedback..."
                  className="w-full rounded-lg border border-border bg-surface-elevated px-3 py-2 text-xs"
                />
                <button
                  type="submit"
                  disabled={busy}
                  className="rounded-lg bg-accent px-3.5 py-1.5 text-xs font-semibold text-accent-foreground"
                >
                  Add Feedback
                </button>
              </form>

              <ul className="space-y-2 text-xs">
                {ws.feedback.map((fb) => (
                  <li
                    key={fb.id}
                    className="rounded-lg border border-border bg-surface-elevated p-2.5"
                  >
                    <span className="font-mono text-accent">[{fb.category}]</span>{" "}
                    {fb.summary}
                  </li>
                ))}
              </ul>
            </div>

            <div className="rounded-xl border border-border bg-surface p-5 space-y-4">
              <div>
                <h2 className="text-sm font-semibold">
                  Attendee Recommendations &amp; Referrals
                </h2>
                <p className="text-[11px] text-muted mt-0.5">
                  Track suggested CMOs to research and invite to future
                  breakfasts.
                </p>
              </div>

              <form onSubmit={submitReferral} className="space-y-2.5 text-xs">
                <div className="grid grid-cols-2 gap-2">
                  <input
                    type="text"
                    required
                    value={refName}
                    onChange={(e) => setRefName(e.target.value)}
                    placeholder="Recommended name *"
                    className="rounded-lg border border-border bg-surface-elevated px-2.5 py-1.5"
                  />
                  <input
                    type="text"
                    value={refCompany}
                    onChange={(e) => setRefCompany(e.target.value)}
                    placeholder="Company"
                    className="rounded-lg border border-border bg-surface-elevated px-2.5 py-1.5"
                  />
                  <input
                    type="text"
                    value={refRole}
                    onChange={(e) => setRefRole(e.target.value)}
                    placeholder="Role / Title"
                    className="rounded-lg border border-border bg-surface-elevated px-2.5 py-1.5"
                  />
                  <input
                    type="email"
                    value={refEmail}
                    onChange={(e) => setRefEmail(e.target.value)}
                    placeholder="Email (optional)"
                    className="rounded-lg border border-border bg-surface-elevated px-2.5 py-1.5"
                  />
                </div>
                <select
                  value={refByPersonId}
                  onChange={(e) => setRefByPersonId(e.target.value)}
                  className="w-full rounded-lg border border-border bg-surface-elevated px-2.5 py-1.5"
                >
                  <option value="">Recommended by (optional)</option>
                  {ws.invitations.map((inv) => (
                    <option key={inv.id} value={inv.folkPersonLinkId}>
                      {inv.person?.fullName ?? inv.folkPersonLinkId}
                    </option>
                  ))}
                </select>
                <input
                  type="text"
                  value={refNotes}
                  onChange={(e) => setRefNotes(e.target.value)}
                  placeholder="Context note"
                  className="w-full rounded-lg border border-border bg-surface-elevated px-2.5 py-1.5"
                />
                <button
                  type="submit"
                  disabled={busy}
                  className="rounded-lg bg-accent px-3.5 py-1.5 text-xs font-semibold text-accent-foreground"
                >
                  Capture Referral
                </button>
              </form>

              <ul className="space-y-2 text-xs">
                {ws.referrals.map((r) => (
                  <li
                    key={r.id}
                    className="rounded-lg border border-border bg-surface-elevated p-2.5 flex items-center justify-between gap-2"
                  >
                    <div>
                      <p className="font-medium text-foreground">
                        {r.referredName}
                        {r.referredCompany ? ` · ${r.referredCompany}` : ""}
                      </p>
                      <p className="text-muted">
                        {[r.referredRole, r.referredEmail, r.notes]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                    </div>
                    <select
                      value={r.status}
                      onChange={async (e) => {
                        await fetch(`/api/breakfasts/${ws.event.id}/referrals`, {
                          method: "PATCH",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({
                            referralId: r.id,
                            status: e.target.value,
                          }),
                        });
                        await refreshWorkspace();
                      }}
                      className="rounded border border-border bg-background px-2 py-1 text-[11px]"
                    >
                      <option value="new">new</option>
                      <option value="researching">researching</option>
                      <option value="added_to_folk">added to Folk</option>
                      <option value="invited">invited</option>
                      <option value="dismissed">dismissed</option>
                    </select>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Search & Add from Folk CRM */}
      {showFolkModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-2xl rounded-2xl border border-border bg-surface p-6 space-y-4 max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold">
                Add Invitee from Folk CRM
              </h2>
              <button
                type="button"
                onClick={() => setShowFolkModal(false)}
                className="text-muted hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                searchFolk(folkQuery);
              }}
              className="flex gap-2"
            >
              <div className="relative flex-1">
                <Search className="h-4 w-4 text-muted absolute left-3 top-2.5" />
                <input
                  type="text"
                  value={folkQuery}
                  onChange={(e) => setFolkQuery(e.target.value)}
                  placeholder="Search Folk by name, email, role, or company..."
                  className="w-full rounded-lg border border-border bg-surface-elevated pl-9 pr-3 py-2 text-xs"
                />
              </div>
              <button
                type="submit"
                disabled={searchingFolk}
                className="rounded-lg bg-accent px-4 py-2 text-xs font-semibold text-accent-foreground"
              >
                {searchingFolk ? "Searching..." : "Search"}
              </button>
            </form>

            {!folkConfigured ? (
              <p className="text-xs text-warning">
                FOLK_API_KEY is not configured.
              </p>
            ) : (
              <div className="overflow-y-auto space-y-2 flex-1 pr-1">
                {folkPeople.length === 0 ? (
                  <p className="text-xs text-muted py-4 text-center">
                    {searchingFolk
                      ? "Loading Folk contacts..."
                      : "No matching Folk contacts found."}
                  </p>
                ) : (
                  folkPeople.map((p) => {
                    const alreadyLinked = ws.invitations.some(
                      (i) => i.person?.folkPersonId === p.folkPersonId,
                    );
                    return (
                      <div
                        key={p.folkPersonId}
                        className="flex items-center justify-between gap-3 rounded-lg border border-border bg-surface-elevated p-3 text-xs"
                      >
                        <div>
                          <p className="font-medium text-foreground">
                            {p.fullName}
                          </p>
                          <p className="text-muted">
                            {[p.jobTitle, p.companyName, p.email]
                              .filter(Boolean)
                              .join(" · ") || p.folkPersonId}
                          </p>
                        </div>
                        <button
                          type="button"
                          disabled={busy || alreadyLinked}
                          onClick={() => addFromFolk(p)}
                          className="rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-accent-foreground disabled:opacity-40"
                        >
                          {alreadyLinked ? "On list" : "Add"}
                        </button>
                      </div>
                    );
                  })
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Modal: Manual Carry-Forward */}
      {showCarryModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-2xl rounded-2xl border border-border bg-surface p-6 space-y-4 max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-base font-semibold">
                  Manual Carry-Forward ({ws.event.locale})
                </h2>
                <p className="text-xs text-muted">
                  Previous attendees and non-responders from earlier{" "}
                  {ws.event.locale} breakfasts. Event-specific notes are never
                  copied.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowCarryModal(false)}
                className="text-muted hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="overflow-y-auto space-y-2 flex-1 pr-1">
              {ws.manualCarryForwardOptions.length === 0 ? (
                <p className="text-xs text-muted py-4 text-center">
                  No eligible prior {ws.event.locale} contacts available to
                  carry forward.
                </p>
              ) : (
                ws.manualCarryForwardOptions.map((opt) => {
                  const alreadyAdded = existingPersonLinkIds.has(
                    opt.folkPersonLinkId,
                  );
                  return (
                    <div
                      key={opt.folkPersonLinkId}
                      className="flex items-center justify-between gap-3 rounded-lg border border-border bg-surface-elevated p-3 text-xs"
                    >
                      <div>
                        <p className="font-medium text-foreground">
                          {opt.fullName}
                        </p>
                        <p className="text-muted">
                          {[opt.jobTitle, opt.companyName].filter(Boolean).join(" · ")}{" "}
                          — from {opt.sourceEventTitle} (
                          {opt.sourceResponseStatus} /{" "}
                          {opt.sourceAttendanceOutcome})
                        </p>
                      </div>
                      <button
                        type="button"
                        disabled={busy || alreadyAdded}
                        onClick={() => addManualCarryForward(opt)}
                        className="rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-accent-foreground disabled:opacity-40"
                      >
                        {alreadyAdded ? "Added" : "Add Provisional"}
                      </button>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}

      {/* Modal: Edit Breakfast Details */}
      {showEditModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-lg rounded-2xl border border-border bg-surface p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold">
                Edit Breakfast Details
              </h2>
              <button
                type="button"
                onClick={() => setShowEditModal(false)}
                className="text-muted hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form
              onSubmit={async (e) => {
                e.preventDefault();
                await patchEvent(
                  {
                    title: editTitle,
                    locale: editLocale,
                    eventDate: new Date(editEventDate).toISOString(),
                    venueName: editVenueName.trim() || null,
                    totalCapacity: Number(editTotalCapacity),
                  },
                  "Updated breakfast details.",
                );
                setVenueName(editVenueName);
                setShowEditModal(false);
              }}
              className="space-y-4 text-xs"
            >
              <div>
                <label className="text-muted block mb-1">Event Title</label>
                <input
                  type="text"
                  required
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  className="w-full rounded-lg border border-border bg-surface-elevated px-3 py-2 text-sm text-foreground"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-muted block mb-1">Locale</label>
                  <input
                    type="text"
                    required
                    value={editLocale}
                    onChange={(e) => setEditLocale(e.target.value)}
                    className="w-full rounded-lg border border-border bg-surface-elevated px-3 py-2 text-sm text-foreground"
                  />
                </div>
                <div>
                  <label className="text-muted block mb-1">
                    Total Room Capacity (incl. hosts)
                  </label>
                  <input
                    type="number"
                    min={2}
                    max={100}
                    required
                    value={editTotalCapacity}
                    onChange={(e) =>
                      setEditTotalCapacity(Number(e.target.value))
                    }
                    className="w-full rounded-lg border border-border bg-surface-elevated px-3 py-2 text-sm text-foreground"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-muted block mb-1">
                    Date &amp; Start Time
                  </label>
                  <input
                    type="datetime-local"
                    required
                    value={editEventDate}
                    onChange={(e) => setEditEventDate(e.target.value)}
                    className="w-full rounded-lg border border-border bg-surface-elevated px-3 py-2 text-sm text-foreground"
                  />
                </div>
                <div>
                  <label className="text-muted block mb-1">Venue Name</label>
                  <input
                    type="text"
                    value={editVenueName}
                    onChange={(e) => setEditVenueName(e.target.value)}
                    placeholder="e.g. The Ned"
                    className="w-full rounded-lg border border-border bg-surface-elevated px-3 py-2 text-sm text-foreground"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowEditModal(false)}
                  className="rounded-lg border border-border px-4 py-2 text-xs text-muted hover:text-foreground"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={busy}
                  className="rounded-lg bg-accent px-4 py-2 text-xs font-semibold text-accent-foreground disabled:opacity-40"
                >
                  {busy ? "Saving..." : "Save Changes"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
