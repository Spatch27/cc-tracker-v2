import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, isDatabaseConfigured, schema } from "@/db";
import { errorResponse } from "@/lib/api-auth";
import { requireFounderSession } from "@/lib/auth";
import { ensureAllowlistedFounders } from "@/lib/founders";
import {
  getActiveGoldCountsByOwner,
  loadGoldAccountWorkspace,
} from "@/lib/gold-lists/queries";
import {
  assertFounderGoldCap,
  GoldListRuleError,
} from "@/lib/gold-lists/rules";
import { recordAuditEvent } from "@/lib/governance/audit";

export const dynamic = "force-dynamic";

const patchGoldAccountSchema = z.object({
  ownerUserId: z.string().uuid().optional(),
  status: z.enum(["active", "archived"]).optional(),
  marketingTeamSize: z.number().int().min(0).max(100000).nullable().optional(),
  legacySetupNotes: z.string().max(2000).nullable().optional(),
  fitNotes: z.string().max(2000).nullable().optional(),
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
    const workspace = await loadGoldAccountWorkspace(db, id);
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
    const body = patchGoldAccountSchema.parse(await request.json());
    const db = getDb();

    const [existing] = await db
      .select()
      .from(schema.goldAccounts)
      .where(eq(schema.goldAccounts.id, id))
      .limit(1);

    if (!existing) {
      return Response.json({ error: "Gold account not found" }, { status: 404 });
    }

    const nextOwnerId = body.ownerUserId ?? existing.ownerUserId;
    const nextStatus = body.status ?? existing.status;

    if (nextStatus === "active") {
      const alreadyActiveUnderTarget =
        existing.status === "active" && existing.ownerUserId === nextOwnerId;
      if (!alreadyActiveUnderTarget) {
        const founders = await ensureAllowlistedFounders(db);
        const owner = founders.find((f) => f.id === nextOwnerId);
        if (!owner) {
          return Response.json(
            { error: "Selected owner is not an active founder" },
            { status: 400 },
          );
        }
        const counts = await getActiveGoldCountsByOwner(db);
        assertFounderGoldCap({
          ownerUserId: nextOwnerId,
          ownerName: owner.name,
          activeCountForOwner: counts[nextOwnerId] ?? 0,
          alreadyActiveUnderOwner: false,
        });
      }
    }

    const patch: Partial<typeof schema.goldAccounts.$inferInsert> = {
      updatedAt: new Date(),
    };
    if (body.ownerUserId !== undefined) patch.ownerUserId = body.ownerUserId;
    if (body.status !== undefined) patch.status = body.status;
    if (body.marketingTeamSize !== undefined) {
      patch.marketingTeamSize = body.marketingTeamSize;
    }
    if (body.legacySetupNotes !== undefined) {
      patch.legacySetupNotes = body.legacySetupNotes?.trim() || null;
    }
    if (body.fitNotes !== undefined) {
      patch.fitNotes = body.fitNotes?.trim() || null;
    }

    await db
      .update(schema.goldAccounts)
      .set(patch)
      .where(eq(schema.goldAccounts.id, id));

    await recordAuditEvent({
      actorType: "human",
      actorUserId: founder.userId,
      action: "gold_account_updated",
      entityType: "gold_account",
      entityId: id,
      previousValue: {
        ownerUserId: existing.ownerUserId,
        status: existing.status,
      },
      newValue: body,
      outcome: "succeeded",
    });

    const workspace = await loadGoldAccountWorkspace(db, id);
    return Response.json(workspace);
  } catch (err) {
    if (err instanceof GoldListRuleError) {
      return Response.json({ error: err.message }, { status: err.status });
    }
    return errorResponse(err);
  }
}
