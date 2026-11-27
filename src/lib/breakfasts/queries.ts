import { asc, desc, eq, inArray, isNull } from "drizzle-orm";
import type { AppDatabase } from "@/db";
import { schema } from "@/db";
import { ensureAllowlistedFounders } from "@/lib/founders";
import {
  calculateBreakfastCapacity,
  normalizeLocale,
  type BreakfastCapacityMetrics,
} from "./rules";

export async function loadBreakfastCapacityForEvent(
  db: AppDatabase,
  eventId: string,
): Promise<{
  event: typeof schema.breakfastEvents.$inferSelect;
  attendingHosts: (typeof schema.breakfastHosts.$inferSelect)[];
  invitations: (typeof schema.breakfastInvitations.$inferSelect)[];
  capacity: BreakfastCapacityMetrics;
}> {
  const [event] = await db
    .select()
    .from(schema.breakfastEvents)
    .where(eq(schema.breakfastEvents.id, eventId))
    .limit(1);

  if (!event) {
    throw new Error(`Breakfast event ${eventId} not found`);
  }

  const [hosts, invitations] = await Promise.all([
    db
      .select()
      .from(schema.breakfastHosts)
      .where(eq(schema.breakfastHosts.eventId, eventId)),
    db
      .select()
      .from(schema.breakfastInvitations)
      .where(eq(schema.breakfastInvitations.eventId, eventId)),
  ]);

  const attendingHostCount = hosts.filter((h) => h.attending).length;
  const capacity = calculateBreakfastCapacity({
    totalCapacity: event.totalCapacity,
    attendingHostCount,
    invitations,
  });

  return { event, attendingHosts: hosts, invitations, capacity };
}

export async function loadFullBreakfastWorkspace(
  db: AppDatabase,
  eventId: string,
) {
  const founders = await ensureAllowlistedFounders(db);
  const { event, attendingHosts, invitations, capacity } =
    await loadBreakfastCapacityForEvent(db, eventId);

  const personIds = invitations.map((i) => i.folkPersonLinkId);
  const invitationIds = invitations.map((i) => i.id);

  const [people, historyRows, feedbackRows, referralRows] = await Promise.all([
    personIds.length > 0
      ? db
          .select()
          .from(schema.folkPeopleLink)
          .where(inArray(schema.folkPeopleLink.id, personIds))
      : Promise.resolve([]),
    invitationIds.length > 0
      ? db
          .select()
          .from(schema.breakfastInvitationHistory)
          .where(
            inArray(schema.breakfastInvitationHistory.invitationId, invitationIds),
          )
          .orderBy(desc(schema.breakfastInvitationHistory.createdAt))
      : Promise.resolve([]),
    db
      .select()
      .from(schema.breakfastFeedback)
      .where(eq(schema.breakfastFeedback.eventId, eventId))
      .orderBy(desc(schema.breakfastFeedback.createdAt)),
    db
      .select()
      .from(schema.breakfastReferrals)
      .where(eq(schema.breakfastReferrals.eventId, eventId))
      .orderBy(desc(schema.breakfastReferrals.createdAt)),
  ]);

  const companyIds = Array.from(
    new Set(people.map((p) => p.folkCompanyLinkId).filter(Boolean) as string[]),
  );
  const companies =
    companyIds.length > 0
      ? await db
          .select()
          .from(schema.folkCompaniesLink)
          .where(inArray(schema.folkCompaniesLink.id, companyIds))
      : [];

  const companyMap = new Map(companies.map((c) => [c.id, c]));
  const personMap = new Map(people.map((p) => [p.id, p]));
  const historyByInvitation = new Map<
    string,
    (typeof schema.breakfastInvitationHistory.$inferSelect)[]
  >();
  for (const h of historyRows) {
    const arr = historyByInvitation.get(h.invitationId) ?? [];
    arr.push(h);
    historyByInvitation.set(h.invitationId, arr);
  }

  const enrichedInvitations = invitations.map((inv) => {
    const person = personMap.get(inv.folkPersonLinkId) ?? null;
    const company =
      person?.folkCompanyLinkId
        ? companyMap.get(person.folkCompanyLinkId) ?? null
        : null;
    return {
      ...inv,
      person: person
        ? {
            id: person.id,
            folkPersonId: person.folkPersonId,
            fullName: person.fullName,
            email: person.email,
            jobTitle: person.jobTitle,
            linkedinUrl: person.linkedinUrl,
            contactSuppressed: person.contactSuppressed,
            suppressionReason: person.suppressionReason,
            companyName: company?.name ?? null,
          }
        : null,
      history: historyByInvitation.get(inv.id) ?? [],
    };
  });

  // Load manual carry-forward candidates (previous attendees & non-responders in same locale)
  const targetLocale = normalizeLocale(event.locale);
  const allEvents = await db
    .select()
    .from(schema.breakfastEvents)
    .orderBy(desc(schema.breakfastEvents.eventDate));
  const otherSameLocaleEvents = allEvents.filter(
    (e) => e.id !== event.id && normalizeLocale(e.locale) === targetLocale,
  );
  const otherEventIds = otherSameLocaleEvents.map((e) => e.id);
  const currentPersonIdSet = new Set(personIds);

  let manualCarryForwardOptions: Array<{
    folkPersonLinkId: string;
    fullName: string;
    email: string | null;
    jobTitle: string | null;
    companyName: string | null;
    sourceEventId: string;
    sourceEventTitle: string;
    sourceResponseStatus: string;
    sourceAttendanceOutcome: string;
  }> = [];

  if (otherEventIds.length > 0) {
    const priorInvites = await db
      .select()
      .from(schema.breakfastInvitations)
      .where(inArray(schema.breakfastInvitations.eventId, otherEventIds))
      .orderBy(desc(schema.breakfastInvitations.updatedAt));

    const priorPersonIds = Array.from(
      new Set(priorInvites.map((i) => i.folkPersonLinkId)),
    ).filter((pid) => !currentPersonIdSet.has(pid));

    if (priorPersonIds.length > 0) {
      const priorPeople = await db
        .select()
        .from(schema.folkPeopleLink)
        .where(inArray(schema.folkPeopleLink.id, priorPersonIds));
      const priorCompanyIds = Array.from(
        new Set(
          priorPeople
            .map((p) => p.folkCompanyLinkId)
            .filter(Boolean) as string[],
        ),
      );
      const priorCompanies =
        priorCompanyIds.length > 0
          ? await db
              .select()
              .from(schema.folkCompaniesLink)
              .where(inArray(schema.folkCompaniesLink.id, priorCompanyIds))
          : [];
      const priorCompanyMap = new Map(priorCompanies.map((c) => [c.id, c]));
      const priorPersonMap = new Map(priorPeople.map((p) => [p.id, p]));
      const otherEventMap = new Map(otherSameLocaleEvents.map((e) => [e.id, e]));
      const deduped = new Set<string>();

      for (const inv of priorInvites) {
        if (deduped.has(inv.folkPersonLinkId)) continue;
        if (currentPersonIdSet.has(inv.folkPersonLinkId)) continue;
        const p = priorPersonMap.get(inv.folkPersonLinkId);
        if (!p || p.contactSuppressed) continue;
        const srcEvent = otherEventMap.get(inv.eventId);
        if (!srcEvent) continue;

        deduped.add(inv.folkPersonLinkId);
        const comp = p.folkCompanyLinkId
          ? priorCompanyMap.get(p.folkCompanyLinkId)
          : undefined;
        manualCarryForwardOptions.push({
          folkPersonLinkId: p.id,
          fullName: p.fullName,
          email: p.email,
          jobTitle: p.jobTitle,
          companyName: comp?.name ?? null,
          sourceEventId: srcEvent.id,
          sourceEventTitle: srcEvent.title,
          sourceResponseStatus: inv.responseStatus,
          sourceAttendanceOutcome: inv.attendanceOutcome,
        });
      }
    }
  }

  return {
    event,
    founders,
    hosts: attendingHosts,
    capacity,
    invitations: enrichedInvitations,
    feedback: feedbackRows,
    referrals: referralRows,
    manualCarryForwardOptions,
  };
}

export async function listBreakfastsSummary(db: AppDatabase) {
  const founders = await ensureAllowlistedFounders(db);
  const [events, hosts, invitations, queuedRows] = await Promise.all([
    db
      .select()
      .from(schema.breakfastEvents)
      .orderBy(asc(schema.breakfastEvents.eventDate)),
    db.select().from(schema.breakfastHosts),
    db.select().from(schema.breakfastInvitations),
    db
      .select()
      .from(schema.localeCarryForwardQueue)
      .where(isNull(schema.localeCarryForwardQueue.consumedByEventId)),
  ]);

  const hostsByEvent = new Map<
    string,
    (typeof schema.breakfastHosts.$inferSelect)[]
  >();
  for (const h of hosts) {
    const arr = hostsByEvent.get(h.eventId) ?? [];
    arr.push(h);
    hostsByEvent.set(h.eventId, arr);
  }

  const invitesByEvent = new Map<
    string,
    (typeof schema.breakfastInvitations.$inferSelect)[]
  >();
  for (const inv of invitations) {
    const arr = invitesByEvent.get(inv.eventId) ?? [];
    arr.push(inv);
    invitesByEvent.set(inv.eventId, arr);
  }

  const queueCountsByLocale: Record<string, number> = {};
  for (const q of queuedRows) {
    const loc = normalizeLocale(q.locale);
    queueCountsByLocale[loc] = (queueCountsByLocale[loc] ?? 0) + 1;
  }

  const enrichedEvents = events.map((ev) => {
    const evHosts = hostsByEvent.get(ev.id) ?? [];
    const evInvites = invitesByEvent.get(ev.id) ?? [];
    const capacity = calculateBreakfastCapacity({
      totalCapacity: ev.totalCapacity,
      attendingHostCount: evHosts.filter((h) => h.attending).length,
      invitations: evInvites,
    });
    return {
      ...ev,
      hosts: evHosts,
      inviteeCount: evInvites.length,
      capacity,
    };
  });

  return {
    founders,
    events: enrichedEvents.reverse(),
    queueCountsByLocale,
  };
}
