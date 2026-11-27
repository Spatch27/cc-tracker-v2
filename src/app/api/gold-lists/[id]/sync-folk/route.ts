import { eq, inArray } from "drizzle-orm";
import { getDb, isDatabaseConfigured, schema } from "@/db";
import { flagActionsForInboundReply } from "@/lib/actions/follow-ups";
import { errorResponse } from "@/lib/api-auth";
import { requireFounderSession } from "@/lib/auth";
import { ensureAllowlistedFounders } from "@/lib/founders";
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
        actionsFlaggedForReview: 0,
        syncNote: note,
      });
    }

    const [founders, people] = await Promise.all([
      ensureAllowlistedFounders(db),
      db
        .select()
        .from(schema.folkPeopleLink)
        .where(inArray(schema.folkPeopleLink.id, personLinkIds)),
    ]);

    const founderByEmail = new Map(
      founders.map((f) => [f.email.trim().toLowerCase(), f.id]),
    );
    const founderEmails = founders.map((f) => f.email);

    // Map Folk workspace user IDs to tracker founders by email (best-effort)
    const folkUserIdToFounderId = new Map<string, string>();
    try {
      const folkUsers = await folkClient.listUsers({ limit: 100 });
      for (const fu of folkUsers.items) {
        const email = fu.email?.trim().toLowerCase();
        if (email && founderByEmail.has(email)) {
          folkUserIdToFounderId.set(fu.id, founderByEmail.get(email)!);
        }
      }
    } catch {
      // Non-fatal if user list cannot be read; fall back to interaction.user.email
    }

    const startedAt = new Date();
    let recordsRead = 0;
    let insertedCount = 0;
    let restrictedCount = 0;
    let actionsFlaggedForReview = 0;
    const newInboundActivities: Array<{
      id: string;
      folkPersonLinkId: string | null;
      goldAccountId: string | null;
      conversationKey: string | null;
    }> = [];
    const errors: string[] = [];

    for (const person of people) {
      try {
        let cursor: string | undefined;
        let pages = 0;
        const maxPages = 5;
        const seenCursors = new Set<string>();

        while (pages < maxPages) {
          const res = await folkClient.listInteractions({
            entityId: person.folkPersonId,
            timeframe: "past",
            limit: 50,
            cursor,
          });
          recordsRead += res.items.length;
          pages += 1;

          for (const item of res.items) {
            const matchedOwnerId =
              (item.user?.email
                ? founderByEmail.get(item.user.email.trim().toLowerCase())
                : undefined) ??
              (item.userId ? folkUserIdToFounderId.get(item.userId) : undefined) ??
              (item.user?.id
                ? folkUserIdToFounderId.get(item.user.id)
                : undefined) ??
              null;

            const normalized = normalizeFolkInteraction(item, {
              goldAccountId,
              folkPersonLinkId: person.id,
              ownerUserId: matchedOwnerId,
              founderEmails,
            });
            if (normalized.visibilityRestricted) restrictedCount += 1;

            const inserted = await db
              .insert(schema.outreachActivities)
              .values(normalized)
              .onConflictDoNothing({
                target: schema.outreachActivities.folkInteractionId,
              })
              .returning({
                id: schema.outreachActivities.id,
                direction: schema.outreachActivities.direction,
                folkPersonLinkId: schema.outreachActivities.folkPersonLinkId,
                goldAccountId: schema.outreachActivities.goldAccountId,
                conversationKey: schema.outreachActivities.conversationKey,
              });

            if (inserted[0]) {
              insertedCount += 1;
              if (inserted[0].direction === "inbound") {
                newInboundActivities.push(inserted[0]);
              }
            }
          }

          const nextCursor = res.pagination?.nextCursor ?? undefined;
          if (!nextCursor || seenCursors.has(nextCursor)) {
            break;
          }
          seenCursors.add(nextCursor);
          cursor = nextCursor;
        }
      } catch (err) {
        errors.push(
          `${person.fullName}: ${err instanceof Error ? err.message : "Sync failed"}`,
        );
      }
    }

    // Automatically flag open follow-up actions as `needs_review` for newly synced inbound replies
    if (newInboundActivities.length > 0) {
      const openActions = await db
        .select()
        .from(schema.followUpActions)
        .where(eq(schema.followUpActions.goldAccountId, goldAccountId));

      const linkedActivityIds = Array.from(
        new Set(
          openActions.map((a) => a.activityId).filter(Boolean) as string[],
        ),
      );
      const linkedActivities =
        linkedActivityIds.length > 0
          ? await db
              .select({
                id: schema.outreachActivities.id,
                conversationKey: schema.outreachActivities.conversationKey,
              })
              .from(schema.outreachActivities)
              .where(inArray(schema.outreachActivities.id, linkedActivityIds))
          : [];
      const activityConversationMap = new Map(
        linkedActivities.map((la) => [la.id, la.conversationKey]),
      );

      let workingActions = openActions.map((a) => ({
        ...a,
        snoozeHistoryJson: a.snoozeHistoryJson ?? [],
        conversationKey: a.activityId
          ? activityConversationMap.get(a.activityId) ?? null
          : null,
      }));

      for (const reply of newInboundActivities) {
        const prevStatuses = new Map(
          workingActions.map((a) => [a.id, a.status]),
        );
        workingActions = flagActionsForInboundReply(workingActions, reply);
        for (const updated of workingActions) {
          if (
            prevStatuses.get(updated.id) === "open" &&
            updated.status === "needs_review"
          ) {
            await db
              .update(schema.followUpActions)
              .set({
                status: "needs_review",
                flaggedByReplyActivityId: reply.id,
                updatedAt: new Date(),
              })
              .where(eq(schema.followUpActions.id, updated.id));
            actionsFlaggedForReview += 1;
          }
        }
      }
    }

    const finishedAt = new Date();
    const syncNote =
      errors.length > 0
        ? `Partial sync across ${people.length} contact(s): ${errors.join("; ")}`
        : `Synced ${people.length} mapped contact(s) (${recordsRead} interaction(s) read, ${insertedCount} new, ${restrictedCount} privacy-restricted${actionsFlaggedForReview > 0 ? `, ${actionsFlaggedForReview} action(s) flagged for review` : ""}).`;

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
      newValue: {
        recordsRead,
        insertedCount,
        restrictedCount,
        actionsFlaggedForReview,
        errors,
      },
      outcome: errors.length === 0 ? "succeeded" : "failed",
    });

    return Response.json({
      ok: errors.length === 0,
      recordsRead,
      insertedCount,
      restrictedCount,
      actionsFlaggedForReview,
      syncNote,
      errors,
    });
  } catch (err) {
    return errorResponse(err);
  }
}
