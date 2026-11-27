import type { SnoozeHistoryEntry } from "@/db/schema";

export interface FollowUpActionSnapshot {
  id: string;
  goldAccountId: string | null;
  breakfastEventId: string | null;
  folkPersonLinkId: string | null;
  activityId: string | null;
  ownerUserId: string;
  title: string;
  dueDate: Date;
  status: "open" | "needs_review" | "completed" | "cancelled";
  flaggedByReplyActivityId: string | null;
  snoozeHistoryJson: SnoozeHistoryEntry[];
  conversationKey?: string | null;
}

export interface InboundReplyContext {
  id: string;
  folkPersonLinkId: string | null;
  goldAccountId: string | null;
  conversationKey: string | null;
}

/**
 * Updates dueDate while preserving every prior due date in snoozeHistoryJson.
 */
export function snoozeFollowUpAction<T extends FollowUpActionSnapshot>(
  action: T,
  newDueDate: Date,
  options?: { snoozedByUserId?: string; reason?: string; now?: Date },
): T {
  const now = options?.now ?? new Date();
  const entry: SnoozeHistoryEntry = {
    previousDueDate: action.dueDate.toISOString(),
    newDueDate: newDueDate.toISOString(),
    snoozedAt: now.toISOString(),
    ...(options?.snoozedByUserId ? { snoozedByUserId: options.snoozedByUserId } : {}),
    ...(options?.reason ? { reason: options.reason } : {}),
  };

  return {
    ...action,
    dueDate: newDueDate,
    snoozeHistoryJson: [...action.snoozeHistoryJson, entry],
  };
}

/**
 * Flags ONLY open actions matching the inbound reply's conversationKey (if present)
 * or folkPersonLinkId to `needs_review`, leaving unrelated actions untouched.
 */
export function flagActionsForInboundReply<T extends FollowUpActionSnapshot>(
  actions: readonly T[],
  reply: InboundReplyContext,
): T[] {
  return actions.map((action) => {
    if (action.status !== "open") {
      return action;
    }

    let matches = false;
    if (reply.conversationKey && action.conversationKey) {
      matches = reply.conversationKey === action.conversationKey;
    } else if (reply.folkPersonLinkId && action.folkPersonLinkId) {
      matches = reply.folkPersonLinkId === action.folkPersonLinkId;
    }

    if (!matches) {
      return action;
    }

    return {
      ...action,
      status: "needs_review",
      flaggedByReplyActivityId: reply.id,
    };
  });
}
