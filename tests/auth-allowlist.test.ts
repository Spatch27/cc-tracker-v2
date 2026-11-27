import { describe, expect, it } from "vitest";
import { isEmailAllowlisted, parseAllowedEmails } from "@/lib/auth";

describe("founder allowlist", () => {
  it("normalizes whitespace and case when parsing", () => {
    const parsed = parseAllowedEmails(
      "  Tim@CommittedCitizens.co.uk , ben@committedcitizens.co.uk,  ",
    );
    expect(parsed).toEqual([
      "tim@committedcitizens.co.uk",
      "ben@committedcitizens.co.uk",
    ]);
  });

  it("allows allowlisted emails regardless of case or surrounding whitespace", () => {
    const allowlist = parseAllowedEmails(
      "tim@committedcitizens.co.uk,ben@committedcitizens.co.uk",
    );
    expect(isEmailAllowlisted("TIM@committedcitizens.co.uk ", allowlist)).toBe(
      true,
    );
    expect(isEmailAllowlisted("ben@committedcitizens.co.uk", allowlist)).toBe(
      true,
    );
  });

  it("denies non-allowlisted emails", () => {
    const allowlist = parseAllowedEmails(
      "tim@committedcitizens.co.uk,ben@committedcitizens.co.uk",
    );
    expect(isEmailAllowlisted("stranger@example.com", allowlist)).toBe(false);
    expect(isEmailAllowlisted(null, allowlist)).toBe(false);
    expect(isEmailAllowlisted("", allowlist)).toBe(false);
  });

  it("fails closed when allowlist is empty", () => {
    expect(isEmailAllowlisted("tim@committedcitizens.co.uk", [])).toBe(false);
    expect(parseAllowedEmails("")).toEqual([]);
    expect(parseAllowedEmails(undefined)).toEqual([]);
  });
});
