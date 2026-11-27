import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, isDatabaseConfigured, schema } from "@/db";
import { errorResponse } from "@/lib/api-auth";
import { requireFounderSession } from "@/lib/auth";
import { loadFullBreakfastWorkspace } from "@/lib/breakfasts/queries";
import { formatLocaleLabel } from "@/lib/breakfasts/rules";
import { recordAuditEvent } from "@/lib/governance/audit";
import { computeMessageContentHash } from "@/lib/governance/hashing";

export const dynamic = "force-dynamic";

const postEventFollowUpSchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("queue_all_attendee_drafts"),
    senderUserId: z.string().uuid().optional(),
  }),
  z.object({
    mode: z.literal("mark_status"),
    folkPersonLinkId: z.string().uuid(),
    status: z.enum(["sent", "replied"]),
    note: z.string().max(500).nullable().optional(),
  }),
]);

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

    const { id: eventId } = await context.params;
    const body = postEventFollowUpSchema.parse(await request.json());
    const db = getDb();

    if (body.mode === "mark_status") {
      const subject =
        body.status === "replied"
          ? "Post-event follow-up reply received"
          : "Post-event thank-you & referral email sent";

      const [activity] = await db
        .insert(schema.outreachActivities)
        .values({
          breakfastEventId: eventId,
          folkPersonLinkId: body.folkPersonLinkId,
          channel: "email",
          direction: body.status === "replied" ? "inbound" : "outbound",
          ownerUserId: founder.userId,
          subject,
          bodyPreview: body.note?.trim() || null,
          sourceSystem: "tracker_manual",
          executionStatus: body.status === "sent" ? "sent" : "logged",
          occurredAt: new Date(),
        })
        .returning();

      await recordAuditEvent({
        actorType: "human",
        actorUserId: founder.userId,
        action: `breakfast_post_event_${body.status}`,
        entityType: "breakfast_event",
        entityId: eventId,
        newValue: {
          folkPersonLinkId: body.folkPersonLinkId,
          status: body.status,
          activityId: activity.id,
        },
        outcome: "succeeded",
      });

      return Response.json({ ok: true, activity });
    }

    // mode === "queue_all_attendee_drafts"
    const ws = await loadFullBreakfastWorkspace(db, eventId);
    const senderUserId = body.senderUserId ?? founder.userId;
    if (!senderUserId) {
      return Response.json(
        { error: "No sender founder account resolved" },
        { status: 400 },
      );
    }

    const attendees = ws.invitations.filter(
      (i) => i.attendanceOutcome === "attended",
    );

    const existingMessages = await db
      .select({
        folkPersonLinkId: schema.messageApprovals.folkPersonLinkId,
        status: schema.messageApprovals.status,
      })
      .from(schema.messageApprovals)
      .where(eq(schema.messageApprovals.breakfastEventId, eventId));

    const existingOutbound = await db
      .select({
        folkPersonLinkId: schema.outreachActivities.folkPersonLinkId,
        direction: schema.outreachActivities.direction,
      })
      .from(schema.outreachActivities)
      .where(eq(schema.outreachActivities.breakfastEventId, eventId));

    const alreadyHandledIds = new Set<string>();
    for (const m of existingMessages) {
      if (m.folkPersonLinkId && m.status !== "rejected") {
        alreadyHandledIds.add(m.folkPersonLinkId);
      }
    }
    for (const a of existingOutbound) {
      if (a.folkPersonLinkId && a.direction === "outbound") {
        alreadyHandledIds.add(a.folkPersonLinkId);
      }
    }

    let createdCount = 0;
    let skippedCount = 0;
    const skippedReasons: string[] = [];
    const localeLabel = formatLocaleLabel(ws.event.locale);

    for (const inv of attendees) {
      const name = inv.person?.fullName ?? "Attendee";
      if (!inv.person) {
        skippedCount += 1;
        skippedReasons.push(`${name}: missing contact record`);
        continue;
      }
      if (inv.person.contactSuppressed) {
        skippedCount += 1;
        skippedReasons.push(`${name}: Do Not Contact`);
        continue;
      }
      if (!inv.person.email?.trim()) {
        skippedCount += 1;
        skippedReasons.push(`${name}: no email in Folk`);
        continue;
      }
      if (alreadyHandledIds.has(inv.folkPersonLinkId)) {
        skippedCount += 1;
        skippedReasons.push(`${name}: already drafted or followed up`);
        continue;
      }

      const firstName = name.split(/\s+/)[0] || name;
      const subject = `Great to see you at our ${localeLabel} CMO Breakfast`;
      const messageBody = [
        `Hi ${firstName},`,
        "",
        `Thank you again for joining our ${ws.event.title} in ${localeLabel} — really appreciated your perspective around the table.`,
        "",
        `Quick ask: we keep these breakfasts curated around peer CMO & marketing leaders. Anyone you'd recommend we invite to our next ${localeLabel} session, and any candid feedback on format or topics?`,
        "",
        `Best,`,
      ].join("\n");

      const contentHash = computeMessageContentHash({
        senderUserId,
        recipientName: inv.person.fullName,
        recipientAddress: inv.person.email.trim(),
        channel: "email",
        subject,
        body: messageBody,
      });

      await db.insert(schema.messageApprovals).values({
        breakfastEventId: eventId,
        folkPersonLinkId: inv.folkPersonLinkId,
        senderUserId,
        recipientName: inv.person.fullName,
        recipientAddress: inv.person.email.trim(),
        channel: "email",
        subject,
        body: messageBody,
        contentHash,
        proposedByUserId: founder.userId,
        status: "awaiting_approval",
      });

      createdCount += 1;
    }

    await recordAuditEvent({
      actorType: "human",
      actorUserId: founder.userId,
      action: "breakfast_post_event_drafts_queued",
      entityType: "breakfast_event",
      entityId: eventId,
      newValue: { createdCount, skippedCount, attendeeCount: attendees.length },
      outcome: "succeeded",
    });

    return Response.json({
      ok: true,
      attendeeCount: attendees.length,
      createdCount,
      skippedCount,
      skippedReasons,
    });
  } catch (err) {
    return errorResponse(err);
  }
}
