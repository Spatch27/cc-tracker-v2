import { describe, expect, it } from "vitest";
import {
  matchBreakfastRowToFolk,
  parseBreakfast2Grid,
} from "@/lib/breakfasts/import-parser";
import type { FolkPerson } from "@/lib/folk/types";

function makeFolkPerson(
  overrides: Partial<FolkPerson> & { id: string; fullName: string },
): FolkPerson {
  return {
    firstName: null,
    lastName: null,
    emails: [],
    phones: [],
    jobTitle: null,
    urls: [],
    companies: [],
    groups: [],
    ...overrides,
  };
}

describe("Breakfast2 spreadsheet parser (synthetic fixtures)", () => {
  it("parses side-by-side Bristol/London/Exeter main lists and excludes HOLD, LEAVE, ATTENDED IN NOV", () => {
    const grid: unknown[][] = [
      [
        "Bristol 14 max",
        "Wednesday 3rd Feb",
        "",
        "",
        "",
        "",
        "",
        "London - 14 MAX",
        "Thursday 4th Feb",
        "",
        "",
        "",
        "",
        "Exeter 10 MAX",
        "Friday 5th Feb",
        "",
        "",
        "",
      ],
      [
        "Name",
        "Role",
        "Role",
        "Invited?",
        "Accepted?",
        "Notes",
        "",
        "Name",
        "Role",
        "Invited?",
        "Accepted?",
        "Notes",
        "",
        "Name",
        "Role",
        "Invited?",
        "Accepted?",
        "Notes",
      ],
      [
        "Alice Mercer",
        "Acme Foods",
        "CMO",
        "",
        "",
        "postcard sent",
        "",
        "Bob Turner",
        "Northwind",
        "",
        "",
        "warm intro",
        "",
        "clara west",
        "HarbourTech CMO",
        "",
        "",
        "",
      ],
      ["", "", "", "", "", "", "", "HOLD", "", "", "", "", "", "HOLD", "", "", "", ""],
      [
        "Ben",
        "CC",
        "",
        "",
        "",
        "",
        "",
        "Ignored Hold Person",
        "HoldCo",
        "",
        "",
        "",
        "",
        "Ignored Exeter Hold",
        "ExHoldCo",
        "",
        "",
        "",
      ],
      [
        "HOLD",
        "",
        "",
        "",
        "",
        "",
        "",
        "ATTENDED IN NOV",
        "",
        "",
        "",
        "",
        "",
        "ATTENDED IN NOV",
        "",
        "",
        "",
        "",
      ],
      [
        "Ignored Bristol Hold",
        "OldCo",
        "CMO",
        "",
        "",
        "",
        "",
        "Ignored London Attended",
        "OldLon",
        "",
        "",
        "",
        "",
        "Ignored Exeter Attended",
        "OldEx",
        "",
        "",
        "",
      ],
      [
        "LEAVE",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
      ],
      [
        "Ignored Leave Contact",
        "LeaveCo",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
      ],
    ];

    const parsed = parseBreakfast2Grid(grid);
    expect(parsed.blocks).toHaveLength(3);

    const [bristol, london, exeter] = parsed.blocks;
    expect(bristol.locale).toBe("Bristol");
    expect(bristol.rows).toEqual([
      {
        rowNumber: 3,
        rawName: "Alice Mercer",
        companyHint: "Acme Foods",
        roleHint: "CMO",
        notes: "postcard sent",
      },
    ]);
    expect(bristol.stoppedAtMarker).toBe("HOLD");

    expect(london.locale).toBe("London");
    expect(london.rows).toEqual([
      {
        rowNumber: 3,
        rawName: "Bob Turner",
        companyHint: "Northwind",
        roleHint: null,
        notes: "warm intro",
      },
    ]);

    expect(exeter.locale).toBe("Exeter");
    expect(exeter.rows).toEqual([
      {
        rowNumber: 3,
        rawName: "clara west",
        companyHint: "HarbourTech CMO",
        roleHint: null,
        notes: null,
      },
    ]);
  });
});

describe("Breakfast2 Folk matcher (synthetic fixtures)", () => {
  const people: FolkPerson[] = [
    makeFolkPerson({
      id: "per_1",
      fullName: "Catherine Summers",
      emails: ["cat@valley.test"],
      companies: [{ id: "cmp_1", name: "Valley Dairy" }],
    }),
    makeFolkPerson({
      id: "per_2",
      fullName: "Hannah Winters",
      emails: ["han@appliance.test"],
      companies: [{ id: "cmp_2", name: "Appliance Labs" }],
    }),
    makeFolkPerson({
      id: "per_3",
      fullName: "Fred Barker",
      emails: ["fred@maritime.test"],
      companies: [{ id: "cmp_3", name: "Maritime Registry" }],
    }),
    makeFolkPerson({
      id: "per_4",
      fullName: "Arthur Barnill",
      emails: ["arthur@widget.test"],
      companies: [{ id: "cmp_4", name: "Widget Co" }],
    }),
    makeFolkPerson({
      id: "per_5",
      fullName: "Jordan Lee",
      emails: ["jordan@alpha.test"],
      companies: [{ id: "cmp_5", name: "Alpha Retail" }],
    }),
    makeFolkPerson({
      id: "per_6",
      fullName: "Jordan Lee",
      emails: ["jordan@beta.test"],
      companies: [{ id: "cmp_6", name: "Beta Media" }],
    }),
  ];

  it("matches exact and parenthetical nickname formats", () => {
    const res1 = matchBreakfastRowToFolk(
      {
        rowNumber: 1,
        rawName: "Catherine (Cat) Summers",
        companyHint: "Valley Dairy",
        roleHint: null,
        notes: null,
      },
      people,
    );
    expect(res1.status).toBe("matched");
    expect(res1.bestMatch?.folkPersonId).toBe("per_1");

    const res2 = matchBreakfastRowToFolk(
      {
        rowNumber: 2,
        rawName: "Hannah Winters (Han)",
        companyHint: null,
        roleHint: null,
        notes: null,
      },
      people,
    );
    expect(res2.status).toBe("matched");
    expect(res2.bestMatch?.folkPersonId).toBe("per_2");

    const res3 = matchBreakfastRowToFolk(
      {
        rowNumber: 3,
        rawName: "Frederick (Fred) Barker",
        companyHint: null,
        roleHint: null,
        notes: null,
      },
      people,
    );
    expect(res3.status).toBe("matched");
    expect(res3.bestMatch?.folkPersonId).toBe("per_3");
  });

  it("flags minor spelling quirks as fuzzy for founder review", () => {
    const res = matchBreakfastRowToFolk(
      {
        rowNumber: 4,
        rawName: "Arthur Barnhill",
        companyHint: "Widget Co",
        roleHint: null,
        notes: null,
      },
      people,
    );
    expect(res.status).toBe("fuzzy");
    expect(res.bestMatch?.folkPersonId).toBe("per_4");
  });

  it("disambiguates duplicate names by company hint or returns ambiguous", () => {
    const resolved = matchBreakfastRowToFolk(
      {
        rowNumber: 5,
        rawName: "Jordan Lee",
        companyHint: "Beta Media",
        roleHint: null,
        notes: null,
      },
      people,
    );
    expect(resolved.status).toBe("matched");
    expect(resolved.bestMatch?.folkPersonId).toBe("per_6");

    const unresolved = matchBreakfastRowToFolk(
      {
        rowNumber: 6,
        rawName: "Jordan Lee",
        companyHint: "Unrelated Corp",
        roleHint: null,
        notes: null,
      },
      people,
    );
    expect(unresolved.status).toBe("ambiguous");
    expect(unresolved.candidates).toHaveLength(2);
  });

  it("returns unmatched when contact is not in Folk CRM", () => {
    const res = matchBreakfastRowToFolk(
      {
        rowNumber: 7,
        rawName: "Totally Missing Person",
        companyHint: "Mystery Ltd",
        roleHint: "CMO",
        notes: null,
      },
      people,
    );
    expect(res.status).toBe("unmatched");
    expect(res.bestMatch).toBeNull();
  });
});
