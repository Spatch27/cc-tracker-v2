import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { runFolkReconciliation } from "@/lib/folk/reconcile";
import type { FolkClientInterface, FolkCompany, FolkPerson } from "@/lib/folk/types";
import type { ChangeProposalRecord, ProposalStore } from "@/lib/governance/proposals";

function createInMemoryProposalStore(): {
  store: ProposalStore;
  rows: ChangeProposalRecord[];
} {
  const rows: ChangeProposalRecord[] = [];
  const store: ProposalStore = {
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
      rows.push(record);
      return record;
    },
    async getById(id) {
      return rows.find((r) => r.id === id) ?? null;
    },
    async findByIdempotencyKey(key) {
      return rows.find((r) => r.idempotencyKey === key) ?? null;
    },
    async update(id, patch) {
      const idx = rows.findIndex((r) => r.id === id);
      if (idx === -1) throw new Error("Not found");
      rows[idx] = { ...rows[idx], ...patch, updatedAt: new Date() };
      return rows[idx];
    },
  };
  return { store, rows };
}

function makeFakeFolkClient(overrides: {
  getPerson?: FolkClientInterface["getPerson"];
  getCompany?: FolkClientInterface["getCompany"];
}): FolkClientInterface {
  return {
    listUsers: vi.fn(),
    listGroups: vi.fn(),
    listGroupCustomFields: vi.fn(),
    listPeople: vi.fn(),
    getPerson: overrides.getPerson ?? vi.fn(),
    listCompanies: vi.fn(),
    getCompany: overrides.getCompany ?? vi.fn(),
    listNotes: vi.fn(),
    listInteractions: vi.fn(),
    getInteraction: vi.fn(),
    createPerson: vi.fn(),
    updatePerson: vi.fn(),
    updateCompany: vi.fn(),
    createNote: vi.fn(),
    createInteraction: vi.fn(),
  };
}

describe("Folk reconciliation engine (Phase 4)", () => {
  it("reports succeeded with 0 conflicts when Tracker matches live Folk", async () => {
    const { store, rows } = createInMemoryProposalStore();
    const livePerson: FolkPerson = {
      id: "per_1",
      fullName: "Jane Doe",
      emails: ["jane@acme.co.uk"],
      phones: [],
      jobTitle: "CMO",
      urls: ["https://www.linkedin.com/in/janedoe"],
      companies: [],
      groups: [],
    };
    const liveCompany: FolkCompany = {
      id: "cmp_1",
      name: "Acme Ltd",
      urls: ["https://acme.co.uk"],
      industries: [],
      groups: [],
    };

    const folkClient = makeFakeFolkClient({
      getPerson: vi.fn(async () => livePerson),
      getCompany: vi.fn(async () => liveCompany),
    });

    const summary = await runFolkReconciliation({
      peopleLinks: [
        {
          id: "link_p1",
          folkPersonId: "per_1",
          fullName: "Jane Doe",
          email: "jane@acme.co.uk",
          jobTitle: "CMO",
          linkedinUrl: "https://www.linkedin.com/in/janedoe",
        },
      ],
      companyLinks: [
        {
          id: "link_c1",
          folkCompanyId: "cmp_1",
          name: "Acme Ltd",
          domain: "acme.co.uk",
        },
      ],
      folkClient,
      proposalStore: store,
    });

    expect(summary.status).toBe("succeeded");
    expect(summary.recordsChecked).toBe(2);
    expect(summary.conflictsCreated).toBe(0);
    expect(rows).toHaveLength(0);
    expect(folkClient.updatePerson).not.toHaveBeenCalled();
    expect(folkClient.updateCompany).not.toHaveBeenCalled();
  });

  it("creates conflict proposals without overwriting either system and deduplicates re-runs", async () => {
    const { store, rows } = createInMemoryProposalStore();
    const folkClient = makeFakeFolkClient({
      getPerson: vi.fn(async () => ({
        id: "per_2",
        fullName: "Sam Smith",
        emails: ["sam.new@brand.com"],
        phones: [],
        jobTitle: "VP Brand",
        urls: [],
        companies: [],
        groups: [],
      })),
      getCompany: vi.fn(async () => ({
        id: "cmp_2",
        name: "Brand Group Ltd",
        urls: ["https://brandgroup.com"],
        industries: [],
        groups: [],
      })),
    });

    const deps = {
      peopleLinks: [
        {
          id: "link_p2",
          folkPersonId: "per_2",
          fullName: "Sam Smith",
          email: "sam@brand.com",
          jobTitle: "Head of Brand",
          linkedinUrl: null,
        },
      ],
      companyLinks: [
        {
          id: "link_c2",
          folkCompanyId: "cmp_2",
          name: "Brand Co",
          domain: "brand.com",
        },
      ],
      folkClient,
      proposalStore: store,
    };

    const first = await runFolkReconciliation(deps);
    expect(first.status).toBe("succeeded");
    expect(first.conflictsCreated).toBe(2);
    expect(rows.every((r) => r.status === "conflict")).toBe(true);
    expect(rows.every((r) => r.targetSystem === "tracker")).toBe(true);

    const second = await runFolkReconciliation(deps);
    expect(second.conflictsCreated).toBe(0);
    expect(second.conflictsAlreadyOpen).toBe(2);
    expect(rows).toHaveLength(2);
  });

  it("reports partial when one fetch fails and failed when all fetches fail (never claims in sync)", async () => {
    const { store } = createInMemoryProposalStore();

    const partialClient = makeFakeFolkClient({
      getPerson: vi.fn(async (id) => {
        if (id === "per_bad") throw new Error("Folk HTTP 502");
        return {
          id,
          fullName: "Good Person",
          emails: ["good@co.uk"],
          phones: [],
          jobTitle: "CMO",
          urls: [],
          companies: [],
          groups: [],
        };
      }),
    });

    const partialSummary = await runFolkReconciliation({
      peopleLinks: [
        {
          id: "l1",
          folkPersonId: "per_good",
          fullName: "Good Person",
          email: "good@co.uk",
          jobTitle: "CMO",
          linkedinUrl: null,
        },
        {
          id: "l2",
          folkPersonId: "per_bad",
          fullName: "Bad Person",
          email: null,
          jobTitle: null,
          linkedinUrl: null,
        },
      ],
      companyLinks: [],
      folkClient: partialClient,
      proposalStore: store,
    });

    expect(partialSummary.status).toBe("partial");
    expect(partialSummary.recordsChecked).toBe(1);
    expect(partialSummary.errors).toHaveLength(1);

    const failedClient = makeFakeFolkClient({
      getPerson: vi.fn(async () => {
        throw new Error("Folk HTTP 503");
      }),
    });

    const failedSummary = await runFolkReconciliation({
      peopleLinks: [
        {
          id: "l2",
          folkPersonId: "per_bad",
          fullName: "Bad Person",
          email: null,
          jobTitle: null,
          linkedinUrl: null,
        },
      ],
      companyLinks: [],
      folkClient: failedClient,
      proposalStore: store,
    });

    expect(failedSummary.status).toBe("failed");
    expect(failedSummary.recordsChecked).toBe(0);
    expect(failedSummary.errors).toHaveLength(1);
  });
});
