import { describe, expect, it } from "vitest";
import {
  flagActionsForInboundReply,
  snoozeFollowUpAction,
  type FollowUpActionSnapshot,
} from "@/lib/actions/follow-ups";

describe("follow-up actions", () => {
  const baseAction: FollowUpActionSnapshot = {
    id: "act_1",
    goldAccountId: "gold_1",
    breakfastEventId: null,
    folkPersonLinkId: "person_1",
    activityId: "out_1",
    ownerUserId: "user_tim",
    title: "Chase CMO on breakfast invite",
    dueDate: new Date("2026-12-01T09:00:00Z"),
    status: "open",
    flaggedByReplyActivityId: null,
    snoozeHistoryJson: [],
    conversationKey: "thread_A",
  };

  it("preserves prior due dates in snoozeHistoryJson when snoozed", () => {
    const snoozedOnce = snoozeFollowUpAction(
      baseAction,
      new Date("2026-12-05T09:00:00Z"),
      { snoozedByUserId: "user_tim", reason: "Away this week", now: new Date("2026-12-01T10:00:00Z") },
    );
    const snoozedTwice = snoozeFollowUpAction(
      snoozedOnce,
      new Date("2026-12-10T09:00:00Z"),
      { snoozedByUserId: "user_tim", reason: "Requested next week", now: new Date("2026-12-05T10:00:00Z") },
    );

    expect(snoozedTwice.dueDate.toISOString()).toBe("2026-12-10T09:00:00.000Z");
    expect(snoozedTwice.snoozeHistoryJson).toHaveLength(2);
    expect(snoozedTwice.snoozeHistoryJson[0]?.previousDueDate).toBe(
      "2026-12-01T09:00:00.000Z",
    );
    expect(snoozedTwice.snoozeHistoryJson[1]?.previousDueDate).toBe(
      "2026-12-05T09:00:00.000Z",
    );
  });

  it("flags only matching conversation/person open tasks on inbound reply", () => {
    const unrelatedSamePersonOtherThread: FollowUpActionSnapshot = {
      ...baseAction,
      id: "act_2",
      conversationKey: "thread_B",
      title: "Separate commercial discussion",
    };
    const unrelatedOtherPerson: FollowUpActionSnapshot = {
      ...baseAction,
      id: "act_3",
      folkPersonLinkId: "person_2",
      conversationKey: "thread_C",
      title: "Other VP action",
    };

    const updated = flagActionsForInboundReply(
      [baseAction, unrelatedSamePersonOtherThread, unrelatedOtherPerson],
      {
        id: "reply_99",
        folkPersonLinkId: "person_1",
        goldAccountId: "gold_1",
        conversationKey: "thread_A",
      },
    );

    expect(updated[0]?.status).toBe("needs_review");
    expect(updated[0]?.flaggedByReplyActivityId).toBe("reply_99");
    expect(updated[1]?.status).toBe("open");
    expect(updated[2]?.status).toBe("open");
  });
});
