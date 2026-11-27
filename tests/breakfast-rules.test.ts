import { describe, expect, it } from "vitest";
import {
  BreakfastRuleError,
  calculateBreakfastCapacity,
  evaluateCancellation,
  evaluateInvitationAcceptance,
  evaluateManualWaitlistConfirm,
  evaluateManualWaitlistOffer,
  selectAutomaticCarryForwardCandidates,
} from "@/lib/breakfasts/rules";

describe("CMO Breakfast domain rules (Phase 2 exit checks)", () => {
  it("calculates guest capacity by subtracting attending hosts from room capacity (14 - 2 = 12)", () => {
    const cap = calculateBreakfastCapacity({
      totalCapacity: 14,
      attendingHostCount: 2,
      invitations: [
        { responseStatus: "accepted", attendanceOutcome: "pending", waitlistStatus: "none" },
        { responseStatus: "accepted", attendanceOutcome: "attended", waitlistStatus: "none" },
        { responseStatus: "maybe", attendanceOutcome: "pending", waitlistStatus: "none" },
        { responseStatus: "no_response", attendanceOutcome: "pending", waitlistStatus: "none" },
      ],
    });

    expect(cap.guestCapacity).toBe(12);
    expect(cap.confirmedGuestCount).toBe(2);
    expect(cap.availableGuestPlaces).toBe(10);
    expect(cap.isFull).toBe(false);
  });

  it("prevents overbooking by placing extra acceptances on waitlist and requires manual offer + confirm on cancellation", () => {
    const fullInvitations = Array.from({ length: 12 }, () => ({
      responseStatus: "accepted",
      attendanceOutcome: "pending",
      waitlistStatus: "none",
    }));

    const fullCapacity = calculateBreakfastCapacity({
      totalCapacity: 14,
      attendingHostCount: 2,
      invitations: fullInvitations,
    });
    expect(fullCapacity.availableGuestPlaces).toBe(0);
    expect(fullCapacity.isFull).toBe(true);

    // 13th guest accepting goes to waitlist rather than overbooking
    const thirteenth = evaluateInvitationAcceptance(fullCapacity);
    expect(thirteenth.waitlistStatus).toBe("waitlisted");
    expect(thirteenth.wasWaitlisted).toBe(true);

    // One confirmed guest cancels in advance (preserving their earlier acceptance response)
    const cancelled = evaluateCancellation(fullInvitations[0]!);
    expect(cancelled.responseStatus).toBe("accepted");
    expect(cancelled.attendanceOutcome).toBe("cancelled_in_advance");

    const updatedInvitations = [
      cancelled,
      ...fullInvitations.slice(1),
      thirteenth,
    ];
    const afterCancelCapacity = calculateBreakfastCapacity({
      totalCapacity: 14,
      attendingHostCount: 2,
      invitations: updatedInvitations,
    });

    expect(afterCancelCapacity.availableGuestPlaces).toBe(1);
    expect(afterCancelCapacity.waitlistedCount).toBe(1);
    expect(afterCancelCapacity.hasFreedPlaceForWaitlist).toBe(true);

    // Agent cannot auto-offer or auto-confirm waitlist places
    expect(() =>
      evaluateManualWaitlistOffer(afterCancelCapacity, thirteenth, "agent"),
    ).toThrow(BreakfastRuleError);

    // Founder must manually offer first, then manually confirm replacement
    expect(() =>
      evaluateManualWaitlistConfirm(afterCancelCapacity, thirteenth, "human"),
    ).toThrow(BreakfastRuleError);

    const offered = evaluateManualWaitlistOffer(
      afterCancelCapacity,
      thirteenth,
      "human",
    );
    expect(offered.waitlistStatus).toBe("offered_place");

    const confirmed = evaluateManualWaitlistConfirm(
      afterCancelCapacity,
      { ...thirteenth, ...offered },
      "human",
    );
    expect(confirmed.waitlistStatus).toBe("confirmed_replacement");
  });

  it("auto-carries forward only responded-declined contacts once, excludes non-responders & suppressed, and strips event-specific notes", () => {
    const candidates = selectAutomaticCarryForwardCandidates({
      sourceEventId: "evt_london_1",
      existingTargetPersonIds: ["per_already_on_list"],
      sourceInvitations: [
        {
          folkPersonLinkId: "per_declined_1",
          responseStatus: "declined",
          attendanceOutcome: "pending",
          contactSuppressed: false,
          dietaryNotes: "Vegan",
          specialRequests: "Corner seat",
          earlyDepartureNote: "Must leave at 9:15am",
        },
        {
          folkPersonLinkId: "per_declined_1", // duplicate in source
          responseStatus: "declined",
          attendanceOutcome: "pending",
          contactSuppressed: false,
        },
        {
          folkPersonLinkId: "per_already_on_list",
          responseStatus: "declined",
          attendanceOutcome: "pending",
          contactSuppressed: false,
        },
        {
          folkPersonLinkId: "per_non_responder",
          responseStatus: "no_response",
          attendanceOutcome: "pending",
          contactSuppressed: false,
        },
        {
          folkPersonLinkId: "per_suppressed_declined",
          responseStatus: "declined",
          attendanceOutcome: "pending",
          contactSuppressed: true,
        },
        {
          folkPersonLinkId: "per_no_show",
          responseStatus: "accepted",
          attendanceOutcome: "no_show",
          contactSuppressed: false,
        },
        {
          folkPersonLinkId: "per_attended",
          responseStatus: "accepted",
          attendanceOutcome: "attended",
          contactSuppressed: false,
        },
      ],
    });

    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toEqual({
      folkPersonLinkId: "per_declined_1",
      responseStatus: "provisional",
      attendanceOutcome: "pending",
      waitlistStatus: "none",
      chaseStatus: "none",
      carriedForwardFromEventId: "evt_london_1",
      dietaryNotes: null,
      specialRequests: null,
      earlyDepartureNote: null,
    });
  });
});
