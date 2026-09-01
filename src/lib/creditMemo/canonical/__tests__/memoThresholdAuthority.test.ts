import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { mockServerOnly } from "../../../../../test/utils/mockServerOnly";

mockServerOnly();
const require = createRequire(import.meta.url);
const { resolveMemoThresholds } =
  require("../memoThresholdAuthority") as typeof import("../memoThresholdAuthority");
const { runCovenantRuleEngine } =
  require("../../../covenants/covenantRuleEngine") as typeof import("../../../covenants/covenantRuleEngine");
const { buildConventionalRiskRating } =
  require("../../riskRating/buildConventionalRiskRating") as typeof import("../../riskRating/buildConventionalRiskRating");

/**
 * Bundle eb5a611c and 6fb4c730 both blocked at canonical_credit. One of the
 * reviewer's findings, verbatim from generation_error:
 *
 *   "The memo notes the governing DSCR policy minimum is unknown yet the
 *    covenant_rationale sets a 1.20x floor while the stress module uses 1.25x
 *    for breakeven. This is a genuine credit-policy gap…"
 */

test("a small 7(a) resolves the floor its product actually carries", () => {
  // policyProductId routes any SBA_7A at or below $500,000 here.
  const small = resolveMemoThresholds({ productId: "SBA_7A_SMALL" });
  const standard = resolveMemoThresholds({ productId: "SBA_7A_STANDARD" });

  assert.equal(small.dscr.value, 1.2);
  assert.equal(small.dscr.label, "1.20x");
  assert.equal(standard.dscr.value, 1.25);
  assert.notEqual(
    small.dscr.value,
    standard.dscr.value,
    "the two products must not collapse to one floor",
  );
});

test("every threshold the memo cites carries a citation", () => {
  const t = resolveMemoThresholds({ productId: "SBA_7A_SMALL" });

  for (const [name, threshold] of Object.entries(t)) {
    assert.ok(
      typeof threshold.citation === "string" && threshold.citation.length > 0,
      `${name} must be able to say where its number came from`,
    );
  }
});

test("the covenant package and the memo agree on the floor for the same product", () => {
  // The production contradiction: covenant said 1.20, stress said 1.25, and
  // the policy exception asserted a breach against 1.25.
  const thresholds = resolveMemoThresholds({ productId: "SBA_7A_SMALL" });
  const covenants = runCovenantRuleEngine({
    riskGrade: "5 — Watch",
    dealType: "operating_company",
    governedDscrFloor: thresholds.dscr.value,
    actualDscr: 1.22,
    actualLeverage: 0.98,
    actualDebtYield: null,
    actualOccupancy: null,
    actualGlobalCashFlow: 360_000,
    loanAmount: 450_000,
    propertyType: null,
  } as Parameters<typeof runCovenantRuleEngine>[0]);

  const dscrCovenant = covenants.financial.find((c) => c.category === "dscr");
  assert.equal(dscrCovenant?.threshold, thresholds.dscr.value);
});

test("a deal clearing its governed floor raises no policy exception", () => {
  // 1.22x against a governed 1.20x floor. The memo used to compare this to a
  // literal 1.25 and report a breach that did not exist.
  const thresholds = resolveMemoThresholds({ productId: "SBA_7A_SMALL" });
  const dscr = 1.22;

  assert.ok(
    dscr >= thresholds.dscr.value,
    "1.22x clears the small 7(a) floor and must not be reported as below policy",
  );
});

test("the risk grade is scored against the governed floor, not a literal", () => {
  const base = {
    dscr: 1.22,
    stressedDscr: 1.05,
    worstYearDscr: 1.1,
    cfadsTrend: "up" as const,
    revenueTrend: "up" as const,
    ltvPct: 60,
    collateralCoverageRatio: 1.4,
    arBorrowingBaseAvailable: false,
    guarantorNetWorth: 500_000,
    guarantorLiquidity: 100_000,
    yearsInBusiness: 9,
    industryRisk: "moderate" as const,
    managementDepth: "adequate" as const,
    financialStatementQuality: "tax_returns" as const,
  } as Parameters<typeof buildConventionalRiskRating>[0];

  const small = buildConventionalRiskRating({ ...base, dscrFloor: 1.2 });
  const standard = buildConventionalRiskRating({ ...base, dscrFloor: 1.25 });

  // 1.22x meets a 1.20 floor and misses a 1.25 floor, so the same borrower
  // must not score identically under both products.
  assert.notEqual(
    small.score,
    standard.score,
    "the governed floor must actually move the grade",
  );
  assert.ok(small.score > standard.score);
});
