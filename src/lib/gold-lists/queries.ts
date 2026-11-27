import { asc, desc, eq, inArray } from "drizzle-orm";
import type { AppDatabase } from "@/db";
import { schema } from "@/db";
import { ensureAllowlistedFounders } from "@/lib/founders";
import {
  deduplicateTimelineActivities,
  evaluateAccountFit,
} from "./rules";

export async function getActiveGoldCountsByOwner(
  db: AppDatabase,
): Promise<Record<string, number>> {
  const activeAccounts = await db
    .select({ ownerUserId: schema.goldAccounts.ownerUserId })
    .from(schema.goldAccounts)
    .where(eq(schema.goldAccounts.status, "active"));

  const counts: Record<string, number> = {};
  for (const row of activeAccounts) {
    counts[row.ownerUserId] = (counts[row.ownerUserId] ?? 0) + 1;
  }
  return counts;
}

export async function listGoldAccountsSummary(db: AppDatabase) {
  const founders = await ensureAllowlistedFounders(db);
  const [accounts, companies, contacts, signals, actions, activities] =
    await Promise.all([
      db
        .select()
        .from(schema.goldAccounts)
        .orderBy(desc(schema.goldAccounts.updatedAt)),
      db.select().from(schema.folkCompaniesLink),
      db.select().from(schema.goldAccountContacts),
      db
        .select()
        .from(schema.buyingSignals)
        .orderBy(desc(schema.buyingSignals.signalDate)),
      db.select().from(schema.followUpActions),
      db
        .select()
        .from(schema.outreachActivities)
        .orderBy(desc(schema.outreachActivities.occurredAt)),
    ]);

  const founderMap = new Map(founders.map((f) => [f.id, f]));
  const companyMap = new Map(companies.map((c) => [c.id, c]));

  const ownerCounts: Record<string, number> = {};
  for (const f of founders) ownerCounts[f.id] = 0;

  const contactsByAcc = new Map<
    string,
    { mapped: number; gaps: number }
  >();
  for (const c of contacts) {
    const entry = contactsByAcc.get(c.goldAccountId) ?? { mapped: 0, gaps: 0 };
    if (c.coverageStatus === "gap") entry.gaps += 1;
    else if (c.coverageStatus === "mapped") entry.mapped += 1;
    contactsByAcc.set(c.goldAccountId, entry);
  }

  const latestSignalByAcc = new Map<
    string,
    typeof schema.buyingSignals.$inferSelect
  >();
  for (const s of signals) {
    if (!latestSignalByAcc.has(s.goldAccountId)) {
      latestSignalByAcc.set(s.goldAccountId, s);
    }
  }

  const openActionsByAcc = new Map<string, number>();
  for (const a of actions) {
    if (!a.goldAccountId) continue;
    if (a.status === "open" || a.status === "needs_review") {
      openActionsByAcc.set(
        a.goldAccountId,
        (openActionsByAcc.get(a.goldAccountId) ?? 0) + 1,
      );
    }
  }

  const lastActivityByAcc = new Map<string, Date>();
  for (const act of activities) {
    if (!act.goldAccountId) continue;
    if (!lastActivityByAcc.has(act.goldAccountId)) {
      lastActivityByAcc.set(act.goldAccountId, act.occurredAt);
    }
  }

  const enriched = accounts.map((acc) => {
    if (acc.status === "active") {
      ownerCounts[acc.ownerUserId] = (ownerCounts[acc.ownerUserId] ?? 0) + 1;
    }
    const company = companyMap.get(acc.folkCompanyLinkId);
    const owner = founderMap.get(acc.ownerUserId);
    const coverage = contactsByAcc.get(acc.id) ?? { mapped: 0, gaps: 0 };
    const latestSignal = latestSignalByAcc.get(acc.id) ?? null;

    return {
      ...acc,
      companyName: company?.name ?? "Unknown Company",
      companyDomain: company?.domain ?? null,
      folkCompanyId: company?.folkCompanyId ?? null,
      ownerName: owner?.name ?? "Unassigned",
      fit: evaluateAccountFit({
        marketingTeamSize: acc.marketingTeamSize,
        legacySetupNotes: acc.legacySetupNotes,
      }),
      mappedContactsCount: coverage.mapped,
      coverageGapsCount: coverage.gaps,
      latestSignal: latestSignal
        ? {
            id: latestSignal.id,
            signalType: latestSignal.signalType,
            title: latestSignal.title,
            signalDate: latestSignal.signalDate,
          }
        : null,
      openActionsCount: openActionsByAcc.get(acc.id) ?? 0,
      lastActivityAt: lastActivityByAcc.get(acc.id) ?? null,
    };
  });

  return {
    founders,
    ownerCounts,
    accounts: enriched,
  };
}

export async function loadGoldAccountWorkspace(
  db: AppDatabase,
  goldAccountId: string,
) {
  const founders = await ensureAllowlistedFounders(db);
  const ownerCounts = await getActiveGoldCountsByOwner(db);

  const [account] = await db
    .select()
    .from(schema.goldAccounts)
    .where(eq(schema.goldAccounts.id, goldAccountId))
    .limit(1);

  if (!account) {
    throw new Error(`Gold account ${goldAccountId} not found`);
  }

  const [[company], contacts, intelligence, signals, rawActivities, actions] =
    await Promise.all([
      db
        .select()
        .from(schema.folkCompaniesLink)
        .where(eq(schema.folkCompaniesLink.id, account.folkCompanyLinkId))
        .limit(1),
      db
        .select()
        .from(schema.goldAccountContacts)
        .where(eq(schema.goldAccountContacts.goldAccountId, goldAccountId))
        .orderBy(desc(schema.goldAccountContacts.isPrimaryDecisionMaker)),
      db
        .select()
        .from(schema.accountIntelligence)
        .where(eq(schema.accountIntelligence.goldAccountId, goldAccountId))
        .orderBy(desc(schema.accountIntelligence.createdAt)),
      db
        .select()
        .from(schema.buyingSignals)
        .where(eq(schema.buyingSignals.goldAccountId, goldAccountId))
        .orderBy(desc(schema.buyingSignals.signalDate)),
      db
        .select()
        .from(schema.outreachActivities)
        .where(eq(schema.outreachActivities.goldAccountId, goldAccountId))
        .orderBy(desc(schema.outreachActivities.occurredAt)),
      db
        .select()
        .from(schema.followUpActions)
        .where(eq(schema.followUpActions.goldAccountId, goldAccountId))
        .orderBy(asc(schema.followUpActions.dueDate)),
    ]);

  const personIds = Array.from(
    new Set(
      [
        ...contacts.map((c) => c.folkPersonLinkId),
        ...rawActivities.map((a) => a.folkPersonLinkId),
        ...actions.map((a) => a.folkPersonLinkId),
      ].filter(Boolean) as string[],
    ),
  );

  const [people, breakfastInvites] = await Promise.all([
    personIds.length > 0
      ? db
          .select()
          .from(schema.folkPeopleLink)
          .where(inArray(schema.folkPeopleLink.id, personIds))
      : Promise.resolve([]),
    personIds.length > 0
      ? db
          .select()
          .from(schema.breakfastInvitations)
          .where(inArray(schema.breakfastInvitations.folkPersonLinkId, personIds))
      : Promise.resolve([]),
  ]);

  const eventIds = Array.from(
    new Set(breakfastInvites.map((bi) => bi.eventId)),
  );
  const events =
    eventIds.length > 0
      ? await db
          .select()
          .from(schema.breakfastEvents)
          .where(inArray(schema.breakfastEvents.id, eventIds))
      : [];

  const personMap = new Map(people.map((p) => [p.id, p]));
  const eventMap = new Map(events.map((e) => [e.id, e]));
  const founderMap = new Map(founders.map((f) => [f.id, f]));

  const dedupedActivities = deduplicateTimelineActivities(rawActivities);

  return {
    account: {
      ...account,
      fit: evaluateAccountFit({
        marketingTeamSize: account.marketingTeamSize,
        legacySetupNotes: account.legacySetupNotes,
      }),
    },
    company: company ?? null,
    founders,
    ownerCounts,
    contacts: contacts.map((c) => ({
      ...c,
      person: c.folkPersonLinkId ? personMap.get(c.folkPersonLinkId) ?? null : null,
    })),
    intelligence,
    signals,
    activities: dedupedActivities.map((act) => ({
      ...act,
      personName: act.folkPersonLinkId
        ? personMap.get(act.folkPersonLinkId)?.fullName ?? null
        : null,
      ownerName: act.ownerUserId
        ? founderMap.get(act.ownerUserId)?.name ?? null
        : null,
    })),
    actions: actions.map((a) => ({
      ...a,
      personName: a.folkPersonLinkId
        ? personMap.get(a.folkPersonLinkId)?.fullName ?? null
        : null,
      ownerName: founderMap.get(a.ownerUserId)?.name ?? "Unknown",
    })),
    relatedBreakfasts: breakfastInvites.map((bi) => {
      const ev = eventMap.get(bi.eventId);
      const p = personMap.get(bi.folkPersonLinkId);
      return {
        invitationId: bi.id,
        eventId: bi.eventId,
        eventTitle: ev?.title ?? "Breakfast",
        locale: ev?.locale ?? "",
        eventDate: ev?.eventDate ?? null,
        personName: p?.fullName ?? "Unknown",
        responseStatus: bi.responseStatus,
        attendanceOutcome: bi.attendanceOutcome,
      };
    }),
  };
}
