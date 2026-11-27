import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, isDatabaseConfigured, schema } from "@/db";
import { errorResponse } from "@/lib/api-auth";
import { requireFounderSession } from "@/lib/auth";
import { loadFullBreakfastWorkspace } from "@/lib/breakfasts/queries";
import { formatLocaleLabel } from "@/lib/breakfasts/rules";
import { recordAuditEvent } from "@/lib/governance/audit";

export const dynamic = "force-dynamic";

const patchBreakfastSchema = z.object({
  title: z.string().min(1).max(160).optional(),
  locale: z.string().min(1).max(80).optional(),
  eventDate: z.string().optional(),
  totalCapacity: z.number().int().min(2).max(100).optional(),
  status: z
    .enum(["planning", "inviting", "confirmed", "completed", "cancelled"])
    .optional(),
  venueName: z.string().max(160).nullable().optional(),
  venueAddress: z.string().max(300).nullable().optional(),
  bookingStatus: z.string().max(80).nullable().optional(),
  bookingReference: z.string().max(160).nullable().optional(),
  venueContact: z.string().max(200).nullable().optional(),
  bookingDocsUrl: z.string().max(500).nullable().optional(),
  depositAmountPence: z.number().int().min(0).nullable().optional(),
  depositDueDate: z.string().nullable().optional(),
  depositInvoiceRef: z.string().max(160).nullable().optional(),
  depositPaid: z.boolean().optional(),
  balanceAmountPence: z.number().int().min(0).nullable().optional(),
  balanceDueDate: z.string().nullable().optional(),
  balanceInvoiceRef: z.string().max(160).nullable().optional(),
  balancePaid: z.boolean().optional(),
  logisticsOwnerUserId: z.string().uuid().nullable().optional(),
  prereadUrl: z.string().max(500).nullable().optional(),
  prereadNotes: z.string().max(4000).nullable().optional(),
  attendingHostUserIds: z.array(z.string().uuid()).optional(),
});

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    await requireFounderSession();
    if (!isDatabaseConfigured()) {
      return Response.json(
        { error: "Database is not configured" },
        { status: 503 },
      );
    }
    const { id } = await context.params;
    const db = getDb();
    const workspace = await loadFullBreakfastWorkspace(db, id);
    return Response.json(workspace);
  } catch (err) {
    return errorResponse(err);
  }
}

export async function PATCH(
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

    const { id } = await context.params;
    const body = patchBreakfastSchema.parse(await request.json());
    const db = getDb();

    const [existing] = await db
      .select()
      .from(schema.breakfastEvents)
      .where(eq(schema.breakfastEvents.id, id))
      .limit(1);

    if (!existing) {
      return Response.json({ error: "Breakfast event not found" }, { status: 404 });
    }

    const patch: Partial<typeof schema.breakfastEvents.$inferInsert> = {
      updatedAt: new Date(),
    };

    if (body.title !== undefined) patch.title = body.title.trim();
    if (body.locale !== undefined) patch.locale = formatLocaleLabel(body.locale);
    if (body.eventDate !== undefined) patch.eventDate = new Date(body.eventDate);
    if (body.totalCapacity !== undefined) patch.totalCapacity = body.totalCapacity;
    if (body.status !== undefined) patch.status = body.status;
    if (body.venueName !== undefined) patch.venueName = body.venueName?.trim() || null;
    if (body.venueAddress !== undefined) patch.venueAddress = body.venueAddress?.trim() || null;
    if (body.bookingStatus !== undefined) patch.bookingStatus = body.bookingStatus;
    if (body.bookingReference !== undefined) patch.bookingReference = body.bookingReference?.trim() || null;
    if (body.venueContact !== undefined) patch.venueContact = body.venueContact?.trim() || null;
    if (body.bookingDocsUrl !== undefined) patch.bookingDocsUrl = body.bookingDocsUrl?.trim() || null;
    if (body.depositAmountPence !== undefined) patch.depositAmountPence = body.depositAmountPence;
    if (body.depositDueDate !== undefined) {
      patch.depositDueDate = body.depositDueDate ? new Date(body.depositDueDate) : null;
    }
    if (body.depositInvoiceRef !== undefined) patch.depositInvoiceRef = body.depositInvoiceRef?.trim() || null;
    if (body.depositPaid !== undefined) patch.depositPaid = body.depositPaid;
    if (body.balanceAmountPence !== undefined) patch.balanceAmountPence = body.balanceAmountPence;
    if (body.balanceDueDate !== undefined) {
      patch.balanceDueDate = body.balanceDueDate ? new Date(body.balanceDueDate) : null;
    }
    if (body.balanceInvoiceRef !== undefined) patch.balanceInvoiceRef = body.balanceInvoiceRef?.trim() || null;
    if (body.balancePaid !== undefined) patch.balancePaid = body.balancePaid;
    if (body.logisticsOwnerUserId !== undefined) patch.logisticsOwnerUserId = body.logisticsOwnerUserId;
    if (body.prereadUrl !== undefined) patch.prereadUrl = body.prereadUrl?.trim() || null;
    if (body.prereadNotes !== undefined) patch.prereadNotes = body.prereadNotes?.trim() || null;

    await db
      .update(schema.breakfastEvents)
      .set(patch)
      .where(eq(schema.breakfastEvents.id, id));

    if (body.attendingHostUserIds !== undefined) {
      await db
        .delete(schema.breakfastHosts)
        .where(eq(schema.breakfastHosts.eventId, id));

      if (body.attendingHostUserIds.length > 0) {
        await db
          .insert(schema.breakfastHosts)
          .values(
            body.attendingHostUserIds.map((userId) => ({
              eventId: id,
              userId,
              attending: true,
            })),
          )
          .onConflictDoNothing();
      }
    }

    await recordAuditEvent({
      actorType: "human",
      actorUserId: founder.userId,
      action: "breakfast_event_updated",
      entityType: "breakfast_event",
      entityId: id,
      newValue: body,
      outcome: "succeeded",
    });

    const workspace = await loadFullBreakfastWorkspace(db, id);
    return Response.json(workspace);
  } catch (err) {
    return errorResponse(err);
  }
}
