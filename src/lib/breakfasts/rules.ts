export type ResponseStatus =
  | "provisional"
  | "no_response"
  | "accepted"
  | "maybe"
  | "declined";

export type AttendanceOutcome =
  | "pending"
  | "attended"
  | "cancelled_in_advance"
  | "no_show";

export type WaitlistStatus =
  | "none"
  | "waitlisted"
  | "offered_place"
  | "confirmed_replacement";

export interface CapacityInvitationInput {
  responseStatus: ResponseStatus | string;
  attendanceOutcome: AttendanceOutcome | string;
  waitlistStatus: WaitlistStatus | string;
}

export interface BreakfastCapacityMetrics {
  totalCapacity: number;
  attendingHostCount: number;
  guestCapacity: number;
  confirmedGuestCount: number;
  waitlistedCount: number;
  offeredPlaceCount: number;
  availableGuestPlaces: number;
  isFull: boolean;
  hasFreedPlaceForWaitlist: boolean;
}

export class BreakfastRuleError extends Error {
  readonly status: number;

  constructor(message: string, status = 409) {
    super(message);
    this.name = "BreakfastRuleError";
    this.status = status;
  }
}

export function normalizeLocale(locale: string): string {
  return locale.trim().toLowerCase();
}

export function formatLocaleLabel(locale: string): string {
  return locale
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

export function isConfirmedGuestSeat(inv: CapacityInvitationInput): boolean {
  if (
    inv.attendanceOutcome === "cancelled_in_advance" ||
    inv.attendanceOutcome === "no_show"
  ) {
    return false;
  }
  if (inv.waitlistStatus === "confirmed_replacement") {
    return true;
  }
  return inv.responseStatus === "accepted" && inv.waitlistStatus === "none";
}

export function calculateBreakfastCapacity(params: {
  totalCapacity: number;
  attendingHostCount: number;
  invitations: readonly CapacityInvitationInput[];
}): BreakfastCapacityMetrics {
  const totalCapacity = Math.max(0, params.totalCapacity);
  const attendingHostCount = Math.max(0, params.attendingHostCount);
  const guestCapacity = Math.max(0, totalCapacity - attendingHostCount);

  let confirmedGuestCount = 0;
  let waitlistedCount = 0;
  let offeredPlaceCount = 0;

  for (const inv of params.invitations) {
    if (isConfirmedGuestSeat(inv)) {
      confirmedGuestCount += 1;
    }
    if (inv.waitlistStatus === "waitlisted") {
      waitlistedCount += 1;
    } else if (inv.waitlistStatus === "offered_place") {
      offeredPlaceCount += 1;
    }
  }

  const availableGuestPlaces = Math.max(0, guestCapacity - confirmedGuestCount);
  const isFull = availableGuestPlaces === 0;
  const hasFreedPlaceForWaitlist =
    availableGuestPlaces > 0 && waitlistedCount > 0;

  return {
    totalCapacity,
    attendingHostCount,
    guestCapacity,
    confirmedGuestCount,
    waitlistedCount,
    offeredPlaceCount,
    availableGuestPlaces,
    isFull,
    hasFreedPlaceForWaitlist,
  };
}

/**
 * Evaluates an acceptance without silently overbooking a full breakfast.
 * When no guest seat is open, the invitee enters `waitlisted`.
 */
export function evaluateInvitationAcceptance(
  capacity: BreakfastCapacityMetrics,
  currentInvitation?: CapacityInvitationInput | null,
): {
  responseStatus: "accepted";
  attendanceOutcome: "pending";
  waitlistStatus: "none" | "waitlisted" | "confirmed_replacement";
  wasWaitlisted: boolean;
} {
  if (currentInvitation && isConfirmedGuestSeat(currentInvitation)) {
    return {
      responseStatus: "accepted",
      attendanceOutcome: "pending",
      waitlistStatus:
        currentInvitation.waitlistStatus === "confirmed_replacement"
          ? "confirmed_replacement"
          : "none",
      wasWaitlisted: false,
    };
  }

  if (capacity.availableGuestPlaces > 0) {
    return {
      responseStatus: "accepted",
      attendanceOutcome: "pending",
      waitlistStatus: "none",
      wasWaitlisted: false,
    };
  }

  return {
    responseStatus: "accepted",
    attendanceOutcome: "pending",
    waitlistStatus: "waitlisted",
    wasWaitlisted: true,
  };
}

export function evaluateManualWaitlistOffer(
  capacity: BreakfastCapacityMetrics,
  invitation: CapacityInvitationInput,
  actorType: "human" | "agent",
): { waitlistStatus: "offered_place" } {
  if (actorType !== "human") {
    throw new BreakfastRuleError(
      "Only Tim or Ben can manually offer a waitlist place.",
      403,
    );
  }
  if (invitation.waitlistStatus !== "waitlisted") {
    throw new BreakfastRuleError(
      "Only a waitlisted invitee can be offered a freed place.",
      409,
    );
  }
  if (capacity.availableGuestPlaces <= 0) {
    throw new BreakfastRuleError(
      "No guest seats are currently free; cannot offer a waitlist place without overbooking.",
      409,
    );
  }
  return { waitlistStatus: "offered_place" };
}

export function evaluateManualWaitlistConfirm(
  capacity: BreakfastCapacityMetrics,
  invitation: CapacityInvitationInput,
  actorType: "human" | "agent",
): {
  responseStatus: "accepted";
  attendanceOutcome: "pending";
  waitlistStatus: "confirmed_replacement";
} {
  if (actorType !== "human") {
    throw new BreakfastRuleError(
      "Only Tim or Ben can manually confirm a replacement attendee.",
      403,
    );
  }
  if (invitation.waitlistStatus !== "offered_place") {
    throw new BreakfastRuleError(
      "Waitlist place must be manually offered before confirming replacement attendance.",
      409,
    );
  }
  if (capacity.availableGuestPlaces <= 0) {
    throw new BreakfastRuleError(
      "No guest seats are currently free; cannot confirm replacement without overbooking.",
      409,
    );
  }
  return {
    responseStatus: "accepted",
    attendanceOutcome: "pending",
    waitlistStatus: "confirmed_replacement",
  };
}

export function evaluateCancellation(invitation: CapacityInvitationInput): {
  responseStatus: string;
  attendanceOutcome: "cancelled_in_advance";
  waitlistStatus: "none";
} {
  return {
    responseStatus: invitation.responseStatus,
    attendanceOutcome: "cancelled_in_advance",
    waitlistStatus: "none",
  };
}

export interface CarryForwardSourceRecord {
  folkPersonLinkId: string;
  responseStatus: string;
  attendanceOutcome: string;
  contactSuppressed: boolean;
  dietaryNotes?: string | null;
  specialRequests?: string | null;
  earlyDepartureNote?: string | null;
}

export interface CarryForwardDraftInvitation {
  folkPersonLinkId: string;
  responseStatus: "provisional";
  attendanceOutcome: "pending";
  waitlistStatus: "none";
  chaseStatus: "none";
  carriedForwardFromEventId: string;
  dietaryNotes: null;
  specialRequests: null;
  earlyDepartureNote: null;
}

/**
 * Selects automatic same-locale carry-forward candidates:
 * - Includes ONLY people who responded but could not attend (`responseStatus === "declined"`)
 *   who are not suppressed (`!contactSuppressed`) and not already on the target list.
 * - Excludes `no_response`, `provisional`, `attended`, `no_show`, and suppressed contacts.
 * - Strips all event-specific notes (dietary, special requests, early departure).
 */
export function selectAutomaticCarryForwardCandidates(params: {
  sourceEventId: string;
  sourceInvitations: readonly CarryForwardSourceRecord[];
  existingTargetPersonIds: readonly string[];
}): CarryForwardDraftInvitation[] {
  const seen = new Set(params.existingTargetPersonIds);
  const drafts: CarryForwardDraftInvitation[] = [];

  for (const inv of params.sourceInvitations) {
    if (inv.contactSuppressed) continue;
    if (inv.responseStatus !== "declined") continue;
    if (inv.attendanceOutcome === "no_show" || inv.attendanceOutcome === "attended") {
      continue;
    }
    if (seen.has(inv.folkPersonLinkId)) continue;

    seen.add(inv.folkPersonLinkId);
    drafts.push({
      folkPersonLinkId: inv.folkPersonLinkId,
      responseStatus: "provisional",
      attendanceOutcome: "pending",
      waitlistStatus: "none",
      chaseStatus: "none",
      carriedForwardFromEventId: params.sourceEventId,
      dietaryNotes: null,
      specialRequests: null,
      earlyDepartureNote: null,
    });
  }

  return drafts;
}
