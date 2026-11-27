import { eq, inArray } from "drizzle-orm";
import { getDb, isDatabaseConfigured, schema } from "@/db";
import { errorResponse } from "@/lib/api-auth";
import { requireFounderSession } from "@/lib/auth";
import { createFolkClientFromEnv } from "@/lib/folk/client";
import { normalizeFolkInteraction } from "@/lib/gold-lists/rules";
import { recordAuditEvent } from "@/lib/governance/audit";

export const dynamic = "force-dynamic";

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const founder = await requireFounderSession();
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
        { status: 400 },
      );
    }

    const { id: goldAccountId } = await context.params;
    const db = getDb();

    const [account] = await db
      .select()
      .from(schema.goldAccounts)
      .where(eq(schema.goldAccounts.id, goldAccountId))
      .limit(1);

    if (!account) {
      return Response.json({ error: "Gold account not found" }, { status: 404 });
    }

    const contacts = await db
      .select()
      .from(schema.goldAccountContacts)
      .where(eq(schema.goldAccountContacts.goldAccountId, goldAccountId));

    const personLinkIds = Array.from(
      new Set(
        contacts.map((c) => c.folkPersonLinkId).filter(Boolean) as string[],
      ),
    );

    if (personLinkIds.length === 0) {
      const note =
        "No Folk decision-makers mapped to this account yet; map at least one contact to sync Folk interactions.";
      await db
        .update(schema.goldAccounts)
        .set({
          lastInteractionsSyncAt: new Date(),
          lastInteractionsSyncNote: note,
          updatedAt: new Date(),
        })
        .where(eq(schema.goldAccounts.id, goldAccountId));

      return Response.json({
        ok: true,
        recordsRead: 0,
        insertedCount: 0,
        restrictedCount: 0,
        syncNote: note,
      });
    }

    const people = await db
      .select()
      .from(schema.folkPeopleLink)
      .where(inArray(schema.folkPeopleLink.id, personLinkIds));

    const startedAt = new Date();
    let recordsRead = 0;
    let insertedCount = 0;
    let restrictedCount = 0;
    const errors: string[] = [];

    for (const person of people) {
      try {
        const res = await folkClient.listInteractions({
          entityId: person.folkPersonId,
          timeframe: "past",
          limit: 25,
        });
        recordsRead += res.items.length;

        for (const item of res.items) {
          const normalized = normalizeFolkInteraction(item, {
            goldAccountId,
            folkPersonLinkId: person.id,
          });
          if (normalized.visibilityRestricted) restrictedCount += 1;

          const inserted = await db
            .insert(schema.outreachActivities)
            .values(normalized)
            .onConflictDoNothing({
              target: schema.outreachActivities.folkInteractionId,
            })
            .returning({ id: schema.outreachActivities.id });

          if (inserted[0]) insertedCount += 1;
        }
      } catch (err) {
        errors.push(
          `${person.fullName}: ${err instanceof Error ? err.message : "Sync failed"}`,
        );
      }
    }

    const finishedAt = new Date();
    const syncNote =
      errors.length > 0
        ? `Partial sync across ${people.length} contact(s): ${errors.join("; ")}`
        : `Synced ${people.length} mapped contact(s) (${recordsRead} interaction(s) read, ${insertedCount} new, ${restrictedCount} privacy-restricted).`;

    await db.insert(schema.syncRuns).values({
      source: "folk_rest",
      scope: `gold_account:${goldAccountId}`,
      status:
        errors.length === 0
          ? "succeeded"
          : errors.length < people.length
            ? "partial"
            : "failed",
      recordsRead,
      visibilityGapNote:
        restrictedCount > 0
          ? `${restrictedCount} interaction(s) had Folk privacy restrictions`
          : null,
      errorSummary: errors.length > 0 ? errors.join("; ") : null,
      startedAt,
      finishedAt,
    });

    await db
      .update(schema.goldAccounts)
      .set({
        lastInteractionsSyncAt: finishedAt,
        lastInteractionsSyncNote: syncNote,
        updatedAt: finishedAt,
      })
      .where(eq(schema.goldAccounts.id, goldAccountId));

    await recordAuditEvent({
      actorType: "human",
      actorUserId: founder.userId,
      action: "gold_account_folk_synced",
      entityType: "gold_account",
      entityId: goldAccountId,
      newValue: { recordsRead, insertedCount, restrictedCount, errors },
      outcome: errors.length === 0 ? "succeeded" : "failed",
    });

    return Response.json({
      ok: errors.length === 0,
      recordsRead,
      insertedCount,
      restrictedCount,
      syncNote,
      errors,
    });
  } catch (err) {
    return errorResponse(err);
  }
}
