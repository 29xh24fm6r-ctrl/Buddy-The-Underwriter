import { describe, expect, it } from "vitest";
import { sanitizeMemoNarrativeText } from "../memoNarrativeTrust";

describe("memoNarrativeTrust", () => {
  it("renders borrower principals by last name instead of first name", () => {
    const result = sanitizeMemoNarrativeText(
      "Matt personally manages major client relationships. Matt turned down 350 seats to protect quality.",
      [{ canonicalName: "Matt Hunt", role: "borrower_principal", preferLastName: true }],
    );

    expect(result.text).toBe(
      "Hunt personally manages major client relationships. Hunt turned down 350 seats to protect quality.",
    );
    expect(result.warnings.map((w) => w.code)).toContain("unresolved_single_name_reference");
  });

  it("flags ambiguous first-name references when multiple people share a first name", () => {
    const result = sanitizeMemoNarrativeText(
      "Matt agreed the Aetna ramp creates cash flow timing risk.",
      [
        { canonicalName: "Matt Hunt", role: "borrower_principal", preferLastName: true },
        { canonicalName: "Matt Paller", role: "banker", preferLastName: true },
      ],
    );

    expect(result.text).toBe("Hunt agreed the Aetna ramp creates cash flow timing risk.");
    expect(result.warnings.some((w) => w.code === "ambiguous_first_name_rewritten")).toBe(true);
  });

  it("rewrites known Old Glory nickname confusion for Mike Ring", () => {
    const result = sanitizeMemoNarrativeText(
      "Referred through Ringer. Mike Ringer discussed the relationship history.",
      [],
    );

    expect(result.text).toBe("Referred through Ring. Mike Ring discussed the relationship history.");
    expect(result.warnings.filter((w) => w.code === "nickname_rewritten")).toHaveLength(2);
  });

  it("removes double punctuation artifacts from transcript narrative", () => {
    const result = sanitizeMemoNarrativeText(
      "All growth is referral-driven — zero outbound sales team.. Growth strategy is organic expansion.",
      [],
    );

    expect(result.text).toBe(
      "All growth is referral-driven — zero outbound sales team. Growth strategy is organic expansion.",
    );
    expect(result.warnings.map((w) => w.code)).toContain("double_punctuation_removed");
  });
});
