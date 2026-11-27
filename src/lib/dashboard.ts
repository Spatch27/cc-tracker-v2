import { and, asc, count, desc, eq, inArray, lt, or } from "drizzle-orm";
import { getDb, isDatabaseConfigured, schema } from "@/db";
import { calculateBreakfastCapacity } from "@/lib/breakfasts/rules";

export interface OverviewSummary {
  dbReady: boolean;
  dbError: string | null;
  pendingProposalsCount: number;
  conflictProposalsCount: number;
  awaitingApprovalMessagesCount: number;
  overdueActionsCount: number;
  dueTodayOrOpenActionsCount: number;
  activeGoldAccountsCount: number;
  upcomingBreakfastsCount: number;
  lastSyncRun: {
    source: string;
    scope: string;
    status: string;
    recordsRead: number;
    visibilityGapNote: string | null;
    errorSummary: string | null;
    startedAt: Date;
    finishedAt: Date | null;
  } | null;
}

export interface NavBadgeCounts {
  reviewsCount: number;
  approvalsCount: number;
  actionsCount: number;
}

export interface OverviewCockpitData {
  upcomingBreakfasts: Array<{
    id: string;
    title: string;
    locale: string;
    eventDate: Date;
    venueName: string | null;
    status: string;
    confirmedGuestCount: number;
    guestCapacity: number;
    inviteeCount: number;
  }>;
  priorityActions: Array<{
    id: string;
    title: string;
    status: "open" | "needs_review" | "completed" | "cancelled";
    dueDate: Date;
    ownerName: string;
    goldAccountId: string | null;
    companyName: string | null;
    personName: string | null;
  }>;
  pendingReviews: Array<{
    id: string;
    summary: string;
    status: string;
    targetSystem: string;
    entityType: string;
    createdAt: Date;
  }>;
  pendingMessages: Array<{
    id: string;
    recipientName: string;
    channel: string;
    subject: string | null;
    createdAt: Date;
  }>;
}

export async function getNavBadgeCounts(): Promise<NavBadgeCounts> {
  if (!isDatabaseConfigured()) {
    return { reviewsCount: 0, approvalsCount: 0, actionsCount: 0 };
  }

  try {
    const db = getDb();
    const endOfToday = new Date();
    endOfToday.setUTCHours(23, 59, 59, 999);

    const [[reviews], [approvals], [actions]] = await Promise.all([
      db
        .select({ value: count() })
        .from(schema.changeProposals)
        .where(
          inArray(schema.changeProposals.status, ["pending_review", "conflict"]),
        ),
      db
        .select({ value: count() })
        .from(schema.messageApprovals)
        .where(eq(schema.messageApprovals.status, "awaiting_approval")),
      db
        .select({ value: count() })
        .from(schema.followUpActions)
        .where(
          or(
            eq(schema.followUpActions.status, "needs_review"),
            and(
              eq(schema.followUpActions.status, "open"),
              lt(schema.followUpActions.dueDate, endOfToday),
            ),
          ),
        ),
    ]);

    return {
      reviewsCount: Number(reviews?.value ?? 0),
      approvalsCount: Number(approvals?.value ?? 0),
      actionsCount: Number(actions?.value ?? 0),
    };
  } catch {
    return { reviewsCount: 0, approvalsCount: 0, actionsCount: 0 };
  }
}

export async function getOverviewSummary(): Promise<OverviewSummary> {
  if (!isDatabaseConfigured()) {
    return {
      dbReady: false,
      dbError: null,
      pendingProposalsCount: 0,
      conflictProposalsCount: 0,
      awaitingApprovalMessagesCount: 0,
      overdueActionsCount: 0,
      dueTodayOrOpenActionsCount: 0,
      activeGoldAccountsCount: 0,
      upcomingBreakfastsCount: 0,
      lastSyncRun: null,
    };
  }

  try {
    const db = getDb();
    const now = new Date();

    const [
      [pendingProposals],
      [conflictProposals],
      [awaitingMessages],
      [overdueActions],
      [openActions],
      [goldAccounts],
      [breakfasts],
      syncRuns,
    ] = await Promise.all([
      db
        .select({ value: count() })
        .from(schema.changeProposals)
        .where(eq(schema.changeProposals.status, "pending_review")),
      db
        .select({ value: count() })
        .from(schema.changeProposals)
        .where(eq(schema.changeProposals.status, "conflict")),
      db
        .select({ value: count() })
        .from(schema.messageApprovals)
        .where(eq(schema.messageApprovals.status, "awaiting_approval")),
      db
        .select({ value: count() })
        .from(schema.followUpActions)
        .where(
          and(
            inArray(schema.followUpActions.status, ["open", "needs_review"]),
            lt(schema.followUpActions.dueDate, now),
          ),
        ),
      db
        .select({ value: count() })
        .from(schema.followUpActions)
        .where(inArray(schema.followUpActions.status, ["open", "needs_review"])),
      db
        .select({ value: count() })
        .from(schema.goldAccounts)
        .where(eq(schema.goldAccounts.status, "active")),
      db
        .select({ value: count() })
        .from(schema.breakfastEvents)
        .where(
          inArray(schema.breakfastEvents.status, [
            "planning",
            "inviting",
            "confirmed",
          ]),
        ),
      db
        .select()
        .from(schema.syncRuns)
        .orderBy(desc(schema.syncRuns.startedAt))
        .limit(1),
    ]);

    return {
      dbReady: true,
      dbError: null,
      pendingProposalsCount: Number(pendingProposals?.value ?? 0),
      conflictProposalsCount: Number(conflictProposals?.value ?? 0),
      awaitingApprovalMessagesCount: Number(awaitingMessages?.value ?? 0),
      overdueActionsCount: Number(overdueActions?.value ?? 0),
      dueTodayOrOpenActionsCount: Number(openActions?.value ?? 0),
      activeGoldAccountsCount: Number(goldAccounts?.value ?? 0),
      upcomingBreakfastsCount: Number(breakfasts?.value ?? 0),
      lastSyncRun: syncRuns[0] ?? null,
    };
  } catch (err) {
    return {
      dbReady: false,
      dbError:
        err instanceof Error
          ? err.message
          : "Database schema not yet pushed or unreachable",
      pendingProposalsCount: 0,
      conflictProposalsCount: 0,
      awaitingApprovalMessagesCount: 0,
      overdueActionsCount: 0,
      dueTodayOrOpenActionsCount: 0,
      activeGoldAccountsCount: 0,
      upcomingBreakfastsCount: 0,
      lastSyncRun: null,
    };
  }
}

export async function getOverviewCockpitData(): Promise<OverviewCockpitData> {
  const empty: OverviewCockpitData = {
    upcomingBreakfasts: [],
    priorityActions: [],
    pendingReviews: [],
    pendingMessages: [],
  };
  if (!isDatabaseConfigured()) return empty;

  try {
    const db = getDb();
    const [events, actions, reviews, messages, users] = await Promise.all([
      db
        .select()
        .from(schema.breakfastEvents)
        .where(
          inArray(schema.breakfastEvents.status, [
            "planning",
            "inviting",
            "confirmed",
          ]),
        )
        .orderBy(asc(schema.breakfastEvents.eventDate))
        .limit(5),
      db
        .select()
        .from(schema.followUpActions)
        .where(inArray(schema.followUpActions.status, ["open", "needs_review"]))
        .orderBy(asc(schema.followUpActions.dueDate))
        .limit(8),
      db
        .select({
          id: schema.changeProposals.id,
          summary: schema.changeProposals.summary,
          status: schema.changeProposals.status,
          targetSystem: schema.changeProposals.targetSystem,
          entityType: schema.changeProposals.entityType,
          createdAt: schema.changeProposals.createdAt,
        })
        .from(schema.changeProposals)
        .where(
          inArray(schema.changeProposals.status, ["pending_review", "conflict"]),
        )
        .orderBy(desc(schema.changeProposals.createdAt))
        .limit(6),
      db
        .select({
          id: schema.messageApprovals.id,
          recipientName: schema.messageApprovals.recipientName,
          channel: schema.messageApprovals.channel,
          subject: schema.messageApprovals.subject,
          createdAt: schema.messageApprovals.createdAt,
        })
        .from(schema.messageApprovals)
        .where(eq(schema.messageApprovals.status, "awaiting_approval"))
        .orderBy(desc(schema.messageApprovals.createdAt))
        .limit(5),
      db
        .select({
          id: schema.users.id,
          name: schema.users.name,
          email: schema.users.email,
        })
        .from(schema.users),
    ]);

    const eventIds = events.map((e) => e.id);
    const goldIds = Array.from(
      new Set(actions.map((a) => a.goldAccountId).filter(Boolean) as string[]),
    );
    const personIds = Array.from(
      new Set(actions.map((a) => a.folkPersonLinkId).filter(Boolean) as string[]),
    );

    const [hosts, invitations, goldAccounts, people] = await Promise.all([
      eventIds.length > 0
        ? db
            .select()
            .from(schema.breakfastHosts)
            .where(inArray(schema.breakfastHosts.eventId, eventIds))
        : Promise.resolve([]),
      eventIds.length > 0
        ? db
            .select()
            .from(schema.breakfastInvitations)
            .where(inArray(schema.breakfastInvitations.eventId, eventIds))
        : Promise.resolve([]),
      goldIds.length > 0
        ? db
            .select({
              id: schema.goldAccounts.id,
              folkCompanyLinkId: schema.goldAccounts.folkCompanyLinkId,
            })
            .from(schema.goldAccounts)
            .where(inArray(schema.goldAccounts.id, goldIds))
        : Promise.resolve([]),
      personIds.length > 0
        ? db
            .select({
              id: schema.folkPeopleLink.id,
              fullName: schema.folkPeopleLink.fullName,
            })
            .from(schema.folkPeopleLink)
            .where(inArray(schema.folkPeopleLink.id, personIds))
        : Promise.resolve([]),
    ]);

    const companyIds = Array.from(
      new Set(goldAccounts.map((g) => g.folkCompanyLinkId)),
    );
    const companies =
      companyIds.length > 0
        ? await db
            .select({
              id: schema.folkCompaniesLink.id,
              name: schema.folkCompaniesLink.name,
            })
            .from(schema.folkCompaniesLink)
            .where(inArray(schema.folkCompaniesLink.id, companyIds))
        : [];

    const userMap = new Map(users.map((u) => [u.id, u.name ?? u.email]));
    const companyMap = new Map(companies.map((c) => [c.id, c.name]));
    const goldCompanyMap = new Map(
      goldAccounts.map((g) => [g.id, companyMap.get(g.folkCompanyLinkId) ?? null]),
    );
    const personMap = new Map(people.map((p) => [p.id, p.fullName]));

    const hostsByEvent = new Map<string, (typeof hosts)[number][]>();
    for (const h of hosts) {
      const list = hostsByEvent.get(h.eventId) ?? [];
      list.push(h);
      hostsByEvent.set(h.eventId, list);
    }
    const invitesByEvent = new Map<string, (typeof invitations)[number][]>();
    for (const i of invitations) {
      const list = invitesByEvent.get(i.eventId) ?? [];
      list.push(i);
      invitesByEvent.set(i.eventId, list);
    }

    const upcomingBreakfasts = events.map((ev) => {
      const evHosts = hostsByEvent.get(ev.id) ?? [];
      const evInvites = invitesByEvent.get(ev.id) ?? [];
      const cap = calculateBreakfastCapacity({
        totalCapacity: ev.totalCapacity,
        attendingHostCount: evHosts.filter((h) => h.attending).length,
        invitations: evInvites,
      });
      return {
        id: ev.id,
        title: ev.title,
        locale: ev.locale,
        eventDate: ev.eventDate,
        venueName: ev.venueName,
        status: ev.status,
        confirmedGuestCount: cap.confirmedGuestCount,
        guestCapacity: cap.guestCapacity,
        inviteeCount: evInvites.length,
      };
    });

    const priorityActions = actions.map((a) => ({
      id: a.id,
      title: a.title,
      status: a.status,
      dueDate: a.dueDate,
      ownerName: userMap.get(a.ownerUserId) ?? "Founder",
      goldAccountId: a.goldAccountId,
      companyName: a.goldAccountId ? goldCompanyMap.get(a.goldAccountId) ?? null : null,
      personName: a.folkPersonLinkId ? personMap.get(a.folkPersonLinkId) ?? null : null,
    }));

    return {
      upcomingBreakfasts,
      priorityActions,
      pendingReviews: reviews,
      pendingMessages: messages,
    };
  } catch {
    return empty;
  }
}
