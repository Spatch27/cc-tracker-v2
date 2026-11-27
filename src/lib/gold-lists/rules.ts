import type { FolkInteraction } from "@/lib/folk/types";

export const MAX_GOLD_ACCOUNTS_PER_FOUNDER = 50;

export class GoldListRuleError extends Error {
  readonly status: number;

  constructor(message: string, status = 409) {
    super(message);
    this.name = "GoldListRuleError";
    this.status = status;
  }
}

export function assertFounderGoldCap(params: {
  ownerUserId: string;
  ownerName?: string | null;
  activeCountForOwner: number;
  alreadyActiveUnderOwner?: boolean;
}): void {
  if (params.alreadyActiveUnderOwner) return;
  if (params.activeCountForOwner >= MAX_GOLD_ACCOUNTS_PER_FOUNDER) {
    const label = params.ownerName?.trim() || "This founder";
    throw new GoldListRuleError(
      `${label} already has ${MAX_GOLD_ACCOUNTS_PER_FOUNDER} active Gold-list companies (maximum cap). Archive or reassign an existing company first.`,
      409,
    );
  }
}

export interface AccountFitSummary {
  meetsTeamSizeCriteria: boolean | null;
  hasLegacySetup: boolean;
  summaryLabel: string;
}

export function evaluateAccountFit(params: {
  marketingTeamSize: number | null;
  legacySetupNotes: string | null;
}): AccountFitSummary {
  const meetsTeamSizeCriteria =
    params.marketingTeamSize === null
      ? null
      : params.marketingTeamSize > 10;
  const hasLegacySetup = Boolean(
    params.legacySetupNotes && params.legacySetupNotes.trim().length > 0,
  );

  const parts: string[] = [];
  if (meetsTeamSizeCriteria === true) {
    parts.push(`Team > 10 (${params.marketingTeamSize})`);
  } else if (meetsTeamSizeCriteria === false) {
    parts.push(`Team ≤ 10 (${params.marketingTeamSize})`);
  } else {
    parts.push("Team size unknown");
  }
  if (hasLegacySetup) {
    parts.push("Legacy setup noted");
  }

  return {
    meetsTeamSizeCriteria,
    hasLegacySetup,
    summaryLabel: parts.join(" · "),
  };
}

export type ActivityChannel =
  | "email"
  | "linkedin"
  | "postcard"
  | "call"
  | "meeting"
  | "other";

export type ActivityDirection = "outbound" | "inbound" | "note";

export function inferFolkInteractionChannel(
  interaction: FolkInteraction,
): ActivityChannel {
  const raw = (
    interaction.importedType ??
    interaction.activityType ??
    ""
  ).toLowerCase();
  if (raw.includes("email") || raw.includes("gmail")) return "email";
  if (raw.includes("linkedin")) return "linkedin";
  if (raw.includes("postcard") || raw.includes("mail")) return "postcard";
  if (raw.includes("call") || raw.includes("phone")) return "call";
  if (raw.includes("meeting") || raw.includes("calendar")) return "meeting";
  return "other";
}

export function normalizeFolkInteraction(
  interaction: FolkInteraction,
  ctx: {
    goldAccountId: string;
    folkPersonLinkId: string;
    ownerUserId?: string | null;
  },
) {
  const occurredAtRaw = interaction.datetime ?? interaction.createdAt;
  const parsedDate = occurredAtRaw ? new Date(occurredAtRaw) : new Date();
  const occurredAt = Number.isNaN(parsedDate.getTime()) ? new Date() : parsedDate;

  const isEmail = (interaction.importedType ?? "").toLowerCase() === "email";
  const channel = inferFolkInteractionChannel(interaction);
  const visibilityRestricted = Boolean(interaction.privacyRestricted);

  const previewSource = visibilityRestricted
    ? "[Visibility restricted by Folk privacy settings]"
    : interaction.content ?? null;
  const bodyPreview = previewSource ? previewSource.slice(0, 400) : null;

  return {
    goldAccountId: ctx.goldAccountId,
    breakfastEventId: null,
    folkPersonLinkId: ctx.folkPersonLinkId,
    channel,
    direction: "note" as ActivityDirection,
    ownerUserId: ctx.ownerUserId ?? null,
    actorAgentId: null,
    conversationKey:
      interaction.threadId ?? interaction.conversationId ?? null,
    replyToActivityId: null,
    subject: interaction.title ?? null,
    bodyPreview,
    sourceSystem: (isEmail ? "folk_gmail" : "folk_logged") as
      | "folk_gmail"
      | "folk_logged",
    folkInteractionId: interaction.id,
    idempotencyKey: `folk_int_${interaction.id}`,
    executionStatus: "logged" as const,
    visibilityRestricted,
    occurredAt,
    syncedAt: new Date(),
  };
}

export interface TimelineActivityLike {
  id: string;
  folkInteractionId: string | null;
  idempotencyKey: string | null;
  occurredAt: Date;
}

/**
 * Deduplicates timeline activities across Folk interaction IDs, idempotency keys,
 * and internal row IDs while keeping separate conversations distinct.
 */
export function deduplicateTimelineActivities<T extends TimelineActivityLike>(
  activities: readonly T[],
): T[] {
  const seenFolkIds = new Set<string>();
  const seenIdempotencyKeys = new Set<string>();
  const seenIds = new Set<string>();
  const unique: T[] = [];

  for (const act of activities) {
    if (act.folkInteractionId) {
      if (seenFolkIds.has(act.folkInteractionId)) continue;
      seenFolkIds.add(act.folkInteractionId);
    }
    if (act.idempotencyKey) {
      if (seenIdempotencyKeys.has(act.idempotencyKey)) continue;
      seenIdempotencyKeys.add(act.idempotencyKey);
    }
    if (seenIds.has(act.id)) continue;
    seenIds.add(act.id);
    unique.push(act);
  }

  return unique.sort(
    (a, b) => b.occurredAt.getTime() - a.occurredAt.getTime(),
  );
}

export interface ClassifiableAction {
  id: string;
  dueDate: Date;
  status: "open" | "needs_review" | "completed" | "cancelled";
}

export function classifyFollowUpActions<T extends ClassifiableAction>(
  actions: readonly T[],
  now: Date = new Date(),
): {
  needsReview: T[];
  overdue: T[];
  dueToday: T[];
  upcoming: T[];
  completed: T[];
} {
  const startOfToday = new Date(now);
  startOfToday.setUTCHours(0, 0, 0, 0);
  const endOfToday = new Date(now);
  endOfToday.setUTCHours(23, 59, 59, 999);

  const needsReview: T[] = [];
  const overdue: T[] = [];
  const dueToday: T[] = [];
  const upcoming: T[] = [];
  const completed: T[] = [];

  for (const action of actions) {
    if (action.status === "completed" || action.status === "cancelled") {
      completed.push(action);
      continue;
    }
    if (action.status === "needs_review") {
      needsReview.push(action);
    }
    if (action.dueDate < startOfToday) {
      overdue.push(action);
    } else if (action.dueDate <= endOfToday) {
      dueToday.push(action);
    } else {
      upcoming.push(action);
    }
  }

  return { needsReview, overdue, dueToday, upcoming, completed };
}
