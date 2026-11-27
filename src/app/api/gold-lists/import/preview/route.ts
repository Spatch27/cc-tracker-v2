import { z } from "zod";
import { getDb, isDatabaseConfigured, schema } from "@/db";
import { errorResponse } from "@/lib/api-auth";
import { requireFounderSession } from "@/lib/auth";
import { matchBreakfastRowToFolk } from "@/lib/breakfasts/import-parser";
import {
  createFolkClientFromEnv,
  listAllFolkCompanies,
  listAllFolkPeople,
  searchFolkCompanies,
  searchFolkPeople,
} from "@/lib/folk/client";
import { ensureAllowlistedFounders } from "@/lib/founders";
import {
  inferContactRoleCategory,
  isApprovedGoldTabName,
  matchGoldCompanyToFolk,
} from "@/lib/gold-lists/import-parser";
import { getActiveGoldCountsByOwner } from "@/lib/gold-lists/queries";

export const dynamic = "force-dynamic";

const rowSchema = z.object({
  rowNumber: z.number().int().positive(),
  tabName: z.string().min(1),
  defaultOwnerKey: z.enum(["tim", "ben"]),
  companyName: z.string().min(1),
  brandName: z.string().nullable().optional(),
  contactName: z.string().nullable().optional(),
  contactTitle: z.string().nullable().optional(),
  contactEmail: z.string().nullable().optional(),
  contactLinkedin: z.string().nullable().optional(),
  isContactGap: z.boolean(),
  staleDataWarning: z.string().nullable().optional(),
  changeSignals: z.string().nullable().optional(),
  relationshipNote: z.string().nullable().optional(),
  officeAddress: z.string().nullable().optional(),
  legacyScoreMetadata: z.record(z.unknown()).default({}),
});

const previewSchema = z.object({
  tabs: z
    .array(
      z.object({
        tabName: z.string().min(1),
        rows: z.array(rowSchema),
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

    for (const tab of body.tabs) {
      const verdict = isApprovedGoldTabName(tab.tabName);
      if (!verdict.approved) {
        return Response.json(
          { error: `Tab '${tab.tabName}' is excluded: ${verdict.reason}` },
          { status: 400 },
        );
      }
    }

    const db = getDb();
    const [
      founders,
      existingOwnerCounts,
      existingGoldRows,
      existingCompanyLinks,
      companiesPageResult,
      peoplePageResult,
    ] = await Promise.all([
      ensureAllowlistedFounders(db),
      getActiveGoldCountsByOwner(db),
      db.select().from(schema.goldAccounts),
      db.select().from(schema.folkCompaniesLink),
      listAllFolkCompanies(folkClient, 30),
      listAllFolkPeople(folkClient, 30),
    ]);

    const founderMap = new Map(founders.map((f) => [f.id, f]));
    const timFounder =
      founders.find(
        (f) =>
          f.email.toLowerCase().includes("tim") ||
          f.name.toLowerCase().includes("tim"),
      ) ?? founders[0];
    const benFounder =
      founders.find(
        (f) =>
          f.email.toLowerCase().includes("ben") ||
          f.name.toLowerCase().includes("ben"),
      ) ??
      founders[1] ??
      founders[0];

    const linkIdByFolkCompanyId = new Map(
      existingCompanyLinks.map((c) => [c.folkCompanyId, c.id]),
    );
    const goldByCompanyLinkId = new Map(
      existingGoldRows.map((g) => [g.folkCompanyLinkId, g]),
    );

    const companiesById = new Map(companiesPageResult.items.map((c) => [c.id, c]));
    const peopleById = new Map(peoplePageResult.items.map((p) => [p.id, p]));

    // Targeted server-side Folk searches for unmatched companies or contacts
    const unmatchedCompanies = new Set<string>();
    const unmatchedPeople = new Set<string>();

    for (const tab of body.tabs) {
      for (const row of tab.rows) {
        if (row.contactName && !row.isContactGap) {
          const pMatch = matchBreakfastRowToFolk(
            {
              rowNumber: row.rowNumber,
              rawName: row.contactName,
              companyHint: row.companyName,
              roleHint: row.contactTitle ?? null,
              notes: null,
            },
            peoplePageResult.items,
          );
          if (pMatch.status === "unmatched") {
            unmatchedPeople.add(row.contactName.trim());
          }
        }
        const cMatch = matchGoldCompanyToFolk(
          { companyName: row.companyName, brandName: row.brandName ?? null },
          companiesPageResult.items,
        );
        if (cMatch.status === "unmatched") {
          unmatchedCompanies.add(row.companyName.trim());
        }
      }
    }

    const BATCH = 5;
    const targetPeople = Array.from(unmatchedPeople).slice(0, 45);
    for (let i = 0; i < targetPeople.length; i += BATCH) {
      const batch = targetPeople.slice(i, i + BATCH);
      const resList = await Promise.all(
        batch.map((name) =>
          searchFolkPeople(folkClient, name, { skipPaginatedFallback: true }).catch(
            () => ({ items: [], strategy: "server_filter" as const }),
          ),
        ),
      );
      for (const res of resList) {
        for (const p of res.items) {
          if (!peopleById.has(p.id)) peopleById.set(p.id, p);
        }
      }
    }

    const targetCompanies = Array.from(unmatchedCompanies).slice(0, 45);
    for (let i = 0; i < targetCompanies.length; i += BATCH) {
      const batch = targetCompanies.slice(i, i + BATCH);
      const resList = await Promise.all(
        batch.map((name) =>
          searchFolkCompanies(folkClient, name, {
            skipPaginatedFallback: true,
          }).catch(() => ({ items: [], strategy: "server_filter" as const })),
        ),
      );
      for (const res of resList) {
        for (const c of res.items) {
          if (!companiesById.has(c.id)) companiesById.set(c.id, c);
        }
      }
    }

    const allCompanies = Array.from(companiesById.values());
    const allPeople = Array.from(peopleById.values());

    const seenFolkCompanyIdsAcrossTabs = new Set<string>();

    const previewTabs = body.tabs.map((tab) => {
      const verdict = isApprovedGoldTabName(tab.tabName);
      const defaultOwner =
        verdict.approved && verdict.defaultOwnerKey === "ben"
          ? benFounder
          : timFounder;

      const rows = tab.rows.map((row) => {
        const contactMatch =
          row.contactName && !row.isContactGap
            ? matchBreakfastRowToFolk(
                {
                  rowNumber: row.rowNumber,
                  rawName: row.contactName,
                  companyHint: row.companyName,
                  roleHint: row.contactTitle ?? null,
                  notes: null,
                },
                allPeople,
              )
            : null;

        const linkedCompanyRef =
          contactMatch?.bestMatch?.folkCompanyId
            ? {
                id: contactMatch.bestMatch.folkCompanyId,
                name: contactMatch.bestMatch.companyName,
              }
            : null;

        const companyMatch = matchGoldCompanyToFolk(
          { companyName: row.companyName, brandName: row.brandName ?? null },
          allCompanies,
          linkedCompanyRef,
        );

        const bestFolkCompanyId = companyMatch.bestMatch?.folkCompanyId ?? null;
        const existingLinkId = bestFolkCompanyId
          ? linkIdByFolkCompanyId.get(bestFolkCompanyId)
          : undefined;
        const existingGold = existingLinkId
          ? goldByCompanyLinkId.get(existingLinkId)
          : undefined;

        const duplicateInBatch = Boolean(
          bestFolkCompanyId && seenFolkCompanyIdsAcrossTabs.has(bestFolkCompanyId),
        );
        if (bestFolkCompanyId) {
          seenFolkCompanyIdsAcrossTabs.add(bestFolkCompanyId);
        }

        return {
          ...row,
          inferredRoleCategory: inferContactRoleCategory(row.contactTitle ?? null),
          companyMatch,
          contactMatch,
          alreadyOnGoldList: Boolean(existingGold),
          existingGoldOwnerName: existingGold
            ? founderMap.get(existingGold.ownerUserId)?.name ?? "Founder"
            : null,
          duplicateInBatch,
        };
      });

      return {
        tabName: tab.tabName,
        defaultOwnerUserId: defaultOwner?.id ?? "",
        rows,
      };
    });

    return Response.json({
      folkCompaniesTotal: allCompanies.length,
      folkPeopleTotal: allPeople.length,
      founders,
      existingOwnerCounts,
      tabs: previewTabs,
    });
  } catch (err) {
    return errorResponse(err);
  }
}
