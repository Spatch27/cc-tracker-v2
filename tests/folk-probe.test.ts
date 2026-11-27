import { describe, expect, it, vi } from "vitest";
import { runFolkReadOnlyProbe } from "@/lib/folk/probe";
import type { FolkClientInterface } from "@/lib/folk/types";

describe("runFolkReadOnlyProbe", () => {
  it("calls only read-only Folk methods, redacts message bodies, and detects user IDs + thread keys", async () => {
    const fakeClient: FolkClientInterface = {
      listUsers: vi.fn(async () => ({
        items: [
          { id: "usr_tim", email: "tim@committedcitizens.co.uk" },
          { id: "usr_ben", email: "ben@committedcitizens.co.uk" },
        ],
        rawEnvelopeKeys: ["data"],
      })),
      listGroups: vi.fn(async () => ({
        items: [{ id: "grp_1", name: "Gold List" }],
        rawEnvelopeKeys: ["data"],
      })),
      listGroupCustomFields: vi.fn(async () => ({
        items: [{ id: "cf_1", name: "Locale", type: "select" }],
        rawEnvelopeKeys: ["data"],
      })),
      listPeople: vi.fn(async () => ({
        items: [
          {
            id: "per_1",
            fullName: "Secret Person",
            emails: ["secret.person@brand.com"],
            phones: [],
            urls: [],
            companies: [],
            groups: [],
          },
        ],
        pagination: { nextCursor: "cur_next" },
        rawEnvelopeKeys: ["data"],
      })),
      getPerson: vi.fn(),
      listCompanies: vi.fn(async () => ({
        items: [{ id: "cmp_1", name: "Acme", urls: [], industries: [], groups: [] }],
        rawEnvelopeKeys: ["data"],
      })),
      getCompany: vi.fn(),
      listNotes: vi.fn(async () => ({
        items: [{ id: "note_1", content: "CONFIDENTIAL_NOTE_BODY" }],
        rawEnvelopeKeys: ["data"],
      })),
      listInteractions: vi.fn(async () => ({
        items: [
          {
            id: "int_1",
            userId: "usr_tim",
            threadId: "thr_abc",
            content: "CONFIDENTIAL_EMAIL_BODY",
          },
          {
            id: "int_2",
            userId: "usr_ben",
            content: "ANOTHER_PRIVATE_EMAIL",
          },
        ],
        rawEnvelopeKeys: ["data"],
      })),
      getInteraction: vi.fn(),
      createPerson: vi.fn(),
      updatePerson: vi.fn(),
      updateCompany: vi.fn(),
      createNote: vi.fn(),
      createInteraction: vi.fn(),
    };

    const report = await runFolkReadOnlyProbe(fakeClient);

    expect(fakeClient.updatePerson).not.toHaveBeenCalled();
    expect(fakeClient.updateCompany).not.toHaveBeenCalled();
    expect(fakeClient.createNote).not.toHaveBeenCalled();
    expect(fakeClient.createInteraction).not.toHaveBeenCalled();

    expect(fakeClient.listGroupCustomFields).toHaveBeenCalledWith(
      "grp_1",
      "person",
    );
    expect(fakeClient.listGroupCustomFields).toHaveBeenCalledWith(
      "grp_1",
      "company",
    );
    expect(fakeClient.listInteractions).toHaveBeenCalledWith(
      expect.objectContaining({ entityId: "per_1" }),
    );
    expect(report.distinctInteractionUserIds).toEqual(["usr_tim", "usr_ben"]);
    expect(report.hasThreadOrConversationId).toBe(true);
    expect(report.markdownReport).not.toContain("CONFIDENTIAL_EMAIL_BODY");
    expect(report.markdownReport).not.toContain("CONFIDENTIAL_NOTE_BODY");
    expect(report.markdownReport).not.toContain("secret.person@brand.com");
  });
});
