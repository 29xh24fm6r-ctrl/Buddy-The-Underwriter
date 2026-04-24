import test from "node:test";
import assert from "node:assert/strict";

import {
  evaluateBuddySbaEligibility,
  type BuddyEligibilityInputs,
} from "../eligibility/evaluate";
import {
  evaluateSizeStandard,
  lookupSizeStandard,
  SIZE_STANDARDS_TOP_50,
} from "../eligibility/sbaSizeStandards";

function baseInputs(overrides: Partial<BuddyEligibilityInputs> = {}): BuddyEligibilityInputs {
  return {
    naics: "722513", // limited-service restaurants (revenue threshold $12.5M)
    industry: "Food service",
    businessEntityType: "LLC",
    annualRevenueUsd: 2_000_000,
    employeeCount: 25,
    useOfProceeds: [{ category: "equipment", amount: 100_000 }],
    sourcesAndUses: null,
    isFranchise: false,
    franchiseSbaEligible: null,
    franchiseSbaCertificationStatus: null,
    hardBlockers: [],
    ...overrides,
  };
}

// ─── 9 categories present ──────────────────────────────────────────────

test("eligibility engine returns at least 9 named checks for a standard deal", () => {
  const result = evaluateBuddySbaEligibility(baseInputs());
  assert.ok(result.checks.length >= 9, `expected >=9 checks, got ${result.checks.length}`);
  const names = new Set(result.checks.map((c) => c.check));
  // 9-category framework — at least one check from each.
  assert.ok(names.has("for_profit"));
  assert.ok(names.has("size_standard"));
  assert.ok(names.has("use_of_proceeds"));
  assert.ok(names.has("franchise_sba_eligible"));
  assert.ok(names.has("hard_blockers"));
  assert.ok(names.has("passive_business"));
  assert.ok(names.has("real_estate_speculation"));
  assert.ok(names.has("pyramid_mlm"));
  assert.ok(names.has("lending_investment"));
});

test("every check carries a SOP reference", () => {
  const result = evaluateBuddySbaEligibility(baseInputs());
  for (const check of result.checks) {
    assert.ok(check.sopReference && check.sopReference.startsWith("SOP 50 10 7.1"),
      `check ${check.check} missing SOP reference: ${check.sopReference}`);
  }
});

// ─── Happy path: clean deal passes ─────────────────────────────────────

test("happy path: standard LLC, restaurant, $2M revenue, no flags → passed=true", () => {
  const result = evaluateBuddySbaEligibility(baseInputs());
  assert.equal(result.passed, true, `failures: ${JSON.stringify(result.failures)}`);
  assert.equal(result.failures.length, 0);
});

// ─── 1. For-profit ─────────────────────────────────────────────────────

test("for-profit: nonprofit entity type fails", () => {
  const r = evaluateBuddySbaEligibility(baseInputs({ businessEntityType: "NONPROFIT" }));
  assert.equal(r.passed, false);
  assert.ok(r.failures.some((f) => f.check === "for_profit"));
});

test("for-profit: 501c3 fails", () => {
  const r = evaluateBuddySbaEligibility(baseInputs({ businessEntityType: "501c3" }));
  assert.equal(r.passed, false);
  assert.ok(r.failures.some((f) => f.check === "for_profit"));
});

test("for-profit: missing entity type produces for_profit_unknown failure", () => {
  const r = evaluateBuddySbaEligibility(baseInputs({ businessEntityType: null }));
  assert.ok(r.failures.some((f) => f.check === "for_profit_unknown"));
});

// ─── 2. Size standard: default-deny on unknown NAICS (EXPLICIT TEST) ──

test("size-standard: unknown NAICS defaults to FAIL with 'manual review required' reason", () => {
  const r = evaluateBuddySbaEligibility(baseInputs({ naics: "999999" }));
  assert.equal(r.passed, false);
  const failure = r.failures.find((f) => f.check === "size_standard");
  assert.ok(failure, "expected size_standard failure on unknown NAICS");
  assert.match(failure!.reason, /not in current size-standard table/i);
  assert.match(failure!.reason, /manual review required/i);
});

test("size-standard: null NAICS also defaults to FAIL (not silent pass)", () => {
  const r = evaluateBuddySbaEligibility(baseInputs({ naics: null }));
  const failure = r.failures.find((f) => f.check === "size_standard");
  assert.ok(failure);
  assert.match(failure!.reason, /not in current size-standard table/i);
});

test("size-standard: known revenue-based NAICS under threshold passes", () => {
  const r = evaluateBuddySbaEligibility(baseInputs({
    naics: "722513",
    annualRevenueUsd: 5_000_000,
  }));
  const check = r.checks.find((c) => c.check === "size_standard")!;
  assert.equal(check.passed, true);
});

test("size-standard: known revenue-based NAICS over threshold fails", () => {
  const r = evaluateBuddySbaEligibility(baseInputs({
    naics: "722513",
    annualRevenueUsd: 50_000_000,
  }));
  const check = r.checks.find((c) => c.check === "size_standard")!;
  assert.equal(check.passed, false);
  assert.ok(r.failures.some((f) => f.check === "size_standard"));
});

test("size-standard: employee-based NAICS uses employee count, not revenue", () => {
  const underEmployees = evaluateBuddySbaEligibility(baseInputs({
    naics: "332710", // machine shops — 500-employee standard
    annualRevenueUsd: 999_999_999, // huge revenue irrelevant
    employeeCount: 100,
  }));
  assert.equal(
    underEmployees.checks.find((c) => c.check === "size_standard")!.passed,
    true,
  );

  const overEmployees = evaluateBuddySbaEligibility(baseInputs({
    naics: "332710",
    annualRevenueUsd: 100,
    employeeCount: 2000,
  }));
  assert.equal(
    overEmployees.checks.find((c) => c.check === "size_standard")!.passed,
    false,
  );
});

test("size-standard: entry present but observed value missing fails with explanation", () => {
  const r = evaluateSizeStandard({
    naics: "722513",
    annualRevenueUsd: null,
    employeeCount: null,
  });
  assert.equal(r.passed, false);
  assert.match(r.reason, /value not provided/i);
});

// ─── 3. Use of proceeds ────────────────────────────────────────────────

test("use_of_proceeds: gambling string triggers failure", () => {
  const r = evaluateBuddySbaEligibility(baseInputs({
    useOfProceeds: [{ category: "gambling operations" }],
  }));
  assert.ok(r.failures.some((f) => f.check === "use_of_proceeds"));
});

test("use_of_proceeds: speculation language fails", () => {
  const r = evaluateBuddySbaEligibility(baseInputs({
    useOfProceeds: ["real estate speculation play"],
  }));
  assert.ok(r.failures.some((f) => f.check === "use_of_proceeds"));
});

test("use_of_proceeds: clean UOP with equipment passes", () => {
  const r = evaluateBuddySbaEligibility(baseInputs({
    useOfProceeds: [{ category: "equipment", amount: 100_000 }, { category: "working capital", amount: 50_000 }],
  }));
  const check = r.checks.find((c) => c.check === "use_of_proceeds")!;
  assert.equal(check.passed, true);
});

test("use_of_proceeds: missing UOP produces unknown failure", () => {
  const r = evaluateBuddySbaEligibility(baseInputs({
    useOfProceeds: null,
    sourcesAndUses: null,
  }));
  assert.ok(r.failures.some((f) => f.check === "use_of_proceeds_unknown"));
});

// ─── 4. Franchise SBA-eligibility ──────────────────────────────────────

test("franchise: eligible + certified passes", () => {
  const r = evaluateBuddySbaEligibility(baseInputs({
    isFranchise: true,
    franchiseSbaEligible: true,
    franchiseSbaCertificationStatus: "certified",
  }));
  const check = r.checks.find((c) => c.check === "franchise_sba_eligible")!;
  assert.equal(check.passed, true);
});

test("franchise: not eligible fails", () => {
  const r = evaluateBuddySbaEligibility(baseInputs({
    isFranchise: true,
    franchiseSbaEligible: false,
    franchiseSbaCertificationStatus: "not_listed",
  }));
  assert.ok(r.failures.some((f) => f.check === "franchise_sba_eligible"));
});

test("franchise: non-franchise deal skips the check (passed=true, N/A detail)", () => {
  const r = evaluateBuddySbaEligibility(baseInputs({ isFranchise: false }));
  const check = r.checks.find((c) => c.check === "franchise_sba_eligible")!;
  assert.equal(check.passed, true);
  assert.match(check.detail!, /not applicable/i);
});

// ─── 5. Hard blockers ──────────────────────────────────────────────────

test("hard_blockers: empty array → passed", () => {
  const r = evaluateBuddySbaEligibility(baseInputs({ hardBlockers: [] }));
  const check = r.checks.find((c) => c.check === "hard_blockers")!;
  assert.equal(check.passed, true);
});

test("hard_blockers: each blocker becomes an individual failure entry", () => {
  const r = evaluateBuddySbaEligibility(baseInputs({
    hardBlockers: ["high industry default + startup", "passive income primary"],
  }));
  const perBlocker = r.failures.filter((f) => f.category === "hard_blocker");
  assert.equal(perBlocker.length, 2);
});

// ─── 9. Lending / investment ───────────────────────────────────────────

test("lending_investment: NAICS 522 triggers failure even if NAICS isn't in top-50", () => {
  const r = evaluateBuddySbaEligibility(baseInputs({
    naics: "522110",
    annualRevenueUsd: 100_000,
  }));
  assert.ok(r.failures.some((f) => f.check === "lending_investment"));
});

test("lending_investment: non-lending NAICS passes that check", () => {
  const r = evaluateBuddySbaEligibility(baseInputs({ naics: "722513" }));
  const check = r.checks.find((c) => c.check === "lending_investment")!;
  assert.equal(check.passed, true);
});

// ─── 7. Real-estate speculation scaffolded behavior ────────────────────

test("real_estate_speculation: 531* NAICS + 'speculative' in UOP fails", () => {
  const r = evaluateBuddySbaEligibility(baseInputs({
    naics: "531110",
    useOfProceeds: ["acquire property for speculative flip"],
  }));
  assert.ok(r.failures.some((f) => f.check === "real_estate_speculation"));
});

// ─── Size-standard table integrity ─────────────────────────────────────

test("SIZE_STANDARDS_TOP_50 is indexed without collisions", () => {
  const seen = new Set<string>();
  for (const entry of SIZE_STANDARDS_TOP_50) {
    assert.equal(seen.has(entry.naics), false, `duplicate NAICS: ${entry.naics}`);
    seen.add(entry.naics);
  }
  assert.ok(SIZE_STANDARDS_TOP_50.length >= 40,
    `top-50 placeholder should have at least 40 entries, has ${SIZE_STANDARDS_TOP_50.length}`);
});

test("lookupSizeStandard: known NAICS returns entry, unknown returns null", () => {
  assert.ok(lookupSizeStandard("722513"));
  assert.equal(lookupSizeStandard("999999"), null);
  assert.equal(lookupSizeStandard(null), null);
  assert.equal(lookupSizeStandard(""), null);
});
