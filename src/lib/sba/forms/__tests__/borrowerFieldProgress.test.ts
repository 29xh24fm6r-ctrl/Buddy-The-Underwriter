import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { computeFieldProgress } from "@/lib/sba/forms/borrowerFieldProgress";
import { BORROWER_FIELD_REGISTRY } from "@/lib/sba/forms/borrowerFieldRegistry";

function baseFacts(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    business: {},
    loan: {},
    owners: [{}],
    entities: [],
    ...overrides,
  };
}

describe("computeFieldProgress", () => {
  // V-B5: no form codes → determinable: false
  test("returns determinable=false when formCodes is empty", () => {
    const result = computeFieldProgress(baseFacts(), []);
    assert.equal(result.determinable, false);
    assert.equal(result.requiredTotal, 0);
  });

  // V-B1: counting required fields for a given form
  test("counts required fields for given form codes", () => {
    const result = computeFieldProgress(baseFacts(), ["1919"]);
    assert.equal(result.determinable, true);
    assert.ok(result.requiredTotal > 0, "should have required fields for form 1919");
  });

  // V-B1: adding a form code can increase the denominator
  test("adding form codes can increase the denominator", () => {
    const r1 = computeFieldProgress(baseFacts(), ["1919"]);
    const r2 = computeFieldProgress(baseFacts(), ["1919", "1244"]);
    assert.ok(r2.requiredTotal >= r1.requiredTotal);
  });

  // V-B3: requiredForForms: [] entries never appear in the denominator
  test("excludes fields with empty requiredForForms", () => {
    const optionalOnly = BORROWER_FIELD_REGISTRY.filter(
      (e) => e.requiredForForms.length === 0,
    );
    assert.ok(optionalOnly.length > 0, "test fixture: should have optional-only fields");

    const allFormCodes = [...new Set(BORROWER_FIELD_REGISTRY.flatMap((e) => e.appliesToForms))];
    const result = computeFieldProgress(baseFacts(), allFormCodes);

    for (const entry of optionalOnly) {
      assert.ok(
        !result.remainingFactPaths.includes(entry.factPath),
        `optional field ${entry.key} should not appear in remaining`,
      );
    }
  });

  // V-B2: two owners produce a larger denominator than one
  test("scales owner-scope fields by owner count", () => {
    const oneOwner = computeFieldProgress(
      baseFacts({ owners: [{ full_name: "Alice" }] }),
      ["1919"],
    );
    const twoOwners = computeFieldProgress(
      baseFacts({ owners: [{ full_name: "Alice" }, { full_name: "Bob" }] }),
      ["1919"],
    );
    assert.ok(
      twoOwners.requiredTotal > oneOwner.requiredTotal,
      `two owners (${twoOwners.requiredTotal}) should exceed one owner (${oneOwner.requiredTotal})`,
    );
  });

  // V-B4: spouse fields excluded until has_spouse is true
  test("excludes spouse-gated fields when has_spouse is false", () => {
    const facts = baseFacts({ owners: [{ has_spouse: false }] });
    const result = computeFieldProgress(facts, ["413"]);
    assert.ok(!result.remainingFactPaths.includes("owner.spouse_full_name"));
  });

  // V-B4: OC fields excluded until is_eligible_passive_company is true
  test("excludes OC fields when is_eligible_passive_company is false", () => {
    const facts = baseFacts({ loan: { is_eligible_passive_company: false } });
    const result = computeFieldProgress(facts, ["1244"]);
    assert.ok(!result.remainingFactPaths.includes("loan.oc_legal_name"));
    assert.ok(!result.remainingFactPaths.includes("loan.oc_address"));
  });

  test("includes OC fields when is_eligible_passive_company is true", () => {
    const facts = baseFacts({ loan: { is_eligible_passive_company: true } });
    const result = computeFieldProgress(facts, ["1244"]);
    assert.ok(
      result.remainingFactPaths.includes("loan.oc_legal_name"),
      "OC fields should be counted when EPC is true",
    );
  });

  // Completion detection
  test("counts a field as complete when value is present", () => {
    const facts = baseFacts({ business: { legal_name: "Acme Corp" } });
    const result = computeFieldProgress(facts, ["1919"]);
    assert.ok(!result.remainingFactPaths.includes("business.legal_name"));
    assert.ok(result.completedCount > 0);
  });

  test("counts a field as incomplete when value is empty string", () => {
    const facts = baseFacts({ business: { legal_name: "" } });
    const result = computeFieldProgress(facts, ["1919"]);
    assert.ok(result.remainingFactPaths.includes("business.legal_name"));
  });

  // PII exclusion
  test("excludes PII vault fields from the denominator", () => {
    const result = computeFieldProgress(baseFacts(), ["912", "4506c", "413"]);
    assert.ok(!result.remainingFactPaths.includes("owner.full_ssn"));
    assert.ok(!result.remainingFactPaths.includes("owner.spouse_full_ssn"));
    assert.ok(result.excluded.includes("pii_vault_unchecked"));
  });

  // Chapter mapping
  test("maps scopes to chapters correctly", () => {
    const result = computeFieldProgress(baseFacts(), ["1919"]);
    assert.ok(result.byChapter[1].total > 0, "loan scope → ch.1");
    assert.ok(result.byChapter[2].total > 0, "business scope → ch.2");
    assert.ok(result.byChapter[3].total > 0, "owner scope → ch.3");
  });

  // PFS schedules noted as excluded
  test("always notes pfs_schedules_unmodeled in excluded", () => {
    const result = computeFieldProgress(baseFacts(), ["413"]);
    assert.ok(result.excluded.includes("pfs_schedules_unmodeled"));
  });

  // Guarantee limit fields conditional on limited guarantor
  test("excludes guarantee_limit fields when no limited guarantor exists", () => {
    const facts = baseFacts({ owners: [{ ownership_pct: 50 }] });
    const result = computeFieldProgress(facts, ["148"]);
    assert.ok(!result.remainingFactPaths.includes("owner.guarantee_limit_balance_under"));
  });

  test("includes guarantee_limitation_type when a limited guarantor exists", () => {
    const facts = baseFacts({ owners: [{ ownership_pct: 10 }] });
    const result = computeFieldProgress(facts, ["148"]);
    assert.ok(result.remainingFactPaths.includes("owner.guarantee_limitation_type"));
  });
});
