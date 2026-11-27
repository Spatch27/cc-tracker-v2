import { and, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import { getDb, isDatabaseConfigured, schema } from "@/db";
import { errorResponse } from "@/lib/api-auth";
import { requireFounderSession } from "@/lib/auth";
import { listBreakfastsSummary } from "@/lib/breakfasts/queries";
import { formatLocaleLabel, normalizeLocale } from "@/lib/breakfasts/rules";
import { recordAuditEvent } from "@/lib/governance/audit";

export const dynamic = "force-dynamic";

const createBreakfastSchema = z.object({
  locale: z.string().min(1).max(80),
  title: z.string().min(1).max(160),
  eventDate: z.string().min(1),
  venueName: z.string().max(160).nullable().optional(),
  venueAddress: z.string().max(300).nullable().optional(),
  totalCapacity: z.number().int().min(2).max(100).default(14),
  attendingHostUserIds: z.array(z.string().uuid()).default([]),
  logisticsOwnerUserId: z.string().uuid().nullable().optional(),
});

export async function GET() {
  try {
    await requireFounderSession();
    if (!isDatabaseConfigured()) {
      return Response.json({
        founders: [],
        events: [],
        queueCountsByLocale: {},
        databaseConfigured: false,
      });
    }
    const db = getDb();
    const summary = await listBreakfastsSummary(db);
    return Response.json(summary);
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const founder = await requireFounderSession();
    if (!isDatabaseConfigured()) {
      return Response.json(
        { error: "Database is not configured" },
        { status: 503 },
      );
    }

    const body = createBreakfastSchema.parse(await request.json());
    const db = getDb();
    const displayLocale = formatLocaleLabel(body.locale);
    const normalizedLocale = normalizeLocale(body.locale);

    const [created] = await db
      .insert(schema.breakfastEvents)
      .values({
        locale: displayLocale,
        title: body.title.trim(),
        eventDate: new Date(body.eventDate),
        venueName: body.venueName?.trim() || null,
        venueAddress: body.venueAddress?.trim() || null,
        totalCapacity: body.totalCapacity,
        status: "planning",
        logisticsOwnerUserId: body.logisticsOwnerUserId ?? founder.userId,
      })
      .returning();

    if (body.attendingHostUserIds.length > 0) {
      await db
        .insert(schema.breakfastHosts)
        .values(
          body.attendingHostUserIds.map((userId) => ({
            eventId: created.id,
            userId,
            attending: true,
          })),
        )
        .onConflictDoNothing();
    }

    // Pull any unconsumed same-locale carry-forward queue candidates into provisional list
    const queuedAll = await db
      .select()
      .from(schema.localeCarryForwardQueue)
      .where(isNull(schema.localeCarryForwardQueue.consumedByEventId));

    const matchingQueue = queuedAll.filter(
      (q) => normalizeLocale(q.locale) === normalizedLocale,
    );

    let carriedForwardCount = 0;
    if (matchingQueue.length > 0) {
      const personIds = Array.from(
        new Set(matchingQueue.map((q) => q.folkPersonLinkId)),
      );
      const people = await db
        .select()
        .from(schema.folkPeopleLink)
        .where(inArray(schema.folkPeopleLink.id, personIds));
      const allowedSet = new Set(
        people.filter((p) => !p.contactSuppressed).map((p) => p.id),
      );

      const seen = new Set<string>();
      for (const q of matchingQueue) {
        if (!allowedSet.has(q.folkPersonLinkId)) continue;
        if (seen.has(q.folkPersonLinkId)) continue;
        seen.add(q.folkPersonLinkId);

        const inserted = await db
          .insert(schema.breakfastInvitations)
          .values({
            eventId: created.id,
            folkPersonLinkId: q.folkPersonLinkId,
            responseStatus: "provisional",
            attendanceOutcome: "pending",
            waitlistStatus: "none",
            chaseStatus: "none",
            carriedForwardFromEventId: q.sourceEventId,
            dietaryNotes: null,
            specialRequests: null,
            earlyDepartureNote: null,
          })
          .onConflictDoNothing()
          .returning({ id: schema.breakfastInvitations.id });

        if (inserted[0]) {
          carriedForwardCount += 1;
          await db.insert(schema.breakfastInvitationHistory).values({
            invitationId: inserted[0].id,
            changedByUserId: founder.userId,
            previousResponseStatus: null,
            newResponseStatus: "provisional",
            previousAttendanceOutcome: null,
            newAttendanceOutcome: "pending",
            previousWaitlistStatus: null,
            newWaitlistStatus: "none",
            note: "Automatically carried forward from same-locale queue",
          });
        }
      }

      await db
        .update(schema.localeCarryForwardQueue)
        .set({ consumedByEventId: created.id })
        .where(
          and(
            isNull(schema.localeCarryForwardQueue.consumedByEventId),
            inArray(
              schema.localeCarryForwardQueue.id,
              matchingQueue.map((m) => m.id),
            ),
          ),
        );
    }

    await recordAuditEvent({
      actorType: "human",
      actorUserId: founder.userId,
      action: "breakfast_event_created",
      entityType: "breakfast_event",
      entityId: created.id,
      newValue: {
        locale: created.locale,
        title: created.title,
        totalCapacity: created.totalCapacity,
        carriedForwardCount,
      },
      outcome: "succeeded",
    });

    return Response.json(
      { event: created, carriedForwardCount },
      { status: 201 },
    );
  } catch (err) {
    return errorResponse(err);
  }
}
