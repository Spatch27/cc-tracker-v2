import type { FolkPerson } from "@/lib/folk/types";

export interface ParsedBreakfastImportRow {
  rowNumber: number;
  rawName: string;
  companyHint: string | null;
  roleHint: string | null;
  notes: string | null;
}

export interface ParsedBreakfastBlock {
  locale: string;
  headerLabel: string;
  dateLabel: string | null;
  rows: ParsedBreakfastImportRow[];
  stoppedAtMarker: string | null;
}

export interface ParsedBreakfastSheet {
  blocks: ParsedBreakfastBlock[];
  ignoredMarkers: string[];
}

export interface FolkMatchCandidate {
  folkPersonId: string;
  fullName: string;
  email: string | null;
  jobTitle: string | null;
  folkCompanyId: string | null;
  companyName: string | null;
  linkedinUrl: string | null;
  scoreReason: string;
}

export interface RowMatchResult {
  status: "matched" | "fuzzy" | "ambiguous" | "unmatched";
  bestMatch: FolkMatchCandidate | null;
  candidates: FolkMatchCandidate[];
  matchReason: string;
}

const LOCALE_KEYWORDS: Array<{ keyword: string; canonical: string }> = [
  { keyword: "bristol", canonical: "Bristol" },
  { keyword: "london", canonical: "London" },
  { keyword: "exeter", canonical: "Exeter" },
];

const STOP_MARKERS = new Set([
  "HOLD",
  "LEAVE",
  "ATTENDED IN NOV",
  "ATTENDED",
  "DO NOT INVITE",
]);

function detectLocaleHeader(cellValue: string): string | null {
  const lower = cellValue.trim().toLowerCase();
  if (!lower) return null;
  for (const entry of LOCALE_KEYWORDS) {
    if (lower.includes(entry.keyword)) {
      return entry.canonical;
    }
  }
  return null;
}

function cellString(rows: unknown[][], rowIdx: number, colIdx: number): string {
  const row = rows[rowIdx];
  if (!row || colIdx < 0 || colIdx >= row.length) return "";
  const val = row[colIdx];
  return val === null || val === undefined ? "" : String(val).trim();
}

function isFounderHostRow(name: string, companyHint: string | null): boolean {
  const norm = name.trim().toLowerCase();
  const isFounder =
    norm === "tim" ||
    norm === "ben" ||
    norm === "tim burley" ||
    norm === "ben scoggins";
  if (!isFounder) return false;
  const co = (companyHint ?? "").trim().toLowerCase();
  return co === "cc" || co === "committed citizens";
}

/**
 * Parses a side-by-side Breakfast2 worksheet grid into Bristol / London / Exeter
 * invite blocks, stopping each block independently at HOLD, LEAVE, or ATTENDED IN NOV.
 */
export function parseBreakfast2Grid(rows: unknown[][]): ParsedBreakfastSheet {
  let headerRowIndex = -1;
  const detectedBlocks: Array<{
    startCol: number;
    locale: string;
    headerLabel: string;
    dateLabel: string | null;
  }> = [];

  const scanLimit = Math.min(rows.length, 15);
  for (let r = 0; r < scanLimit; r += 1) {
    const row = rows[r] ?? [];
    const found: typeof detectedBlocks = [];
    for (let c = 0; c < row.length; c += 1) {
      const text = cellString(rows, r, c);
      const locale = detectLocaleHeader(text);
      if (locale) {
        found.push({
          startCol: c,
          locale,
          headerLabel: text,
          dateLabel: null,
        });
      }
    }
    if (found.length > 0) {
      headerRowIndex = r;
      for (let i = 0; i < found.length; i += 1) {
        const block = found[i];
        const nextStart =
          i + 1 < found.length ? found[i + 1].startCol : (rows[r]?.length ?? block.startCol + 1);
        if (block.startCol + 1 < nextStart) {
          const maybeDate = cellString(rows, r, block.startCol + 1);
          if (maybeDate && !detectLocaleHeader(maybeDate)) {
            block.dateLabel = maybeDate;
          }
        }
        detectedBlocks.push(block);
      }
      break;
    }
  }

  if (headerRowIndex === -1 || detectedBlocks.length === 0) {
    return { blocks: [], ignoredMarkers: [] };
  }

  const subHeaderRowIndex = headerRowIndex + 1;
  const ignoredMarkers = new Set<string>();
  const parsedBlocks: ParsedBreakfastBlock[] = [];

  for (let i = 0; i < detectedBlocks.length; i += 1) {
    const block = detectedBlocks[i];
    const endCol =
      i + 1 < detectedBlocks.length
        ? detectedBlocks[i + 1].startCol - 1
        : Math.max(...rows.map((r) => r?.length ?? 0), block.startCol + 5) - 1;

    let nameCol = block.startCol;
    const roleCols: number[] = [];
    let notesCol = -1;

    for (let c = block.startCol; c <= endCol; c += 1) {
      const label = cellString(rows, subHeaderRowIndex, c).toLowerCase();
      if (label === "name") {
        nameCol = c;
      } else if (label === "role" || label === "company" || label === "title") {
        roleCols.push(c);
      } else if (label === "notes" || label === "note") {
        notesCol = c;
      }
    }

    const companyCol = roleCols[0] ?? block.startCol + 1;
    const titleCol = roleCols.length > 1 ? roleCols[1] : -1;

    const parsedRows: ParsedBreakfastImportRow[] = [];
    let stoppedAtMarker: string | null = null;

    for (let r = subHeaderRowIndex + 1; r < rows.length; r += 1) {
      const rawName = cellString(rows, r, nameCol);
      const upper = rawName.toUpperCase();
      if (STOP_MARKERS.has(upper)) {
        stoppedAtMarker = rawName;
        ignoredMarkers.add(rawName);
        break;
      }

      if (!rawName) {
        continue;
      }

      const companyVal = cellString(rows, r, companyCol);
      const titleVal = titleCol >= 0 ? cellString(rows, r, titleCol) : "";
      const notesVal = notesCol >= 0 ? cellString(rows, r, notesCol) : "";

      const companyHint = companyVal || null;
      const roleHint = titleVal || null;
      const notes = notesVal || null;

      if (isFounderHostRow(rawName, companyHint)) {
        continue;
      }

      parsedRows.push({
        rowNumber: r + 1,
        rawName,
        companyHint,
        roleHint,
        notes,
      });
    }

    parsedBlocks.push({
      locale: block.locale,
      headerLabel: block.headerLabel,
      dateLabel: block.dateLabel,
      rows: parsedRows,
      stoppedAtMarker,
    });
  }

  return {
    blocks: parsedBlocks,
    ignoredMarkers: Array.from(ignoredMarkers),
  };
}

export function normalizePersonName(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Generates normalized full-name lookup keys from raw sheet strings, including
 * parenthetical nickname stripping ("Victoria (Tor) Crockatt" -> "victoria crockatt")
 * and nickname + surname combinations ("tor crockatt", "jo thomas").
 */
export function extractNameVariants(rawName: string): string[] {
  const variants = new Set<string>();
  const base = normalizePersonName(rawName);
  if (base) variants.add(base);

  const parenMatches = Array.from(rawName.matchAll(/\(([^)]+)\)/g)).map((m) =>
    normalizePersonName(m[1] ?? ""),
  );
  const withoutParens = rawName.replace(/\([^)]*\)/g, " ");
  const strippedNorm = normalizePersonName(withoutParens);
  if (strippedNorm) variants.add(strippedNorm);

  const strippedTokens = strippedNorm.split(" ").filter(Boolean);
  if (strippedTokens.length >= 2) {
    const surname = strippedTokens[strippedTokens.length - 1];
    for (const nick of parenMatches) {
      if (nick && surname) {
        variants.add(`${nick} ${surname}`);
      }
    }
  }

  return Array.from(variants);
}

export function levenshteinDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;

  const dp: number[] = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i += 1) {
    let prev = i - 1;
    dp[0] = i;
    for (let j = 1; j <= n; j += 1) {
      const temp = dp[j];
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + cost);
      prev = temp;
    }
  }
  return dp[n];
}

function resolveFolkPersonDisplayName(person: FolkPerson): string {
  const explicit = person.fullName?.trim();
  if (explicit) return explicit;
  return [person.firstName, person.lastName]
    .filter((v): v is string => Boolean(v && v.trim()))
    .join(" ")
    .trim();
}

function extractLinkedin(urls: string[]): string | null {
  return urls.find((u) => u.toLowerCase().includes("linkedin.com")) ?? null;
}

function toCandidate(person: FolkPerson, scoreReason: string): FolkMatchCandidate {
  return {
    folkPersonId: person.id,
    fullName: resolveFolkPersonDisplayName(person) || "Unknown",
    email: person.emails?.[0] ?? null,
    jobTitle: person.jobTitle ?? null,
    folkCompanyId: person.companies?.[0]?.id ?? null,
    companyName: person.companies?.[0]?.name ?? null,
    linkedinUrl: extractLinkedin(person.urls ?? []),
    scoreReason,
  };
}

function hasCompanyOverlap(
  companyHint: string | null,
  candidateCompany: string | null,
): boolean {
  if (!companyHint || !candidateCompany) return false;
  const hint = normalizePersonName(companyHint);
  const comp = normalizePersonName(candidateCompany);
  if (!hint || !comp) return false;
  if (hint.includes(comp) || comp.includes(hint)) return true;

  const hintTokens = hint.split(" ").filter((t) => t.length >= 3);
  const compTokens = new Set(comp.split(" ").filter((t) => t.length >= 3));
  return hintTokens.some((t) => compTokens.has(t));
}

export function matchBreakfastRowToFolk(
  row: ParsedBreakfastImportRow,
  folkPeople: FolkPerson[],
): RowMatchResult {
  const variants = extractNameVariants(row.rawName);
  const variantSet = new Set(variants);

  // Tier 1: Exact normalized full-name or stripped-nickname match
  const exactMatches: FolkMatchCandidate[] = [];
  for (const person of folkPeople) {
    const folkName = normalizePersonName(resolveFolkPersonDisplayName(person));
    if (!folkName) continue;
    if (variantSet.has(folkName)) {
      const reason =
        folkName === variants[0] ? "Exact name match" : "Matched after nickname normalization";
      exactMatches.push(toCandidate(person, reason));
    }
  }

  if (exactMatches.length === 1) {
    return {
      status: "matched",
      bestMatch: exactMatches[0],
      candidates: exactMatches,
      matchReason: exactMatches[0].scoreReason,
    };
  }

  if (exactMatches.length > 1) {
    const companyMatched = exactMatches.filter((c) =>
      hasCompanyOverlap(row.companyHint, c.companyName),
    );
    if (companyMatched.length === 1) {
      const winner: FolkMatchCandidate = {
        ...companyMatched[0],
        scoreReason: "Exact name + company tie-breaker",
      };
      return {
        status: "matched",
        bestMatch: winner,
        candidates: exactMatches.slice(0, 5),
        matchReason: winner.scoreReason,
      };
    }
    return {
      status: "ambiguous",
      bestMatch: null,
      candidates: exactMatches.slice(0, 5),
      matchReason: `Found ${exactMatches.length} Folk contacts with this name`,
    };
  }

  // Tier 2: Fuzzy Levenshtein <= 2 match for minor spelling quirks
  const primaryNorm =
    normalizePersonName(row.rawName.replace(/\([^)]*\)/g, " ")) ||
    normalizePersonName(row.rawName);
  const primaryTokens = primaryNorm.split(" ").filter(Boolean);
  const primaryFirst = primaryTokens[0] ?? "";
  const primaryLast = primaryTokens[primaryTokens.length - 1] ?? "";

  const fuzzyScored: Array<{
    candidate: FolkMatchCandidate;
    distance: number;
    companyBonus: number;
  }> = [];

  for (const person of folkPeople) {
    const folkName = normalizePersonName(resolveFolkPersonDisplayName(person));
    if (!folkName) continue;
    const distance = levenshteinDistance(primaryNorm, folkName);
    if (distance === 0 || distance > 2) continue;

    const folkTokens = folkName.split(" ").filter(Boolean);
    const folkFirst = folkTokens[0] ?? "";
    const folkLast = folkTokens[folkTokens.length - 1] ?? "";

    const firstCompatible =
      primaryFirst.length >= 2 &&
      folkFirst.length >= 2 &&
      primaryFirst[0] === folkFirst[0];
    const lastDistance = levenshteinDistance(primaryLast, folkLast);

    if (!firstCompatible || lastDistance > 2) continue;

    const candidate = toCandidate(person, `Fuzzy match (edit distance ${distance})`);
    const companyBonus = hasCompanyOverlap(row.companyHint, candidate.companyName) ? 1 : 0;
    fuzzyScored.push({ candidate, distance, companyBonus });
  }

  if (fuzzyScored.length > 0) {
    fuzzyScored.sort((a, b) => {
      if (a.distance !== b.distance) return a.distance - b.distance;
      return b.companyBonus - a.companyBonus;
    });
    const candidates = fuzzyScored.slice(0, 5).map((item) => item.candidate);
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
    matchReason: "Not found in Folk CRM",
  };
}
