import { describe, expect, it } from "vitest";
import type { FolkCompany } from "@/lib/folk/types";
import {
  inferContactRoleCategory,
  inferSignalType,
  isApprovedGoldTabName,
  matchGoldCompanyToFolk,
  parseGoldListTab,
} from "@/lib/gold-lists/import-parser";

function makeCompany(
  overrides: Partial<FolkCompany> & { id: string; name: string },
): FolkCompany {
  return {
    description: null,
    urls: [],
    industries: [],
    groups: [],
    ...overrides,
  };
}

describe("Gold-list import tab allowlist & parser (synthetic fixtures)", () => {
  it("approves only Tim ABM and Ben ABM and blocks Warm List, Cold list, and Top 100 tabs", () => {
    expect(isApprovedGoldTabName("Tim ABM")).toEqual({
      approved: true,
      defaultOwnerKey: "tim",
    });
    expect(isApprovedGoldTabName("Ben ABM")).toEqual({
      approved: true,
      defaultOwnerKey: "ben",
    });
    expect(isApprovedGoldTabName("Warm List").approved).toBe(false);
    expect(isApprovedGoldTabName("Cold list").approved).toBe(false);
    expect(isApprovedGoldTabName("Top 100 2026").approved).toBe(false);
    expect(isApprovedGoldTabName("Breakfast2").approved).toBe(false);
  });

  it("parses Tim ABM and Ben ABM rows capturing TBC gaps, stale email warnings, signals, and legacy scores", () => {
    const rows: unknown[][] = [
      [
        "Tim's rank",
        "Size (0-3)",
        "Role (0-3)",
        "Environment (0-3)",
        "Brand",
        "Y / M",
        "Name",
        "Current title",
        "Company",
        "Email",
        "Email check",
        "Change signals",
        "Relationship so far",
        "Score",
      ],
      [
        "1",
        "2",
        "3",
        "2",
        "Northwind",
        "Y",
        "Alice Mercer",
        "Chief Marketing Officer",
        "Northwind Retail Ltd",
        "alice@oldco.test",
        "Out of date: oldco address",
        "Appointed Oct 2026 after acquisition",
        "Warm postcard sent",
        "14.5",
      ],
      [
        "2",
        "2",
        "1",
        "1",
        "HarbourTech",
        "M",
        "TBC",
        "Find CMO contact",
        "HarbourTech PLC",
        "",
        "",
        "New funding round announced",
        "",
        "",
      ],
    ];

    const parsed = parseGoldListTab("Tim ABM", rows);
    expect(parsed).toHaveLength(2);

    expect(parsed[0]).toMatchObject({
      defaultOwnerKey: "tim",
      companyName: "Northwind Retail Ltd",
      brandName: "Northwind",
      contactName: "Alice Mercer",
      isContactGap: false,
      staleDataWarning: "Out of date: oldco address",
      changeSignals: "Appointed Oct 2026 after acquisition",
      legacyScoreMetadata: {
        sourceTab: "Tim ABM",
        rank: "1",
        totalScore: "14.5",
      },
    });

    expect(parsed[1]).toMatchObject({
      companyName: "HarbourTech PLC",
      contactName: null,
      isContactGap: true,
      changeSignals: "New funding round announced",
    });

    expect(() => parseGoldListTab("Warm List", rows)).toThrow();
  });

  it("matches Folk companies across exact, suffix-normalized, contact-linked, fuzzy, and unmatched cases", () => {
    const companies: FolkCompany[] = [
      makeCompany({
        id: "cmp_1",
        name: "Northwind Retail",
        urls: ["https://northwind.test"],
      }),
      makeCompany({
        id: "cmp_2",
        name: "HarbourTech International",
        urls: ["https://harbourtech.test"],
      }),
      makeCompany({
        id: "cmp_3",
        name: "Redwood Outdoors",
        urls: ["https://redwood.test"],
      }),
    ];

    const exactSuffix = matchGoldCompanyToFolk(
      { companyName: "Northwind Retail Ltd", brandName: null },
      companies,
    );
    expect(exactSuffix.status).toBe("matched");
    expect(exactSuffix.bestMatch?.folkCompanyId).toBe("cmp_1");

    const viaContact = matchGoldCompanyToFolk(
      { companyName: "Different Trading Name", brandName: null },
      companies,
      { id: "cmp_2", name: "HarbourTech International" },
    );
    expect(viaContact.status).toBe("matched");
    expect(viaContact.bestMatch?.folkCompanyId).toBe("cmp_2");

    const fuzzy = matchGoldCompanyToFolk(
      { companyName: "Redwod Outdoors", brandName: null },
      companies,
    );
    expect(fuzzy.status).toBe("fuzzy");
    expect(fuzzy.bestMatch?.folkCompanyId).toBe("cmp_3");

    const missing = matchGoldCompanyToFolk(
      { companyName: "Unheard Of Holdings", brandName: null },
      companies,
    );
    expect(missing.status).toBe("unmatched");

    const dupes: FolkCompany[] = [
      makeCompany({ id: "cmp_stub", name: "Acme", urls: [] }),
      makeCompany({
        id: "cmp_rich",
        name: "Acme Ltd",
        urls: ["https://acme.test"],
      }),
    ];
    const resolvedByContact = matchGoldCompanyToFolk(
      { companyName: "Acme", brandName: null },
      dupes,
      { id: "cmp_rich", name: "Acme Ltd" },
    );
    expect(resolvedByContact.status).toBe("matched");
    expect(resolvedByContact.bestMatch?.folkCompanyId).toBe("cmp_rich");
  });

  it("infers contact role category and buying signal type cleanly", () => {
    expect(inferContactRoleCategory("Chief Marketing Officer")).toBe("cmo");
    expect(inferContactRoleCategory("Head of Marketing Operations")).toBe(
      "marketing_ops",
    );
    expect(inferContactRoleCategory("VP Brand & Growth")).toBe("vp_marketing");
    expect(inferContactRoleCategory("Marketing Director")).toBe(
      "marketing_director",
    );

    expect(inferSignalType("Nuveen acquisition completed")).toBe("acquisition");
    expect(inferSignalType("Appointed CMO Sep 2026")).toBe("leadership_change");
    expect(inferSignalType("Group restructuring underway")).toBe(
      "consolidation",
    );
  });
});
