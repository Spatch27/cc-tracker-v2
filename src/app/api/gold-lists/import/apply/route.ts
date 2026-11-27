import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, isDatabaseConfigured, schema } from "@/db";
import { errorResponse } from "@/lib/api-auth";
import { requireFounderSession } from "@/lib/auth";
import { ensureAllowlistedFounders } from "@/lib/founders";
import {
  inferSignalType,
  isApprovedGoldTabName,
  normalizeCompanyName,
} from "@/lib/gold-lists/import-parser";
import { getActiveGoldCountsByOwner } from "@/lib/gold-lists/queries";
import {
  assertFounderGoldCap,
  GoldListRuleError,
} from "@/lib/gold-lists/rules";
import { recordAuditEvent } from "@/lib/governance/audit";
import { canonicalStringify, sha256Hex } from "@/lib/governance/hashing";
import {
  createDrizzleProposalStore,
  ProposalGovernanceService,
} from "@/lib/governance/proposals";

export const dynamic = "force-dynamic";

const roleCategorySchema = z.enum([
  "cmo",
  "vp_marketing",
  "marketing_director",
  "marketing_ops",
  "other",
]);

const contactImportSchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("folk"),
    folkPersonId: z.string().min(1),
    fullName: z.string().min(1),
    email: z.string().nullable().optional(),
    jobTitle: z.string().nullable().optional(),
    linkedinUrl: z.string().nullable().optional(),
    roleCategory: roleCategorySchema.default("cmo"),
    notes: z.string().nullable().optional(),
  }),
  z.object({
    mode: z.literal("gap"),
    roleCategory: roleCategorySchema.default("cmo"),
    notes: z.string().nullable().optional(),
  }),
]);

const applySchema = z.object({
  accounts: z
    .array(
      z.object({
        tabName: z.string().min(1),
        ownerUserId: z.string().uuid(),
        folkCompanyId: z.string().min(1),
        companyName: z.string().min(1),
        domain: z.string().nullable().optional(),
        legacyScoreMetadata: z.record(z.unknown()).optional(),
        fitNotes: z.string().nullable().optional(),
        officeAddress: z.string().nullable().optional(),
        contact: contactImportSchema.nullable().optional(),
        changeSignalText: z.string().nullable().optional(),
      }),
    )
    .default([]),
  flagReviews: z
    .array(
      z.object({
        kind: z.enum(["missing_company", "stale_data_warning"]),
        tabName: z.string().min(1),
        companyName: z.string().min(1),
        folkCompanyId: z.string().nullable().optional(),
        folkPersonId: z.string().nullable().optional(),
        summary: z.string().min(1),
        details: z.string().min(1),
      }),
    )
    .default([]),
});

export async function POST(request: Request) {
  try {
    const founder = await requireFounderSession();
    if (!isDatabaseConfigured()) {
      return Response.json(
        { error: "Database is not configured" },
        { status: 503 },
      );
    }

    const body = applySchema.parse(await request.json());

    for (const acc of body.accounts) {
      const verdict = isApprovedGoldTabName(acc.tabName);
      if (!verdict.approved) {
        return Response.json(
          { error: `Tab '${acc.tabName}' is excluded: ${verdict.reason}` },
          { status: 400 },
        );
      }
    }

    const db = getDb();
    const [founders, countsBefore, existingGoldRows, existingCompanyLinks] =
      await Promise.all([
        ensureAllowlistedFounders(db),
        getActiveGoldCountsByOwner(db),
        db.select().from(schema.goldAccounts),
        db.select().from(schema.folkCompaniesLink),
      ]);

    const founderMap = new Map(founders.map((f) => [f.id, f]));
    const existingGoldByCompanyLinkId = new Set(
      existingGoldRows.map((g) => g.folkCompanyLinkId),
    );
    const linkIdByFolkCompanyId = new Map(
      existingCompanyLinks.map((c) => [c.folkCompanyId, c.id]),
    );

    // Pre-flight 50-account-per-founder cap check across non-existing accounts
    const projectedAddCounts: Record<string, number> = {};
    const seenIncomingFolkIds = new Set<string>();
    for (const acc of body.accounts) {
      if (!founderMap.has(acc.ownerUserId)) {
        return Response.json(
          { error: `Invalid founder ownerUserId: ${acc.ownerUserId}` },
          { status: 400 },
        );
      }
      const existingLinkId = linkIdByFolkCompanyId.get(acc.folkCompanyId);
      if (existingLinkId && existingGoldByCompanyLinkId.has(existingLinkId)) {
        continue;
      }
      if (seenIncomingFolkIds.has(acc.folkCompanyId)) continue;
      seenIncomingFolkIds.add(acc.folkCompanyId);
      projectedAddCounts[acc.ownerUserId] =
        (projectedAddCounts[acc.ownerUserId] ?? 0) + 1;
    }

    for (const [ownerId, addCount] of Object.entries(projectedAddCounts)) {
      const owner = founderMap.get(ownerId)!;
      const baseCount = countsBefore[ownerId] ?? 0;
      for (let i = 0; i < addCount; i += 1) {
        assertFounderGoldCap({
          ownerUserId: ownerId,
          ownerName: owner.name,
          activeCountForOwner: baseCount + i,
          alreadyActiveUnderOwner: false,
        });
      }
    }

    let importedAccountsCount = 0;
    let mappedContactsCount = 0;
    let contactGapsCount = 0;
    let signalsSeededCount = 0;
    let skippedAlreadyOnGoldList = 0;

    for (const acc of body.accounts) {
      const [companyLink] = await db
        .insert(schema.folkCompaniesLink)
        .values({
          folkCompanyId: acc.folkCompanyId,
          name: acc.companyName.trim(),
          domain: acc.domain?.trim() || null,
          lastSyncedAt: new Date(),
          syncStatus: "linked",
        })
        .onConflictDoUpdate({
          target: schema.folkCompaniesLink.folkCompanyId,
          set: {
            name: acc.companyName.trim(),
            ...(acc.domain ? { domain: acc.domain.trim() } : {}),
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
        skippedAlreadyOnGoldList += 1;
        continue;
      }

      const fitParts = [
        acc.fitNotes?.trim() || null,
        acc.officeAddress?.trim()
          ? `Postal office address: ${acc.officeAddress.trim()}`
          : null,
      ].filter(Boolean);

      const [createdAccount] = await db
        .insert(schema.goldAccounts)
        .values({
          folkCompanyLinkId: companyLink.id,
          ownerUserId: acc.ownerUserId,
          status: "active",
          fitNotes: fitParts.length > 0 ? fitParts.join(" | ") : null,
          legacyScoreMetadataJson: acc.legacyScoreMetadata ?? null,
        })
        .returning();

      importedAccountsCount += 1;

      if (acc.contact?.mode === "folk") {
        const [personRow] = await db
          .insert(schema.folkPeopleLink)
          .values({
            folkPersonId: acc.contact.folkPersonId,
            folkCompanyLinkId: companyLink.id,
            fullName: acc.contact.fullName,
            email: acc.contact.email ?? null,
            jobTitle: acc.contact.jobTitle ?? null,
            linkedinUrl: acc.contact.linkedinUrl ?? null,
            lastSyncedAt: new Date(),
            syncStatus: "linked",
          })
          .onConflictDoUpdate({
            target: schema.folkPeopleLink.folkPersonId,
            set: {
              folkCompanyLinkId: companyLink.id,
              fullName: acc.contact.fullName,
              email: acc.contact.email ?? null,
              jobTitle: acc.contact.jobTitle ?? null,
              linkedinUrl: acc.contact.linkedinUrl ?? null,
              lastSyncedAt: new Date(),
              updatedAt: new Date(),
            },
          })
          .returning();

        await db.insert(schema.goldAccountContacts).values({
          goldAccountId: createdAccount.id,
          folkPersonLinkId: personRow.id,
          roleCategory: acc.contact.roleCategory,
          isPrimaryDecisionMaker: true,
          coverageStatus: "mapped",
          notes: acc.contact.notes?.trim() || null,
        });
        mappedContactsCount += 1;
      } else if (acc.contact?.mode === "gap") {
        await db.insert(schema.goldAccountContacts).values({
          goldAccountId: createdAccount.id,
          folkPersonLinkId: null,
          roleCategory: acc.contact.roleCategory,
          isPrimaryDecisionMaker: true,
          coverageStatus: "gap",
          notes: acc.contact.notes?.trim() || "No named contact yet (TBC)",
        });
        contactGapsCount += 1;
      }

      if (acc.changeSignalText && acc.changeSignalText.trim()) {
        await db.insert(schema.buyingSignals).values({
          goldAccountId: createdAccount.id,
          signalType: inferSignalType(acc.changeSignalText),
          title: acc.changeSignalText.trim().slice(0, 200),
          details: acc.changeSignalText.trim(),
          factType: "interpretation",
          sourceNote: `Imported from ${acc.tabName} spreadsheet`,
          recordedByUserId: founder.userId,
        });
        signalsSeededCount += 1;
      }
    }

    let queuedForReviewCount = 0;
    if (body.flagReviews.length > 0) {
      const store = createDrizzleProposalStore();
      const proposalService = new ProposalGovernanceService(store);

      for (const flag of body.flagReviews) {
        const keySeed = {
          kind: flag.kind,
          company: normalizeCompanyName(flag.companyName),
          folkCompanyId: flag.folkCompanyId ?? null,
          folkPersonId: flag.folkPersonId ?? null,
        };
        const idempotencyKey = `gold_import:${sha256Hex(canonicalStringify(keySeed))}`;
        const existing = await store.findByIdempotencyKey(idempotencyKey);
        if (existing) continue;

        const targetSystem = flag.folkPersonId || flag.folkCompanyId ? "folk" : "tracker";
        const entityType = flag.folkPersonId ? "person" : "company";
        const entityId =
          flag.folkPersonId ??
          flag.folkCompanyId ??
          `new:gold_import:${sha256Hex(canonicalStringify(keySeed)).slice(0, 12)}`;

        await proposalService.createProposal({
          targetSystem,
          entityType,
          entityId,
          folkRecordId: flag.folkPersonId ?? flag.folkCompanyId ?? null,
          proposedByUserId: founder.userId,
          summary: flag.summary,
          proposedChangesJson: {
            sourceTab: flag.tabName,
            companyName: flag.companyName,
            warningOrGap: flag.details,
          },
          baseSnapshotJson: {},
          sourceNote: `Gold-list import (${flag.tabName}): ${flag.details}`,
          factType: "verified",
          evidenceDate: new Date(),
          idempotencyKey,
        });
        queuedForReviewCount += 1;
      }
    }

    const ownerCountsAfter = await getActiveGoldCountsByOwner(db);

    await recordAuditEvent({
      actorType: "human",
      actorUserId: founder.userId,
      action: "gold_list_import_applied",
      entityType: "gold_account",
      entityId: body.accounts[0]?.folkCompanyId ?? null,
      newValue: {
        importedAccountsCount,
        mappedContactsCount,
        contactGapsCount,
        signalsSeededCount,
        skippedAlreadyOnGoldList,
        queuedForReviewCount,
      },
      outcome: "succeeded",
    });

    return Response.json({
      importedAccountsCount,
      mappedContactsCount,
      contactGapsCount,
      signalsSeededCount,
      skippedAlreadyOnGoldList,
      queuedForReviewCount,
      ownerCountsAfter,
    });
  } catch (err) {
    if (err instanceof GoldListRuleError) {
      return Response.json({ error: err.message }, { status: err.status });
    }
    return errorResponse(err);
  }
}
