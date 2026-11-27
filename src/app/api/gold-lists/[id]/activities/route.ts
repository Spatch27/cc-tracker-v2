import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { getDb, isDatabaseConfigured, schema } from "@/db";
import { flagActionsForInboundReply } from "@/lib/actions/follow-ups";
import { errorResponse } from "@/lib/api-auth";
import { requireFounderSession } from "@/lib/auth";
import { createFolkClientFromEnv } from "@/lib/folk/client";
import { recordAuditEvent } from "@/lib/governance/audit";

export const dynamic = "force-dynamic";

const createActivitySchema = z.object({
  folkPersonLinkId: z.string().uuid().nullable().optional(),
  channel: z.enum(["email", "linkedin", "postcard", "call", "meeting", "other"]),
  direction: z.enum(["outbound", "inbound", "note"]),
  ownerUserId: z.string().uuid().nullable().optional(),
  conversationKey: z.string().max(200).nullable().optional(),
  replyToActivityId: z.string().uuid().nullable().optional(),
  subject: z.string().max(300).nullable().optional(),
  bodyPreview: z.string().max(4000).nullable().optional(),
  occurredAt: z.string().nullable().optional(),
  executionStatus: z
    .enum(["logged", "sent", "failed", "outcome_unknown"])
    .default("logged"),
  alsoLogToFolk: z.boolean().default(false),
  idempotencyKey: z.string().max(200).nullable().optional(),
});

export async function POST(
  request: Request,
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

    const { id: goldAccountId } = await context.params;
    const body = createActivitySchema.parse(await request.json());
    const db = getDb();

    if (body.idempotencyKey) {
      const [existing] = await db
        .select()
        .from(schema.outreachActivities)
        .where(eq(schema.outreachActivities.idempotencyKey, body.idempotencyKey))
        .limit(1);
      if (existing) {
        return Response.json({ activity: existing, replayed: true });
      }
    }

    const occurredAt = body.occurredAt ? new Date(body.occurredAt) : new Date();
    let folkInteractionId: string | null = null;
    let sourceSystem: "folk_logged" | "tracker_manual" = "tracker_manual";
    let executionStatus = body.executionStatus;
    let folkSyncWarning: string | null = null;

    if (body.alsoLogToFolk && body.folkPersonLinkId) {
      const [person] = await db
        .select()
        .from(schema.folkPeopleLink)
        .where(eq(schema.folkPeopleLink.id, body.folkPersonLinkId))
        .limit(1);

      const folkClient = createFolkClientFromEnv();
      if (!folkClient) {
        folkSyncWarning =
          "FOLK_API_KEY is not configured; recorded in tracker only.";
      } else if (!person) {
        folkSyncWarning =
          "Linked Folk person not found; recorded in tracker only.";
      } else {
        try {
          const createdInt = await folkClient.createInteraction({
            entity: { id: person.folkPersonId, object: "person" },
            datetime: occurredAt.toISOString(),
            title:
              body.subject?.trim() ||
              `${body.channel} (${body.direction})`,
            content: body.bodyPreview?.trim() || `${body.channel} activity logged`,
            activityType: body.channel,
          });
          folkInteractionId = createdInt.id;
          sourceSystem = "folk_logged";
        } catch (err) {
          executionStatus = "outcome_unknown";
          folkSyncWarning =
            err instanceof Error
              ? `Folk interaction write uncertain (${err.message}); saved locally with outcome_unknown.`
              : "Folk interaction write failed; saved locally with outcome_unknown.";
        }
      }
    }

    const [created] = await db
      .insert(schema.outreachActivities)
      .values({
        goldAccountId,
        folkPersonLinkId: body.folkPersonLinkId ?? null,
        channel: body.channel,
        direction: body.direction,
        ownerUserId: body.ownerUserId ?? founder.userId,
        conversationKey: body.conversationKey?.trim() || null,
        replyToActivityId: body.replyToActivityId ?? null,
        subject: body.subject?.trim() || null,
        bodyPreview: body.bodyPreview?.trim() || null,
        sourceSystem,
        folkInteractionId,
        idempotencyKey: body.idempotencyKey ?? null,
        executionStatus,
        visibilityRestricted: false,
        occurredAt,
      })
      .returning();

    let flaggedActionIds: string[] = [];
    if (body.direction === "inbound") {
      const openActions = await db
        .select()
        .from(schema.followUpActions)
        .where(
          and(
            eq(schema.followUpActions.goldAccountId, goldAccountId),
            eq(schema.followUpActions.status, "open"),
          ),
        );

      const activityIds = openActions
        .map((a) => a.activityId)
        .filter(Boolean) as string[];
      const linkedActivities =
        activityIds.length > 0
          ? await db
              .select({
                id: schema.outreachActivities.id,
                conversationKey: schema.outreachActivities.conversationKey,
              })
              .from(schema.outreachActivities)
              .where(inArray(schema.outreachActivities.id, activityIds))
          : [];
      const convMap = new Map(
        linkedActivities.map((a) => [a.id, a.conversationKey]),
      );

      const snapshots = openActions.map((a) => ({
        ...a,
        conversationKey: a.activityId ? convMap.get(a.activityId) ?? null : null,
      }));

      const evaluated = flagActionsForInboundReply(snapshots, {
        id: created.id,
        folkPersonLinkId: created.folkPersonLinkId,
        goldAccountId,
        conversationKey: created.conversationKey,
      });

      for (const next of evaluated) {
        if (next.status === "needs_review") {
          await db
            .update(schema.followUpActions)
            .set({
              status: "needs_review",
              flaggedByReplyActivityId: created.id,
              updatedAt: new Date(),
            })
            .where(eq(schema.followUpActions.id, next.id));
          flaggedActionIds.push(next.id);
        }
      }
    }

    await recordAuditEvent({
      actorType: "human",
      actorUserId: founder.userId,
      action: "outreach_activity_logged",
      entityType: "outreach_activity",
      entityId: created.id,
      newValue: {
        goldAccountId,
        channel: created.channel,
        direction: created.direction,
        sourceSystem,
        executionStatus,
        flaggedActionIds,
      },
      outcome: "succeeded",
    });

    return Response.json(
      { activity: created, flaggedActionIds, folkSyncWarning },
      { status: 201 },
    );
  } catch (err) {
    return errorResponse(err);
  }
}
