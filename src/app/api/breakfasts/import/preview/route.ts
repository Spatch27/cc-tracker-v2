import { desc } from "drizzle-orm";
import { z } from "zod";
import { getDb, isDatabaseConfigured, schema } from "@/db";
import { errorResponse } from "@/lib/api-auth";
import { requireFounderSession } from "@/lib/auth";
import { matchBreakfastRowToFolk } from "@/lib/breakfasts/import-parser";
import { normalizeLocale } from "@/lib/breakfasts/rules";
import { createFolkClientFromEnv, listAllFolkPeople } from "@/lib/folk/client";

export const dynamic = "force-dynamic";

const previewSchema = z.object({
  blocks: z
    .array(
      z.object({
        locale: z.string().min(1),
        headerLabel: z.string(),
        dateLabel: z.string().nullable().optional(),
        stoppedAtMarker: z.string().nullable().optional(),
        rows: z.array(
          z.object({
            rowNumber: z.number().int().positive(),
            rawName: z.string().min(1),
            companyHint: z.string().nullable().optional(),
            roleHint: z.string().nullable().optional(),
            notes: z.string().nullable().optional(),
          }),
        ),
      }),
    )
    .min(1),
});

export async function POST(request: Request) {
  try {
    await requireFounderSession();
    if (!isDatabaseConfigured()) {
      return Response.json(
        { error: "Database is not configured" },
        { status: 503 },
      );
    }

    const folkClient = createFolkClientFromEnv();
    if (!folkClient) {
      return Response.json(
        { error: "FOLK_API_KEY is not configured" },
        { status: 503 },
      );
    }

    const body = previewSchema.parse(await request.json());
    const db = getDb();

    const [{ items: folkPeople, pagesFetched, truncated }, events, personLinks, invitations] =
      await Promise.all([
        listAllFolkPeople(folkClient, 25),
        db
          .select()
          .from(schema.breakfastEvents)
          .orderBy(desc(schema.breakfastEvents.eventDate)),
        db.select().from(schema.folkPeopleLink),
        db.select().from(schema.breakfastInvitations),
      ]);

    const folkIdByLinkId = new Map(personLinks.map((p) => [p.id, p.folkPersonId]));
    const suppressedFolkIds = new Set(
      personLinks.filter((p) => p.contactSuppressed).map((p) => p.folkPersonId),
    );

    const eventIdsByFolkPersonId = new Map<string, Set<string>>();
    for (const inv of invitations) {
      const folkPersonId = folkIdByLinkId.get(inv.folkPersonLinkId);
      if (!folkPersonId) continue;
      const set = eventIdsByFolkPersonId.get(folkPersonId) ?? new Set<string>();
      set.add(inv.eventId);
      eventIdsByFolkPersonId.set(folkPersonId, set);
    }

    const activeStatuses = new Set(["planning", "inviting", "confirmed"]);
    const previewBlocks = body.blocks.map((block) => {
      const normBlockLocale = normalizeLocale(block.locale);
      const matchingEvents = events.filter(
        (ev) => normalizeLocale(ev.locale) === normBlockLocale,
      );
      const suggestedEvent =
        matchingEvents.find((ev) => activeStatuses.has(ev.status)) ??
        matchingEvents[0] ??
        null;

      const rows = block.rows.map((row) => {
        const match = matchBreakfastRowToFolk(
          {
            rowNumber: row.rowNumber,
            rawName: row.rawName,
            companyHint: row.companyHint ?? null,
            roleHint: row.roleHint ?? null,
            notes: row.notes ?? null,
          },
          folkPeople,
        );

        const bestFolkId = match.bestMatch?.folkPersonId ?? null;
        const alreadyOnEventIds = bestFolkId
          ? Array.from(eventIdsByFolkPersonId.get(bestFolkId) ?? [])
          : [];
        const contactSuppressed = bestFolkId
          ? suppressedFolkIds.has(bestFolkId)
          : false;

        const candidateAnnotations: Record<
          string,
          { alreadyOnEventIds: string[]; contactSuppressed: boolean }
        > = {};
        for (const c of match.candidates) {
          candidateAnnotations[c.folkPersonId] = {
            alreadyOnEventIds: Array.from(
              eventIdsByFolkPersonId.get(c.folkPersonId) ?? [],
            ),
            contactSuppressed: suppressedFolkIds.has(c.folkPersonId),
          };
        }

        return {
          rowNumber: row.rowNumber,
          rawName: row.rawName,
          companyHint: row.companyHint ?? null,
          roleHint: row.roleHint ?? null,
          notes: row.notes ?? null,
          match,
          alreadyOnEventIds,
          contactSuppressed,
          candidateAnnotations,
        };
      });

      return {
        locale: block.locale,
        headerLabel: block.headerLabel,
        dateLabel: block.dateLabel ?? null,
        stoppedAtMarker: block.stoppedAtMarker ?? null,
        suggestedEventId: suggestedEvent?.id ?? null,
        rows,
      };
    });

    return Response.json({
      folkPeopleTotal: folkPeople.length,
      folkPagesFetched: pagesFetched,
      folkTruncated: truncated,
      existingEvents: events.map((ev) => ({
        id: ev.id,
        locale: ev.locale,
        title: ev.title,
        eventDate: ev.eventDate.toISOString(),
        status: ev.status,
      })),
      blocks: previewBlocks,
    });
  } catch (err) {
    return errorResponse(err);
  }
}
