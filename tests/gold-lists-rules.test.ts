import { describe, expect, it } from "vitest";
import { flagActionsForInboundReply } from "@/lib/actions/follow-ups";
import {
  assertFounderGoldCap,
  deduplicateTimelineActivities,
  evaluateAccountFit,
  GoldListRuleError,
  MAX_GOLD_ACCOUNTS_PER_FOUNDER,
  normalizeFolkInteraction,
} from "@/lib/gold-lists/rules";

describe("Gold-list domain rules & priority outreach acceptance scenario", () => {
  it("enforces the 50-company cap per founder on additions and reassignments", () => {
    expect(() =>
      assertFounderGoldCap({
        ownerUserId: "user_tim",
        ownerName: "Tim",
        activeCountForOwner: MAX_GOLD_ACCOUNTS_PER_FOUNDER,
        alreadyActiveUnderOwner: false,
      }),
    ).toThrow(GoldListRuleError);

    // Updating an account already active under Tim is allowed at 50/50
    expect(() =>
      assertFounderGoldCap({
        ownerUserId: "user_tim",
        ownerName: "Tim",
        activeCountForOwner: 50,
        alreadyActiveUnderOwner: true,
      }),
    ).not.toThrow();

    // Reassigning to Ben (who has 40) succeeds
    expect(() =>
      assertFounderGoldCap({
        ownerUserId: "user_ben",
        ownerName: "Ben",
        activeCountForOwner: 40,
        alreadyActiveUnderOwner: false,
      }),
    ).not.toThrow();
  });

  it("evaluates fit indicators independently of time-sensitive buying signals", () => {
    const strongFit = evaluateAccountFit({
      marketingTeamSize: 24,
      legacySetupNotes: "Monolithic legacy CMS + disconnected CRM",
    });
    expect(strongFit.meetsTeamSizeCriteria).toBe(true);
    expect(strongFit.hasLegacySetup).toBe(true);

    const smallTeam = evaluateAccountFit({
      marketingTeamSize: 6,
      legacySetupNotes: null,
    });
    expect(smallTeam.meetsTeamSizeCriteria).toBe(false);
    expect(smallTeam.hasLegacySetup).toBe(false);
  });

  it("priority acceptance scenario: Tim email + Ben LinkedIn + postcard appear once, retry deduplicates, reply flags matching follow-up, privacy restriction stays visible", () => {
    const timEmail = normalizeFolkInteraction(
      {
        id: "int_gmail_1",
        datetime: "2026-11-20T10:00:00Z",
        title: "Intro to Committed Citizens",
        content: "Hi Sarah...",
        importedType: "email",
        threadId: "thr_cmo_1",
        privacyRestricted: false,
      },
      {
        goldAccountId: "gold_acme",
        folkPersonLinkId: "per_cmo",
        ownerUserId: "user_tim",
      },
    );

    const benLinkedIn = {
      id: "act_li_1",
      folkInteractionId: "int_li_1",
      idempotencyKey: "li-1",
      channel: "linkedin" as const,
      direction: "outbound" as const,
      ownerUserId: "user_ben",
      conversationKey: "li_thread_1",
      sourceSystem: "folk_logged" as const,
      executionStatus: "logged" as const,
      visibilityRestricted: false,
      occurredAt: new Date("2026-11-22T14:00:00Z"),
    };

    const postcard = {
      id: "act_pc_1",
      folkInteractionId: null,
      idempotencyKey: "pc-1",
      channel: "postcard" as const,
      direction: "outbound" as const,
      ownerUserId: "user_tim",
      conversationKey: null,
      sourceSystem: "tracker_manual" as const,
      executionStatus: "outcome_unknown" as const,
      visibilityRestricted: false,
      occurredAt: new Date("2026-11-24T09:00:00Z"),
    };

    const restrictedFolkSync = normalizeFolkInteraction(
      {
        id: "int_restricted",
        datetime: "2026-11-25T11:00:00Z",
        importedType: "email",
        privacyRestricted: true,
        content: "Should be masked",
      },
      {
        goldAccountId: "gold_acme",
        folkPersonLinkId: "per_cmo",
        ownerUserId: "user_ben",
      },
    );
    expect(restrictedFolkSync.visibilityRestricted).toBe(true);
    expect(restrictedFolkSync.bodyPreview).toContain("Visibility restricted");

    // Simulate duplicate sync retry of int_gmail_1 and li-1
    const timeline = deduplicateTimelineActivities([
      { ...timEmail, id: "act_email_1" },
      { ...timEmail, id: "act_email_1_dup" },
      benLinkedIn,
      { ...benLinkedIn, id: "act_li_1_dup" },
      postcard,
      { ...restrictedFolkSync, id: "act_restricted_1" },
    ]);

    expect(timeline).toHaveLength(4);
    expect(timeline[0]?.id).toBe("act_restricted_1");
    expect(timeline[1]?.id).toBe("act_pc_1");

    // Inbound reply on thr_cmo_1 flags matching action without touching separate LinkedIn task
    const flagged = flagActionsForInboundReply(
      [
        {
          id: "fu_email",
          goldAccountId: "gold_acme",
          breakfastEventId: null,
          folkPersonLinkId: "per_cmo",
          activityId: "act_email_1",
          ownerUserId: "user_tim",
          title: "Chase Sarah on email reply",
          dueDate: new Date("2026-11-28T09:00:00Z"),
          status: "open",
          flaggedByReplyActivityId: null,
          snoozeHistoryJson: [],
          conversationKey: "thr_cmo_1",
        },
        {
          id: "fu_linkedin",
          goldAccountId: "gold_acme",
          breakfastEventId: null,
          folkPersonLinkId: "per_cmo",
          activityId: "act_li_1",
          ownerUserId: "user_ben",
          title: "Follow up LinkedIn DM",
          dueDate: new Date("2026-11-29T09:00:00Z"),
          status: "open",
          flaggedByReplyActivityId: null,
          snoozeHistoryJson: [],
          conversationKey: "li_thread_1",
        },
      ],
      {
        id: "act_reply_1",
        folkPersonLinkId: "per_cmo",
        goldAccountId: "gold_acme",
        conversationKey: "thr_cmo_1",
      },
    );

    expect(flagged[0]?.status).toBe("needs_review");
    expect(flagged[0]?.flaggedByReplyActivityId).toBe("act_reply_1");
    expect(flagged[1]?.status).toBe("open");
  });
});
