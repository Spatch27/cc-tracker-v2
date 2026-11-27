import { asc, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { getDb, isDatabaseConfigured, schema } from "@/db";
import { errorResponse } from "@/lib/api-auth";
import { requireFounderSession } from "@/lib/auth";
import { ensureAllowlistedFounders } from "@/lib/founders";
import { recordAuditEvent } from "@/lib/governance/audit";

export const dynamic = "force-dynamic";

const createActionSchema = z.object({
  goldAccountId: z.string().uuid().nullable().optional(),
  breakfastEventId: z.string().uuid().nullable().optional(),
  folkPersonLinkId: z.string().uuid().nullable().optional(),
  activityId: z.string().uuid().nullable().optional(),
  ownerUserId: z.string().uuid(),
  title: z.string().min(1).max(300),
  notes: z.string().max(2000).nullable().optional(),
  dueDate: z.string().min(1),
});

export async function GET() {
  try {
    await requireFounderSession();
    if (!isDatabaseConfigured()) {
      return Response.json({
        founders: [],
        actions: [],
        awaitingReplyActivities: [],
        databaseConfigured: false,
      });
    }

    const db = getDb();
    const founders = await ensureAllowlistedFounders(db);
    const [actions, accounts, companies, people, outboundActivities] =
      await Promise.all([
        db
          .select()
          .from(schema.followUpActions)
          .orderBy(asc(schema.followUpActions.dueDate)),
        db.select().from(schema.goldAccounts),
        db.select().from(schema.folkCompaniesLink),
        db.select().from(schema.folkPeopleLink),
        db
          .select()
          .from(schema.outreachActivities)
          .where(eq(schema.outreachActivities.direction, "outbound"))
          .orderBy(desc(schema.outreachActivities.occurredAt))
          .limit(50),
      ]);

    const founderMap = new Map(founders.map((f) => [f.id, f]));
    const companyMap = new Map(companies.map((c) => [c.id, c]));
    const accountMap = new Map(accounts.map((a) => [a.id, a]));
    const personMap = new Map(people.map((p) => [p.id, p]));

    const inboundRows = await db
      .select({
        goldAccountId: schema.outreachActivities.goldAccountId,
        folkPersonLinkId: schema.outreachActivities.folkPersonLinkId,
        occurredAt: schema.outreachActivities.occurredAt,
      })
      .from(schema.outreachActivities)
      .where(eq(schema.outreachActivities.direction, "inbound"));

    const awaitingReplyActivities = outboundActivities.filter((out) => {
      return !inboundRows.some(
        (inb) =>
          inb.occurredAt > out.occurredAt &&
          ((out.folkPersonLinkId &&
            inb.folkPersonLinkId === out.folkPersonLinkId) ||
            (out.goldAccountId && inb.goldAccountId === out.goldAccountId)),
      );
    });

    return Response.json({
      founders,
      actions: actions.map((a) => {
        const acc = a.goldAccountId ? accountMap.get(a.goldAccountId) : undefined;
        const comp = acc ? companyMap.get(acc.folkCompanyLinkId) : undefined;
        const person = a.folkPersonLinkId
          ? personMap.get(a.folkPersonLinkId)
          : undefined;
        return {
          ...a,
          ownerName: founderMap.get(a.ownerUserId)?.name ?? "Unknown",
          companyName: comp?.name ?? null,
          personName: person?.fullName ?? null,
        };
      }),
      awaitingReplyActivities: awaitingReplyActivities.map((act) => {
        const acc = act.goldAccountId
          ? accountMap.get(act.goldAccountId)
          : undefined;
        const comp = acc ? companyMap.get(acc.folkCompanyLinkId) : undefined;
        const person = act.folkPersonLinkId
          ? personMap.get(act.folkPersonLinkId)
          : undefined;
        return {
          ...act,
          ownerName: act.ownerUserId
            ? founderMap.get(act.ownerUserId)?.name ?? null
            : null,
          companyName: comp?.name ?? null,
          personName: person?.fullName ?? null,
        };
      }),
    });
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

    const body = createActionSchema.parse(await request.json());
    const db = getDb();

    const [created] = await db
      .insert(schema.followUpActions)
      .values({
        goldAccountId: body.goldAccountId ?? null,
        breakfastEventId: body.breakfastEventId ?? null,
        folkPersonLinkId: body.folkPersonLinkId ?? null,
        activityId: body.activityId ?? null,
        ownerUserId: body.ownerUserId,
        title: body.title.trim(),
        notes: body.notes?.trim() || null,
        dueDate: new Date(body.dueDate),
        status: "open",
        snoozeHistoryJson: [],
      })
      .returning();

    await recordAuditEvent({
      actorType: "human",
      actorUserId: founder.userId,
      action: "follow_up_action_created",
      entityType: "follow_up_action",
      entityId: created.id,
      newValue: body,
      outcome: "succeeded",
    });

    return Response.json({ action: created }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
