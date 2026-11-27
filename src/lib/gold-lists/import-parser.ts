import {
  extractNameVariants,
  levenshteinDistance,
  normalizePersonName,
} from "@/lib/breakfasts/import-parser";
import type { FolkCompany } from "@/lib/folk/types";

function extractCompanyPrimaryDomain(urls: string[]): string | null {
  for (const raw of urls) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    try {
      const parsed = new URL(trimmed.includes("://") ? trimmed : `https://${trimmed}`);
      const host = parsed.hostname.replace(/^www\./i, "").toLowerCase();
      if (host && !host.includes("linkedin.com")) {
        return host;
      }
    } catch {
      // Ignore malformed URL entries.
    }
  }
  return null;
}

export interface ParsedGoldAccountRow {
  rowNumber: number;
  tabName: string;
  defaultOwnerKey: "tim" | "ben";
  companyName: string;
  brandName: string | null;
  contactName: string | null;
  contactTitle: string | null;
  contactEmail: string | null;
  contactLinkedin: string | null;
  isContactGap: boolean;
  staleDataWarning: string | null;
  changeSignals: string | null;
  relationshipNote: string | null;
  officeAddress: string | null;
  legacyScoreMetadata: Record<string, unknown>;
}

export interface FolkCompanyCandidate {
  folkCompanyId: string;
  name: string;
  domain: string | null;
  industries: string[];
  scoreReason: string;
}

export interface GoldCompanyMatchResult {
  status: "matched" | "fuzzy" | "ambiguous" | "unmatched";
  bestMatch: FolkCompanyCandidate | null;
  candidates: FolkCompanyCandidate[];
  matchReason: string;
}

export function isApprovedGoldTabName(
  sheetName: string,
):
  | { approved: true; defaultOwnerKey: "tim" | "ben" }
  | { approved: false; reason: string } {
  const norm = sheetName.trim().toLowerCase();
  if (norm === "tim abm") {
    return { approved: true, defaultOwnerKey: "tim" };
  }
  if (norm === "ben abm") {
    return { approved: true, defaultOwnerKey: "ben" };
  }
  if (norm.includes("warm")) {
    return { approved: false, reason: "Warm List is strictly excluded from v1." };
  }
  if (norm.includes("cold")) {
    return { approved: false, reason: "Cold list is strictly excluded from v1." };
  }
  if (norm.includes("top 100")) {
    return {
      approved: false,
      reason: "Historical Top 100 tabs are excluded from active Gold-list import.",
    };
  }
  if (norm.includes("breakfast")) {
    return {
      approved: false,
      reason: "Breakfast tabs use the CMO Breakfasts importer instead.",
    };
  }
  return {
    approved: false,
    reason: `Only 'Tim ABM' and 'Ben ABM' are approved for Gold-list migration.`,
  };
}

function normalizeHeaderKey(raw: unknown): string {
  return String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function getCol(
  row: unknown[],
  headerMap: Map<string, number>,
  candidates: string[],
): string {
  for (const key of candidates) {
    const idx = headerMap.get(key);
    if (idx !== undefined && idx >= 0 && idx < row.length) {
      const val = row[idx];
      const str = val === null || val === undefined ? "" : String(val).trim();
      if (str) return str;
    }
  }
  return "";
}

function isGapContactName(rawName: string): boolean {
  const trimmed = rawName.trim().toLowerCase();
  return (
    !trimmed ||
    trimmed === "tbc" ||
    trimmed === "tbd" ||
    trimmed === "none" ||
    trimmed === "n/a" ||
    trimmed === "-" ||
    trimmed.startsWith("tbc ")
  );
}

/**
 * Parses rows from an approved `Tim ABM` or `Ben ABM` worksheet tab.
 * Returns structured account rows preserving read-only legacy score metadata,
 * stale-email warnings, contact gaps (`TBC`), and change signals.
 */
export function parseGoldListTab(
  tabName: string,
  rows: unknown[][],
): ParsedGoldAccountRow[] {
  const verdict = isApprovedGoldTabName(tabName);
  if (!verdict.approved) {
    throw new Error(`Tab '${tabName}' is not an approved Gold list: ${verdict.reason}`);
  }
  if (rows.length < 2) return [];

  const headerRow = rows[0] ?? [];
  const headerMap = new Map<string, number>();
  for (let c = 0; c < headerRow.length; c += 1) {
    const key = normalizeHeaderKey(headerRow[c]);
    if (key && !headerMap.has(key)) {
      headerMap.set(key, c);
    }
  }

  const parsed: ParsedGoldAccountRow[] = [];

  for (let r = 1; r < rows.length; r += 1) {
    const row = rows[r] ?? [];
    const companyRaw = getCol(row, headerMap, ["company", "brand"]);
    const brandRaw = getCol(row, headerMap, ["brand"]);
    const companyName = companyRaw || brandRaw;
    if (!companyName) continue;

    const rawContactName = getCol(row, headerMap, ["name"]);
    const isContactGap = isGapContactName(rawContactName);
    const contactName = isContactGap ? null : rawContactName;
    const contactTitle = getCol(row, headerMap, ["current title", "title", "role"]) || null;
    const contactEmail = getCol(row, headerMap, ["email"]) || null;
    const contactLinkedin = getCol(row, headerMap, ["linkedin"]) || null;

    const emailCheck = getCol(row, headerMap, ["email check"]);
    const checksAndChoices = getCol(row, headerMap, ["checks and choices"]);
    const staleParts = [emailCheck, checksAndChoices].filter(Boolean);
    const staleDataWarning = staleParts.length > 0 ? staleParts.join(" | ") : null;

    const changeSignals = getCol(row, headerMap, ["change signals"]) || null;
    const rel = getCol(row, headerMap, ["relationship so far"]);
    const nextStep = getCol(row, headerMap, ["tim's next step", "next step"]);
    const relParts = [rel, nextStep].filter(Boolean);
    const relationshipNote = relParts.length > 0 ? relParts.join(" — ") : null;

    const officeAddress = getCol(row, headerMap, ["office address (for post)"]) || null;

    const rank = getCol(row, headerMap, ["tim's rank", "ben abm rank", "rank"]) || null;
    const sizeScore = getCol(row, headerMap, ["size (0-3)"]) || null;
    const roleScore = getCol(row, headerMap, ["role (0-3)"]) || null;
    const environmentScore = getCol(row, headerMap, ["environment (0-3)"]) || null;
    const yesMaybe = getCol(row, headerMap, ["y / m"]) || null;
    const totalScore = getCol(row, headerMap, ["score"]) || null;
    const folkPersona = getCol(row, headerMap, ["folk persona"]) || null;
    const timeInRole = getCol(row, headerMap, ["time in role"]) || null;
    const sourceList = getCol(row, headerMap, ["where they came from"]) || null;
    const top100Notes =
      getCol(row, headerMap, ["mw / campaign top 100", "top 100 / list notes"]) ||
      null;
    const inFolkFlag = getCol(row, headerMap, ["in folk?"]) || null;
    const folkOwner = getCol(row, headerMap, ["folk owner"]) || null;

    const legacyScoreMetadata: Record<string, unknown> = {
      sourceTab: tabName,
      ...(rank ? { rank } : {}),
      ...(sizeScore ? { sizeScore } : {}),
      ...(roleScore ? { roleScore } : {}),
      ...(environmentScore ? { environmentScore } : {}),
      ...(yesMaybe ? { yesMaybe } : {}),
      ...(totalScore ? { totalScore } : {}),
      ...(folkPersona ? { folkPersona } : {}),
      ...(timeInRole ? { timeInRole } : {}),
      ...(sourceList ? { sourceList } : {}),
      ...(top100Notes ? { top100Notes } : {}),
      ...(inFolkFlag ? { inFolkFlag } : {}),
      ...(folkOwner ? { folkOwner } : {}),
    };

    parsed.push({
      rowNumber: r + 1,
      tabName,
      defaultOwnerKey: verdict.defaultOwnerKey,
      companyName,
      brandName: brandRaw && brandRaw !== companyName ? brandRaw : null,
      contactName,
      contactTitle,
      contactEmail,
      contactLinkedin,
      isContactGap,
      staleDataWarning,
      changeSignals,
      relationshipNote,
      officeAddress,
      legacyScoreMetadata,
    });
  }

  return parsed;
}

export function inferContactRoleCategory(
  jobTitle: string | null,
): "cmo" | "vp_marketing" | "marketing_director" | "marketing_ops" | "other" {
  const lower = (jobTitle ?? "").toLowerCase();
  if (!lower) return "other";
  if (
    lower.includes("cmo") ||
    lower.includes("chief marketing") ||
    lower.includes("chief customer") ||
    lower.includes("chief brand")
  ) {
    return "cmo";
  }
  if (lower.includes("marketing op") || lower.includes("martech")) {
    return "marketing_ops";
  }
  if (lower.includes("vp") || lower.includes("vice president")) {
    return "vp_marketing";
  }
  if (lower.includes("director")) {
    return "marketing_director";
  }
  return "other";
}

export function inferSignalType(
  signalText: string,
):
  | "leadership_change"
  | "funding"
  | "consolidation"
  | "integration"
  | "acquisition"
  | "other" {
  const lower = signalText.toLowerCase();
  if (
    lower.includes("acqui") ||
    lower.includes("takeover") ||
    lower.includes("ownership") ||
    lower.includes("merger")
  ) {
    return "acquisition";
  }
  if (lower.includes("funding") || lower.includes("raise") || lower.includes("pe-backed")) {
    return "funding";
  }
  if (lower.includes("integrat")) {
    return "integration";
  }
  if (lower.includes("restructur") || lower.includes("consolidat") || lower.includes("unify")) {
    return "consolidation";
  }
  if (
    lower.includes("appoint") ||
    lower.includes("promot") ||
    lower.includes("joined") ||
    lower.includes("left") ||
    lower.includes("new")
  ) {
    return "leadership_change";
  }
  return "other";
}

const COMPANY_SUFFIXES = new Set([
  "ltd",
  "limited",
  "plc",
  "group",
  "uk",
  "holdings",
  "holding",
  "inc",
  "llc",
  "the",
  "co",
  "company",
]);

export function normalizeCompanyName(name: string): string {
  const withoutParens = name.replace(/\([^)]*\)/g, " ");
  const normalized = normalizePersonName(withoutParens);
  const tokens = normalized
    .split(" ")
    .filter((t) => t && !COMPANY_SUFFIXES.has(t));
  return tokens.join(" ").trim() || normalized;
}

function toCompanyCandidate(
  company: FolkCompany,
  scoreReason: string,
): FolkCompanyCandidate {
  return {
    folkCompanyId: company.id,
    name: company.name,
    domain: extractCompanyPrimaryDomain(company.urls ?? []),
    industries: company.industries ?? [],
    scoreReason,
  };
}

export function matchGoldCompanyToFolk(
  row: Pick<ParsedGoldAccountRow, "companyName" | "brandName">,
  folkCompanies: FolkCompany[],
  linkedContactCompanyRef?: { id: string; name?: string | null } | null,
): GoldCompanyMatchResult {
  const targets = Array.from(
    new Set(
      [
        normalizePersonName(row.companyName),
        normalizeCompanyName(row.companyName),
        ...(row.brandName
          ? [normalizePersonName(row.brandName), normalizeCompanyName(row.brandName)]
          : []),
      ].filter(Boolean),
    ),
  );
  const targetSet = new Set(targets);

  const exactCandidates: FolkCompanyCandidate[] = [];
  for (const company of folkCompanies) {
    const rawNorm = normalizePersonName(company.name);
    const strippedNorm = normalizeCompanyName(company.name);
    if (targetSet.has(rawNorm) || (strippedNorm && targetSet.has(strippedNorm))) {
      exactCandidates.push(
        toCompanyCandidate(
          company,
          rawNorm === targets[0]
            ? "Exact company match"
            : "Matched after company suffix normalization",
        ),
      );
    }
  }

  if (exactCandidates.length === 1) {
    return {
      status: "matched",
      bestMatch: exactCandidates[0],
      candidates: exactCandidates,
      matchReason: exactCandidates[0].scoreReason,
    };
  }
  if (exactCandidates.length > 1) {
    if (linkedContactCompanyRef?.id) {
      const contactMatched = exactCandidates.find(
        (c) => c.folkCompanyId === linkedContactCompanyRef.id,
      );
      if (contactMatched) {
        const winner: FolkCompanyCandidate = {
          ...contactMatched,
          scoreReason: "Exact company match + contact's Folk company",
        };
        return {
          status: "matched",
          bestMatch: winner,
          candidates: exactCandidates.slice(0, 5),
          matchReason: winner.scoreReason,
        };
      }
    }

    const sortedExact = [...exactCandidates].sort((a, b) => {
      const aHasDomain = a.domain ? 1 : 0;
      const bHasDomain = b.domain ? 1 : 0;
      return bHasDomain - aHasDomain;
    });

    return {
      status: "ambiguous",
      bestMatch: sortedExact[0],
      candidates: sortedExact.slice(0, 5),
      matchReason: `Found ${exactCandidates.length} Folk companies matching name`,
    };
  }

  if (linkedContactCompanyRef?.id) {
    const linked = folkCompanies.find((c) => c.id === linkedContactCompanyRef.id);
    if (linked) {
      const cand = toCompanyCandidate(linked, "Matched via Folk contact's company");
      return {
        status: "matched",
        bestMatch: cand,
        candidates: [cand],
        matchReason: cand.scoreReason,
      };
    }
    if (linkedContactCompanyRef.name) {
      const cand: FolkCompanyCandidate = {
        folkCompanyId: linkedContactCompanyRef.id,
        name: linkedContactCompanyRef.name,
        domain: null,
        industries: [],
        scoreReason: "Matched via Folk contact's company",
      };
      return {
        status: "matched",
        bestMatch: cand,
        candidates: [cand],
        matchReason: cand.scoreReason,
      };
    }
  }

  // Fuzzy substring or edit distance <= 2 on normalized stripped name
  const primary = normalizeCompanyName(row.companyName);
  const fuzzy: Array<{ cand: FolkCompanyCandidate; rank: number }> = [];
  for (const company of folkCompanies) {
    const compNorm = normalizeCompanyName(company.name);
    if (!compNorm || !primary) continue;
    if (
      primary.length >= 4 &&
      compNorm.length >= 4 &&
      (compNorm.includes(primary) || primary.includes(compNorm))
    ) {
      fuzzy.push({
        cand: toCompanyCandidate(company, "Partial company name match"),
        rank: 1,
      });
      continue;
    }
    const dist = levenshteinDistance(primary, compNorm);
    if (dist > 0 && dist <= 2 && Math.min(primary.length, compNorm.length) >= 4) {
      fuzzy.push({
        cand: toCompanyCandidate(company, `Fuzzy company match (edit distance ${dist})`),
        rank: 2 + dist,
      });
    }
  }

  if (fuzzy.length > 0) {
    fuzzy.sort((a, b) => a.rank - b.rank);
    const candidates = fuzzy.slice(0, 5).map((f) => f.cand);
    return {
      status: "fuzzy",
      bestMatch: candidates[0],
      candidates,
      matchReason: candidates[0].scoreReason,
    };
  }

  return {
    status: "unmatched",
    bestMatch: null,
    candidates: [],
    matchReason: "Company not found in Folk CRM",
  };
}

export { extractNameVariants };
