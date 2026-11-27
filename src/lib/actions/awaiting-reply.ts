export interface OutboundAwaitingCandidate {
  id: string;
  goldAccountId: string | null;
  folkPersonLinkId: string | null;
  conversationKey: string | null;
  occurredAt: Date;
}

export interface InboundReplyCandidate {
  goldAccountId: string | null;
  folkPersonLinkId: string | null;
  conversationKey: string | null;
  occurredAt: Date;
}

/**
 * Filters outbound outreach rows to those not yet cleared by a subsequent
 * inbound reply, preserving separate conversations when conversationKey is set.
 */
export function findAwaitingReplyActivities<T extends OutboundAwaitingCandidate>(
  outboundRows: readonly T[],
  inboundRows: readonly InboundReplyCandidate[],
): T[] {
  return outboundRows.filter((out) => {
    return !inboundRows.some((inb) => {
      if (inb.occurredAt <= out.occurredAt) return false;

      if (out.conversationKey) {
        if (inb.conversationKey) {
          return inb.conversationKey === out.conversationKey;
        }
        return false;
      }

      if (out.folkPersonLinkId) {
        if (inb.folkPersonLinkId !== out.folkPersonLinkId) return false;
        // If inbound clearly belongs to another named thread, don't auto-clear an unthreaded touchpoint
        return !inb.conversationKey;
      }

      if (out.goldAccountId) {
        return inb.goldAccountId === out.goldAccountId && !inb.conversationKey;
      }

      return false;
    });
  });
}
