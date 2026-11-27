import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { FolkClientInterface, FolkCreatePersonInput } from "@/lib/folk/types";
import { canonicalStringify, computeProposalHash } from "./hashing";

export type ProposalStatus =
  | "pending_review"
  | "approved"
  | "rejected"
  | "conflict"
  | "applied"
  | "failed";

export interface ChangeProposalRecord {
  id: string;
  targetSystem: "folk" | "tracker";
  entityType: "person" | "company" | "gold_account" | "breakfast_event";
  entityId: string;
  folkRecordId: string | null;
  proposedByAgentId: string | null;
  proposedByUserId: string | null;
  summary: string;
  proposedChangesJson: Record<string, unknown>;
  baseSnapshotJson: Record<string, unknown>;
  payloadHash: string;
  sourceUrl: string | null;
  sourceNote: string | null;
  factType: "verified" | "interpretation" | "unknown";
  evidenceDate: Date | null;
  observedAt: Date;
  status: ProposalStatus;
  reviewedByUserId: string | null;
  reviewedAt: Date | null;
  reviewNote: string | null;
  appliedAt: Date | null;
  applyError: string | null;
  idempotencyKey: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ProposalStore {
  create(
    input: Omit<
      ChangeProposalRecord,
      | "id"
      | "reviewedByUserId"
      | "reviewedAt"
      | "reviewNote"
      | "appliedAt"
      | "applyError"
      | "createdAt"
      | "updatedAt"
    >,
  ): Promise<ChangeProposalRecord>;
  getById(id: string): Promise<ChangeProposalRecord | null>;
  findByIdempotencyKey(key: string): Promise<ChangeProposalRecord | null>;
  update(
    id: string,
    patch: Partial<ChangeProposalRecord>,
  ): Promise<ChangeProposalRecord>;
}

export class ApprovalRequiredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ApprovalRequiredError";
  }
}

export class ApprovalStaleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ApprovalStaleError";
  }
}

export class ForbiddenGovernanceActionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ForbiddenGovernanceActionError";
  }
}

export interface ConflictDetail {
  field: string;
  baseValue: unknown;
  liveFolkValue: unknown;
  proposedValue: unknown;
}

export interface ApplyProposalResult {
  proposal: ChangeProposalRecord;
  outcome: "applied" | "already_applied" | "conflict";
  conflicts?: ConflictDetail[];
  createdFolkId?: string;
}

export function stripInternalProposalKeys(
  changes: Record<string, unknown>,
): Record<string, unknown> {
  const cleaned: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(changes)) {
    if (!key.startsWith("_")) {
      cleaned[key] = value;
    }
  }
  return cleaned;
}

function buildFolkCreatePersonInput(
  proposed: Record<string, unknown>,
): FolkCreatePersonInput {
  const input: FolkCreatePersonInput = {};
  if (typeof proposed.firstName === "string") input.firstName = proposed.firstName;
  if (typeof proposed.lastName === "string") input.lastName = proposed.lastName;
  if (typeof proposed.fullName === "string") input.fullName = proposed.fullName;
  if (typeof proposed.jobTitle === "string") input.jobTitle = proposed.jobTitle;
  if (typeof proposed.description === "string") input.description = proposed.description;
  if (Array.isArray(proposed.emails)) {
    input.emails = proposed.emails.filter((v): v is string => typeof v === "string");
  }
  if (Array.isArray(proposed.urls)) {
    input.urls = proposed.urls.filter((v): v is string => typeof v === "string");
  }
  if (Array.isArray(proposed.companies)) {
    input.companies = proposed.companies
      .filter((c): c is Record<string, unknown> => Boolean(c && typeof c === "object"))
      .map((c) => ({
        ...(typeof c.id === "string" ? { id: c.id } : {}),
        ...(typeof c.name === "string" ? { name: c.name } : {}),
      }));
  }
  if (Array.isArray(proposed.groups)) {
    input.groups = proposed.groups
      .filter(
        (g): g is { id: string } =>
          Boolean(g && typeof g === "object" && typeof (g as { id?: unknown }).id === "string"),
      )
      .map((g) => ({ id: g.id }));
  }
  return input;
}

export function detectFolkFieldConflicts(params: {
  proposedChanges: Record<string, unknown>;
  baseSnapshot: Record<string, unknown>;
  liveRecord: Record<string, unknown>;
}): ConflictDetail[] {
  const conflicts: ConflictDetail[] = [];
  for (const [field, proposedValue] of Object.entries(params.proposedChanges)) {
    if (field.startsWith("_")) continue;
    const baseValue = params.baseSnapshot[field];
    const liveFolkValue = params.liveRecord[field];
    if (canonicalStringify(baseValue ?? null) !== canonicalStringify(liveFolkValue ?? null)) {
      conflicts.push({
        field,
        baseValue: baseValue ?? null,
        liveFolkValue: liveFolkValue ?? null,
        proposedValue,
      });
    }
  }
  return conflicts;
}

export function createDrizzleProposalStore(): ProposalStore {
  return {
    async create(input) {
      const db = getDb();
      const [row] = await db
        .insert(schema.changeProposals)
        .values({
          targetSystem: input.targetSystem,
          entityType: input.entityType,
          entityId: input.entityId,
          folkRecordId: input.folkRecordId,
          proposedByAgentId: input.proposedByAgentId,
          proposedByUserId: input.proposedByUserId,
          summary: input.summary,
          proposedChangesJson: input.proposedChangesJson,
          baseSnapshotJson: input.baseSnapshotJson,
          payloadHash: input.payloadHash,
          sourceUrl: input.sourceUrl,
          sourceNote: input.sourceNote,
          factType: input.factType,
          evidenceDate: input.evidenceDate,
          observedAt: input.observedAt,
          status: input.status,
          idempotencyKey: input.idempotencyKey,
        })
        .returning();
      return row;
    },
    async getById(id) {
      const db = getDb();
      const [row] = await db
        .select()
        .from(schema.changeProposals)
        .where(eq(schema.changeProposals.id, id))
        .limit(1);
      return row ?? null;
    },
    async findByIdempotencyKey(key) {
      const db = getDb();
      const [row] = await db
        .select()
        .from(schema.changeProposals)
        .where(eq(schema.changeProposals.idempotencyKey, key))
        .limit(1);
      return row ?? null;
    },
    async update(id, patch) {
      const db = getDb();
      const [row] = await db
        .update(schema.changeProposals)
        .set({ ...patch, updatedAt: new Date() })
        .where(eq(schema.changeProposals.id, id))
        .returning();
      return row;
    },
  };
}

export class ProposalGovernanceService {
  constructor(private readonly store: ProposalStore) {}

  async createProposal(input: {
    targetSystem: "folk" | "tracker";
    entityType: "person" | "company" | "gold_account" | "breakfast_event";
    entityId: string;
    folkRecordId?: string | null;
    proposedByAgentId?: string | null;
    proposedByUserId?: string | null;
    summary: string;
    proposedChangesJson: Record<string, unknown>;
    baseSnapshotJson: Record<string, unknown>;
    sourceUrl?: string | null;
    sourceNote?: string | null;
    factType?: "verified" | "interpretation" | "unknown";
    evidenceDate?: Date | null;
    observedAt?: Date;
    idempotencyKey?: string | null;
  }): Promise<ChangeProposalRecord> {
    if (input.idempotencyKey) {
      const existing = await this.store.findByIdempotencyKey(input.idempotencyKey);
      if (existing) return existing;
    }

    const payloadHash = computeProposalHash({
      targetSystem: input.targetSystem,
      entityType: input.entityType,
      entityId: input.entityId,
      folkRecordId: input.folkRecordId ?? null,
      proposedChangesJson: input.proposedChangesJson,
    });

    return this.store.create({
      targetSystem: input.targetSystem,
      entityType: input.entityType,
      entityId: input.entityId,
      folkRecordId: input.folkRecordId ?? null,
      proposedByAgentId: input.proposedByAgentId ?? null,
      proposedByUserId: input.proposedByUserId ?? null,
      summary: input.summary,
      proposedChangesJson: input.proposedChangesJson,
      baseSnapshotJson: input.baseSnapshotJson,
      payloadHash,
      sourceUrl: input.sourceUrl ?? null,
      sourceNote: input.sourceNote ?? null,
      factType: input.factType ?? "verified",
      evidenceDate: input.evidenceDate ?? null,
      observedAt: input.observedAt ?? new Date(),
      status: "pending_review",
      idempotencyKey: input.idempotencyKey ?? null,
    });
  }

  async editProposal(
    proposalId: string,
    updates: {
      summary?: string;
      proposedChangesJson?: Record<string, unknown>;
      sourceUrl?: string | null;
      sourceNote?: string | null;
    },
  ): Promise<ChangeProposalRecord> {
    const existing = await this.store.getById(proposalId);
    if (!existing) {
      throw new Error(`Proposal ${proposalId} not found`);
    }

    const nextChanges = updates.proposedChangesJson ?? existing.proposedChangesJson;
    const nextHash = computeProposalHash({
      targetSystem: existing.targetSystem,
      entityType: existing.entityType,
      entityId: existing.entityId,
      folkRecordId: existing.folkRecordId,
      proposedChangesJson: nextChanges,
    });

    const hashChanged = nextHash !== existing.payloadHash;
    return this.store.update(proposalId, {
      summary: updates.summary ?? existing.summary,
      proposedChangesJson: nextChanges,
      sourceUrl: updates.sourceUrl !== undefined ? updates.sourceUrl : existing.sourceUrl,
      sourceNote: updates.sourceNote !== undefined ? updates.sourceNote : existing.sourceNote,
      payloadHash: nextHash,
      status: hashChanged ? "pending_review" : existing.status,
      reviewedByUserId: hashChanged ? null : existing.reviewedByUserId,
      reviewedAt: hashChanged ? null : existing.reviewedAt,
    });
  }

  async approveProposal(params: {
    proposalId: string;
    approverUserId: string;
    actorType: "human" | "agent";
    expectedPayloadHash?: string;
    reviewNote?: string | null;
  }): Promise<ChangeProposalRecord> {
    if (params.actorType !== "human") {
      throw new ForbiddenGovernanceActionError("Only an approved founder can approve a proposal");
    }

    const existing = await this.store.getById(params.proposalId);
    if (!existing) {
      throw new Error(`Proposal ${params.proposalId} not found`);
    }
    if (existing.status !== "pending_review" && existing.status !== "conflict") {
      throw new ApprovalRequiredError(
        `Proposal cannot be approved from status '${existing.status}'`,
      );
    }
    if (params.expectedPayloadHash && params.expectedPayloadHash !== existing.payloadHash) {
      throw new ApprovalStaleError(
        "Proposal payload changed since review started; reload and review the latest version",
      );
    }

    return this.store.update(params.proposalId, {
      status: "approved",
      reviewedByUserId: params.approverUserId,
      reviewedAt: new Date(),
      reviewNote: params.reviewNote ?? null,
    });
  }

  async rejectProposal(params: {
    proposalId: string;
    reviewerUserId: string;
    actorType: "human" | "agent";
    reviewNote?: string | null;
  }): Promise<ChangeProposalRecord> {
    if (params.actorType !== "human") {
      throw new ForbiddenGovernanceActionError("Only an approved founder can reject a proposal");
    }
    const existing = await this.store.getById(params.proposalId);
    if (!existing) {
      throw new Error(`Proposal ${params.proposalId} not found`);
    }
    return this.store.update(params.proposalId, {
      status: "rejected",
      reviewedByUserId: params.reviewerUserId,
      reviewedAt: new Date(),
      reviewNote: params.reviewNote ?? null,
    });
  }

  async applyApprovedProposal(params: {
    proposalId: string;
    folkClient: FolkClientInterface;
    idempotencyKey?: string;
  }): Promise<ApplyProposalResult> {
    const existing = await this.store.getById(params.proposalId);
    if (!existing) {
      throw new Error(`Proposal ${params.proposalId} not found`);
    }

    if (
      existing.status === "applied" &&
      (!params.idempotencyKey || existing.idempotencyKey === params.idempotencyKey)
    ) {
      return { proposal: existing, outcome: "already_applied" };
    }

    if (existing.status !== "approved") {
      throw new ApprovalRequiredError(
        `Cannot apply proposal in status '${existing.status}'; explicit human approval is required`,
      );
    }

    const expectedHash = computeProposalHash({
      targetSystem: existing.targetSystem,
      entityType: existing.entityType,
      entityId: existing.entityId,
      folkRecordId: existing.folkRecordId,
      proposedChangesJson: existing.proposedChangesJson,
    });
    if (expectedHash !== existing.payloadHash) {
      throw new ApprovalStaleError(
        "Proposal payload hash mismatch; re-approval is required before applying",
      );
    }

    let createdFolkId: string | undefined;

    if (existing.targetSystem === "folk") {
      const isCreatePerson =
        existing.entityType === "person" &&
        !existing.folkRecordId &&
        (existing.entityId.startsWith("new:") ||
          existing.proposedChangesJson._operation === "create_person");

      if (isCreatePerson) {
        const createInput = buildFolkCreatePersonInput(existing.proposedChangesJson);
        const created = await params.folkClient.createPerson(createInput);
        await params.folkClient.getPerson(created.id);
        createdFolkId = created.id;

        const applied = await this.store.update(existing.id, {
          status: "applied",
          folkRecordId: created.id,
          appliedAt: new Date(),
          applyError: null,
          idempotencyKey: params.idempotencyKey ?? existing.idempotencyKey ?? randomUUID(),
        });

        return { proposal: applied, outcome: "applied", createdFolkId };
      }

      const folkId = existing.folkRecordId ?? existing.entityId;
      const sanitizedChanges = stripInternalProposalKeys(existing.proposedChangesJson);

      if (existing.entityType === "person") {
        const livePerson = await params.folkClient.getPerson(folkId);
        const conflicts = detectFolkFieldConflicts({
          proposedChanges: sanitizedChanges,
          baseSnapshot: existing.baseSnapshotJson,
          liveRecord: livePerson as unknown as Record<string, unknown>,
        });
        if (conflicts.length > 0) {
          const conflicted = await this.store.update(existing.id, {
            status: "conflict",
            applyError: `Detected ${conflicts.length} live Folk field drift(s) before write`,
          });
          return { proposal: conflicted, outcome: "conflict", conflicts };
        }

        await params.folkClient.updatePerson(folkId, sanitizedChanges);
        await params.folkClient.getPerson(folkId);
      } else if (existing.entityType === "company") {
        const liveCompany = await params.folkClient.getCompany(folkId);
        const conflicts = detectFolkFieldConflicts({
          proposedChanges: sanitizedChanges,
          baseSnapshot: existing.baseSnapshotJson,
          liveRecord: liveCompany as unknown as Record<string, unknown>,
        });
        if (conflicts.length > 0) {
          const conflicted = await this.store.update(existing.id, {
            status: "conflict",
            applyError: `Detected ${conflicts.length} live Folk field drift(s) before write`,
          });
          return { proposal: conflicted, outcome: "conflict", conflicts };
        }

        await params.folkClient.updateCompany(folkId, sanitizedChanges);
        await params.folkClient.getCompany(folkId);
      }
    }

    const applied = await this.store.update(existing.id, {
      status: "applied",
      appliedAt: new Date(),
      applyError: null,
      idempotencyKey: params.idempotencyKey ?? existing.idempotencyKey ?? randomUUID(),
    });

    return { proposal: applied, outcome: "applied", createdFolkId };
  }

  /**
   * Resolves a conflicted or pending proposal with founder-chosen values and a
   * refreshed live Folk snapshot, marks it approved by the founder, and applies
   * through the standard pre-write verification path.
   */
  async resolveConflictAndApply(params: {
    proposalId: string;
    approverUserId: string;
    actorType: "human" | "agent";
    resolvedChangesJson: Record<string, unknown>;
    refreshedBaseSnapshotJson: Record<string, unknown>;
    folkClient: FolkClientInterface;
    reviewNote?: string | null;
    idempotencyKey?: string;
  }): Promise<ApplyProposalResult> {
    if (params.actorType !== "human") {
      throw new ForbiddenGovernanceActionError("Only an approved founder can resolve conflicts");
    }

    const existing = await this.store.getById(params.proposalId);
    if (!existing) {
      throw new Error(`Proposal ${params.proposalId} not found`);
    }
    if (
      existing.status !== "conflict" &&
      existing.status !== "pending_review" &&
      existing.status !== "approved"
    ) {
      throw new ApprovalRequiredError(
        `Proposal cannot be resolved from status '${existing.status}'`,
      );
    }

    const nextHash = computeProposalHash({
      targetSystem: existing.targetSystem,
      entityType: existing.entityType,
      entityId: existing.entityId,
      folkRecordId: existing.folkRecordId,
      proposedChangesJson: params.resolvedChangesJson,
    });

    await this.store.update(existing.id, {
      proposedChangesJson: params.resolvedChangesJson,
      baseSnapshotJson: params.refreshedBaseSnapshotJson,
      payloadHash: nextHash,
      status: "approved",
      reviewedByUserId: params.approverUserId,
      reviewedAt: new Date(),
      reviewNote: params.reviewNote ?? existing.reviewNote,
      applyError: null,
    });

    return this.applyApprovedProposal({
      proposalId: existing.id,
      folkClient: params.folkClient,
      idempotencyKey: params.idempotencyKey,
    });
  }
}
