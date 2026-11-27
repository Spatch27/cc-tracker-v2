import type { FolkClientInterface, FolkCompany, FolkPerson } from "@/lib/folk/types";
import { canonicalStringify, computeProposalHash, sha256Hex } from "@/lib/governance/hashing";
import type { ProposalStore } from "@/lib/governance/proposals";

export interface LinkedPersonSnapshot {
  id: string;
  folkPersonId: string;
  fullName: string;
  email: string | null;
  jobTitle: string | null;
  linkedinUrl: string | null;
}

export interface LinkedCompanySnapshot {
  id: string;
  folkCompanyId: string;
  name: string;
  domain: string | null;
}

export interface ReconciliationErrorItem {
  entityType: "person" | "company";
  folkId: string;
  name: string;
  message: string;
}

export interface FolkReconciliationSummary {
  status: "succeeded" | "partial" | "failed";
  recordsChecked: number;
  conflictsCreated: number;
  conflictsAlreadyOpen: number;
  errors: ReconciliationErrorItem[];
}

export function extractLinkedinUrl(urls: string[]): string | null {
  const match = urls.find((u) => u.toLowerCase().includes("linkedin.com"));
  return match ?? null;
}

export function extractPrimaryDomain(urls: string[]): string | null {
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

function resolveFolkPersonFullName(live: FolkPerson): string {
  const explicit = live.fullName?.trim();
  if (explicit) return explicit;
  const combined = [live.firstName, live.lastName]
    .filter((v): v is string => Boolean(v && v.trim()))
    .join(" ")
    .trim();
  return combined || "Unknown";
}

export function diffPersonLinkVsFolk(
  local: Pick<LinkedPersonSnapshot, "fullName" | "email" | "jobTitle" | "linkedinUrl">,
  live: FolkPerson,
): {
  trackerValues: Record<string, unknown>;
  liveFolkValues: Record<string, unknown>;
  changedFields: string[];
} {
  const pairs: Array<[string, string | null, string | null]> = [
    ["fullName", local.fullName.trim() || null, resolveFolkPersonFullName(live)],
    ["email", local.email?.trim() || null, live.emails?.[0]?.trim() || null],
    ["jobTitle", local.jobTitle?.trim() || null, live.jobTitle?.trim() || null],
    ["linkedinUrl", local.linkedinUrl?.trim() || null, extractLinkedinUrl(live.urls ?? [])],
  ];

  const trackerValues: Record<string, unknown> = {};
  const liveFolkValues: Record<string, unknown> = {};
  const changedFields: string[] = [];

  for (const [field, localVal, liveVal] of pairs) {
    if ((localVal ?? null) !== (liveVal ?? null)) {
      trackerValues[field] = localVal ?? null;
      liveFolkValues[field] = liveVal ?? null;
      changedFields.push(field);
    }
  }

  return { trackerValues, liveFolkValues, changedFields };
}

export function diffCompanyLinkVsFolk(
  local: Pick<LinkedCompanySnapshot, "name" | "domain">,
  live: FolkCompany,
): {
  trackerValues: Record<string, unknown>;
  liveFolkValues: Record<string, unknown>;
  changedFields: string[];
} {
  const pairs: Array<[string, string | null, string | null]> = [
    ["name", local.name.trim(), live.name.trim()],
    ["domain", local.domain?.trim().toLowerCase() || null, extractPrimaryDomain(live.urls ?? [])],
  ];

  const trackerValues: Record<string, unknown> = {};
  const liveFolkValues: Record<string, unknown> = {};
  const changedFields: string[] = [];

  for (const [field, localVal, liveVal] of pairs) {
    if ((localVal ?? null) !== (liveVal ?? null)) {
      trackerValues[field] = localVal ?? null;
      liveFolkValues[field] = liveVal ?? null;
      changedFields.push(field);
    }
  }

  return { trackerValues, liveFolkValues, changedFields };
}

async function recordDriftConflict(params: {
  proposalStore: ProposalStore;
  entityType: "person" | "company";
  entityId: string;
  folkRecordId: string;
  displayName: string;
  changedFields: string[];
  trackerValues: Record<string, unknown>;
  liveFolkValues: Record<string, unknown>;
  initiatedByUserId?: string | null;
}): Promise<"created" | "already_open"> {
  const idempotencyKey = `reconcile:${sha256Hex(
    canonicalStringify({
      entityType: params.entityType,
      entityId: params.entityId,
      trackerValues: params.trackerValues,
      liveFolkValues: params.liveFolkValues,
    }),
  )}`;

  const existing = await params.proposalStore.findByIdempotencyKey(idempotencyKey);
  if (existing) {
    return "already_open";
  }

  const payloadHash = computeProposalHash({
    targetSystem: "tracker",
    entityType: params.entityType,
    entityId: params.entityId,
    folkRecordId: params.folkRecordId,
    proposedChangesJson: params.liveFolkValues,
  });

  await params.proposalStore.create({
    targetSystem: "tracker",
    entityType: params.entityType,
    entityId: params.entityId,
    folkRecordId: params.folkRecordId,
    proposedByAgentId: null,
    proposedByUserId: params.initiatedByUserId ?? null,
    summary: `Folk drift detected for ${params.displayName}: ${params.changedFields.join(", ")}`,
    proposedChangesJson: params.liveFolkValues,
    baseSnapshotJson: params.trackerValues,
    payloadHash,
    sourceUrl: null,
    sourceNote: "Automated Folk reconciliation comparison",
    factType: "verified",
    evidenceDate: new Date(),
    observedAt: new Date(),
    status: "conflict",
    idempotencyKey,
  });

  return "created";
}

/**
 * Compares linked Tracker people and companies against live Folk records.
 * Every mismatch creates a `conflict` item in `change_proposals` for human
 * resolution rather than silently overwriting either system.
 */
export async function runFolkReconciliation(deps: {
  peopleLinks: LinkedPersonSnapshot[];
  companyLinks: LinkedCompanySnapshot[];
  folkClient: FolkClientInterface;
  proposalStore: ProposalStore;
  initiatedByUserId?: string | null;
}): Promise<FolkReconciliationSummary> {
  let recordsChecked = 0;
  let conflictsCreated = 0;
  let conflictsAlreadyOpen = 0;
  const errors: ReconciliationErrorItem[] = [];

  for (const person of deps.peopleLinks) {
    try {
      const live = await deps.folkClient.getPerson(person.folkPersonId);
      recordsChecked += 1;
      const diff = diffPersonLinkVsFolk(person, live);
      if (diff.changedFields.length === 0) continue;

      const outcome = await recordDriftConflict({
        proposalStore: deps.proposalStore,
        entityType: "person",
        entityId: person.id,
        folkRecordId: person.folkPersonId,
        displayName: person.fullName,
        changedFields: diff.changedFields,
        trackerValues: diff.trackerValues,
        liveFolkValues: diff.liveFolkValues,
        initiatedByUserId: deps.initiatedByUserId,
      });
      if (outcome === "created") conflictsCreated += 1;
      else conflictsAlreadyOpen += 1;
    } catch (err) {
      errors.push({
        entityType: "person",
        folkId: person.folkPersonId,
        name: person.fullName,
        message: err instanceof Error ? err.message : "Failed to fetch Folk person",
      });
    }
  }

  for (const company of deps.companyLinks) {
    try {
      const live = await deps.folkClient.getCompany(company.folkCompanyId);
      recordsChecked += 1;
      const diff = diffCompanyLinkVsFolk(company, live);
      if (diff.changedFields.length === 0) continue;

      const outcome = await recordDriftConflict({
        proposalStore: deps.proposalStore,
        entityType: "company",
        entityId: company.id,
        folkRecordId: company.folkCompanyId,
        displayName: company.name,
        changedFields: diff.changedFields,
        trackerValues: diff.trackerValues,
        liveFolkValues: diff.liveFolkValues,
        initiatedByUserId: deps.initiatedByUserId,
      });
      if (outcome === "created") conflictsCreated += 1;
      else conflictsAlreadyOpen += 1;
    } catch (err) {
      errors.push({
        entityType: "company",
        folkId: company.folkCompanyId,
        name: company.name,
        message: err instanceof Error ? err.message : "Failed to fetch Folk company",
      });
    }
  }

  const totalTargets = deps.peopleLinks.length + deps.companyLinks.length;
  let status: "succeeded" | "partial" | "failed" = "succeeded";
  if (errors.length > 0) {
    status = totalTargets > 0 && errors.length >= totalTargets ? "failed" : "partial";
  }

  return {
    status,
    recordsChecked,
    conflictsCreated,
    conflictsAlreadyOpen,
    errors,
  };
}
