import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, isDatabaseConfigured, schema } from "@/db";
import { errorResponse } from "@/lib/api-auth";
import { requireFounderSession } from "@/lib/auth";
import { ensureAllowlistedFounders } from "@/lib/founders";
import {
  getActiveGoldCountsByOwner,
  listGoldAccountsSummary,
} from "@/lib/gold-lists/queries";
import {
  assertFounderGoldCap,
  GoldListRuleError,
} from "@/lib/gold-lists/rules";
import { recordAuditEvent } from "@/lib/governance/audit";

export const dynamic = "force-dynamic";

const createGoldAccountSchema = z.object({
  folkCompanyId: z.string().min(1),
  companyName: z.string().min(1).max(200),
  domain: z.string().max(200).nullable().optional(),
  ownerUserId: z.string().uuid(),
  marketingTeamSize: z.number().int().min(0).max(100000).nullable().optional(),
  legacySetupNotes: z.string().max(2000).nullable().optional(),
  fitNotes: z.string().max(2000).nullable().optional(),
});

export async function GET() {
  try {
    await requireFounderSession();
    if (!isDatabaseConfigured()) {
      return Response.json({
        founders: [],
        ownerCounts: {},
        accounts: [],
        databaseConfigured: false,
      });
    }
    const db = getDb();
    const summary = await listGoldAccountsSummary(db);
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

    const body = createGoldAccountSchema.parse(await request.json());
    const db = getDb();

    const founders = await ensureAllowlistedFounders(db);
    const owner = founders.find((f) => f.id === body.ownerUserId);
    if (!owner) {
      return Response.json(
        { error: "Selected account owner is not an active founder" },
        { status: 400 },
      );
    }

    const counts = await getActiveGoldCountsByOwner(db);
    assertFounderGoldCap({
      ownerUserId: owner.id,
      ownerName: owner.name,
      activeCountForOwner: counts[owner.id] ?? 0,
      alreadyActiveUnderOwner: false,
    });

    const [companyLink] = await db
      .insert(schema.folkCompaniesLink)
      .values({
        folkCompanyId: body.folkCompanyId,
        name: body.companyName.trim(),
        domain: body.domain?.trim() || null,
        lastSyncedAt: new Date(),
        syncStatus: "linked",
      })
      .onConflictDoUpdate({
        target: schema.folkCompaniesLink.folkCompanyId,
        set: {
          name: body.companyName.trim(),
          ...(body.domain ? { domain: body.domain.trim() } : {}),
          lastSyncedAt: new Date(),
          updatedAt: new Date(),
        },
      })
      .returning();

    const [existingGold] = await db
      .select()
      .from(schema.goldAccounts)
      .where(eq(schema.goldAccounts.folkCompanyLinkId, companyLink.id))
      .limit(1);

    if (existingGold) {
      return Response.json(
        {
          error: `${companyLink.name} is already on a Gold list (status: ${existingGold.status}).`,
        },
        { status: 409 },
      );
    }

    const [created] = await db
      .insert(schema.goldAccounts)
      .values({
        folkCompanyLinkId: companyLink.id,
        ownerUserId: owner.id,
        status: "active",
        marketingTeamSize: body.marketingTeamSize ?? null,
        legacySetupNotes: body.legacySetupNotes?.trim() || null,
        fitNotes: body.fitNotes?.trim() || null,
      })
      .returning();

    await recordAuditEvent({
      actorType: "human",
      actorUserId: founder.userId,
      action: "gold_account_created",
      entityType: "gold_account",
      entityId: created.id,
      newValue: {
        companyName: companyLink.name,
        folkCompanyId: companyLink.folkCompanyId,
        ownerUserId: owner.id,
      },
      outcome: "succeeded",
    });

    return Response.json({ account: created }, { status: 201 });
  } catch (err) {
    if (err instanceof GoldListRuleError) {
      return Response.json({ error: err.message }, { status: err.status });
    }
    return errorResponse(err);
  }
}
