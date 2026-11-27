import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { FolkClientInterface, FolkPerson } from "@/lib/folk/types";
import {
  ApprovalRequiredError,
  ApprovalStaleError,
  ForbiddenGovernanceActionError,
  ProposalGovernanceService,
  type ChangeProposalRecord,
  type ProposalStore,
} from "@/lib/governance/proposals";

function createInMemoryProposalStore(): ProposalStore {
  const rows = new Map<string, ChangeProposalRecord>();
  return {
    async create(input) {
      const now = new Date();
      const record: ChangeProposalRecord = {
        ...input,
        id: randomUUID(),
        reviewedByUserId: null,
        reviewedAt: null,
        reviewNote: null,
        appliedAt: null,
        applyError: null,
        createdAt: now,
        updatedAt: now,
      };
      rows.set(record.id, record);
      return record;
    },
    async getById(id) {
      return rows.get(id) ?? null;
    },
    async findByIdempotencyKey(key) {
      for (const r of rows.values()) {
        if (r.idempotencyKey === key) return r;
      }
      return null;
    },
    async update(id, patch) {
      const existing = rows.get(id);
      if (!existing) throw new Error("Not found");
      const updated = { ...existing, ...patch, updatedAt: new Date() };
      rows.set(id, updated);
      return updated;
    },
  };
}

function createFakeFolkClient(person: FolkPerson): FolkClientInterface {
  let currentPerson = { ...person };
  return {
    listUsers: vi.fn(),
    listGroups: vi.fn(),
    listGroupCustomFields: vi.fn(),
    listPeople: vi.fn(),
    getPerson: vi.fn(async () => currentPerson),
    listCompanies: vi.fn(),
    getCompany: vi.fn(),
    listNotes: vi.fn(),
    listInteractions: vi.fn(),
    getInteraction: vi.fn(),
    createPerson: vi.fn(async (input) => ({
      id: "per_created_999",
      firstName: input.firstName ?? null,
      lastName: input.lastName ?? null,
      fullName: input.fullName ?? "Created Person",
      emails: input.emails ?? [],
      phones: [],
      jobTitle: input.jobTitle ?? null,
      urls: input.urls ?? [],
      companies: [],
      groups: [],
    })),
    updatePerson: vi.fn(async (_id, patch) => {
      currentPerson = { ...currentPerson, ...patch };
      return currentPerson;
    }),
    updateCompany: vi.fn(),
    createNote: vi.fn(),
    createInteraction: vi.fn(),
  };
}

describe("proposal governance (Phase 1 exit check)", () => {
  const basePerson: FolkPerson = {
    id: "per_123",
    firstName: "Jane",
    lastName: "Doe",
    fullName: "Jane Doe",
    emails: ["jane@acme.com"],
    phones: [],
    jobTitle: "Head of Marketing",
    urls: [],
    companies: [],
    groups: [],
  };

  it("blocks Folk writes until a human founder explicitly approves", async () => {
    const store = createInMemoryProposalStore();
    const service = new ProposalGovernanceService(store);
    const folkClient = createFakeFolkClient(basePerson);

    const proposal = await service.createProposal({
      targetSystem: "folk",
      entityType: "person",
      entityId: "per_123",
      folkRecordId: "per_123",
      proposedByAgentId: "agent_1",
      summary: "Promoted to CMO",
      proposedChangesJson: { jobTitle: "Chief Marketing Officer" },
      baseSnapshotJson: { jobTitle: "Head of Marketing" },
    });

    expect(proposal.status).toBe("pending_review");

    await expect(
      service.approveProposal({
        proposalId: proposal.id,
        approverUserId: "agent_1",
        actorType: "agent",
      }),
    ).rejects.toBeInstanceOf(ForbiddenGovernanceActionError);

    await expect(
      service.applyApprovedProposal({
        proposalId: proposal.id,
        folkClient,
      }),
    ).rejects.toBeInstanceOf(ApprovalRequiredError);

    expect(folkClient.updatePerson).not.toHaveBeenCalled();
  });

  it("invalidates approval when proposal changes are edited and checks expected hash", async () => {
    const store = createInMemoryProposalStore();
    const service = new ProposalGovernanceService(store);

    const proposal = await service.createProposal({
      targetSystem: "folk",
      entityType: "person",
      entityId: "per_123",
      folkRecordId: "per_123",
      summary: "Update title",
      proposedChangesJson: { jobTitle: "VP Marketing" },
      baseSnapshotJson: { jobTitle: "Head of Marketing" },
    });

    const approved = await service.approveProposal({
      proposalId: proposal.id,
      approverUserId: "founder_tim",
      actorType: "human",
      expectedPayloadHash: proposal.payloadHash,
    });
    expect(approved.status).toBe("approved");

    const edited = await service.editProposal(proposal.id, {
      proposedChangesJson: { jobTitle: "CMO" },
    });
    expect(edited.status).toBe("pending_review");
    expect(edited.reviewedByUserId).toBeNull();

    await expect(
      service.approveProposal({
        proposalId: proposal.id,
        approverUserId: "founder_tim",
        actorType: "human",
        expectedPayloadHash: proposal.payloadHash,
      }),
    ).rejects.toBeInstanceOf(ApprovalStaleError);
  });

  it("routes live Folk drift to conflict without overwriting Folk", async () => {
    const store = createInMemoryProposalStore();
    const service = new ProposalGovernanceService(store);
    const driftedPerson: FolkPerson = {
      ...basePerson,
      jobTitle: "SVP Marketing", // changed in Folk since proposal snapshot
    };
    const folkClient = createFakeFolkClient(driftedPerson);

    const proposal = await service.createProposal({
      targetSystem: "folk",
      entityType: "person",
      entityId: "per_123",
      folkRecordId: "per_123",
      summary: "Update title to CMO",
      proposedChangesJson: { jobTitle: "CMO" },
      baseSnapshotJson: { jobTitle: "Head of Marketing" },
    });

    await service.approveProposal({
      proposalId: proposal.id,
      approverUserId: "founder_ben",
      actorType: "human",
    });

    const result = await service.applyApprovedProposal({
      proposalId: proposal.id,
      folkClient,
      idempotencyKey: "apply-1",
    });

    expect(result.outcome).toBe("conflict");
    expect(result.proposal.status).toBe("conflict");
    expect(result.conflicts?.[0]?.liveFolkValue).toBe("SVP Marketing");
    expect(folkClient.updatePerson).not.toHaveBeenCalled();
  });

  it("applies approved non-conflicting change once and deduplicates retries", async () => {
    const store = createInMemoryProposalStore();
    const service = new ProposalGovernanceService(store);
    const folkClient = createFakeFolkClient(basePerson);

    const proposal = await service.createProposal({
      targetSystem: "folk",
      entityType: "person",
      entityId: "per_123",
      folkRecordId: "per_123",
      summary: "Update title to CMO",
      proposedChangesJson: { jobTitle: "CMO" },
      baseSnapshotJson: { jobTitle: "Head of Marketing" },
    });

    await service.approveProposal({
      proposalId: proposal.id,
      approverUserId: "founder_tim",
      actorType: "human",
    });

    const first = await service.applyApprovedProposal({
      proposalId: proposal.id,
      folkClient,
      idempotencyKey: "idem-123",
    });
    expect(first.outcome).toBe("applied");
    expect(folkClient.updatePerson).toHaveBeenCalledTimes(1);

    const retry = await service.applyApprovedProposal({
      proposalId: proposal.id,
      folkClient,
      idempotencyKey: "idem-123",
    });
    expect(retry.outcome).toBe("already_applied");
    expect(folkClient.updatePerson).toHaveBeenCalledTimes(1);
  });

  it("gates create_person proposals until founder approval and creates Folk contact with read-back", async () => {
    const store = createInMemoryProposalStore();
    const service = new ProposalGovernanceService(store);
    const folkClient = createFakeFolkClient(basePerson);

    const proposal = await service.createProposal({
      targetSystem: "folk",
      entityType: "person",
      entityId: "new:bristol-invitee-1",
      folkRecordId: null,
      proposedByAgentId: "agent_1",
      summary: "Create Folk person: Alex Candidate",
      proposedChangesJson: {
        _operation: "create_person",
        _targetBreakfastEventId: "evt_bristol",
        fullName: "Alex Candidate",
        jobTitle: "CMO",
        emails: ["alex@example.com"],
      },
      baseSnapshotJson: {},
    });

    await expect(
      service.applyApprovedProposal({
        proposalId: proposal.id,
        folkClient,
      }),
    ).rejects.toBeInstanceOf(ApprovalRequiredError);
    expect(folkClient.createPerson).not.toHaveBeenCalled();

    await service.approveProposal({
      proposalId: proposal.id,
      approverUserId: "founder_tim",
      actorType: "human",
    });

    const applied = await service.applyApprovedProposal({
      proposalId: proposal.id,
      folkClient,
      idempotencyKey: "create-1",
    });
    expect(applied.outcome).toBe("applied");
    expect(applied.createdFolkId).toBe("per_created_999");
    expect(applied.proposal.folkRecordId).toBe("per_created_999");
    expect(folkClient.createPerson).toHaveBeenCalledTimes(1);
    expect(folkClient.createPerson).toHaveBeenCalledWith({
      fullName: "Alex Candidate",
      jobTitle: "CMO",
      emails: ["alex@example.com"],
    });
    expect(folkClient.getPerson).toHaveBeenCalledWith("per_created_999");
  });

  it("resolves a conflicted Folk proposal using refreshed snapshot and applies cleanly", async () => {
    const store = createInMemoryProposalStore();
    const service = new ProposalGovernanceService(store);
    const driftedPerson: FolkPerson = {
      ...basePerson,
      jobTitle: "SVP Marketing",
    };
    const folkClient = createFakeFolkClient(driftedPerson);

    const proposal = await service.createProposal({
      targetSystem: "folk",
      entityType: "person",
      entityId: "per_123",
      folkRecordId: "per_123",
      summary: "Update title",
      proposedChangesJson: { jobTitle: "Chief Marketing Officer" },
      baseSnapshotJson: { jobTitle: "Head of Marketing" },
    });

    await service.approveProposal({
      proposalId: proposal.id,
      approverUserId: "founder_tim",
      actorType: "human",
    });
    const firstTry = await service.applyApprovedProposal({
      proposalId: proposal.id,
      folkClient,
    });
    expect(firstTry.outcome).toBe("conflict");

    const resolved = await service.resolveConflictAndApply({
      proposalId: proposal.id,
      approverUserId: "founder_ben",
      actorType: "human",
      resolvedChangesJson: { jobTitle: "Chief Marketing Officer" },
      refreshedBaseSnapshotJson: { jobTitle: "SVP Marketing" },
      folkClient,
      idempotencyKey: "resolve-1",
    });

    expect(resolved.outcome).toBe("applied");
    expect(resolved.proposal.status).toBe("applied");
    expect(folkClient.updatePerson).toHaveBeenCalledWith("per_123", {
      jobTitle: "Chief Marketing Officer",
    });
  });
});
