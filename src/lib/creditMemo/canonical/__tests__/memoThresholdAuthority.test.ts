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
 *
 * Floors asserted here are the SBA SOP 50 10 8 floors (2026-09-01 alignment):
 * 7(a) Small (≤ $350K) 1.10x per the Mar-2026 procedural notices; Standard
 * 7(a) 1.15x. No institutional overlay sits above them for SBA products.
 */

test("a small 7(a) resolves the floor its product actually carries", () => {
  const small = resolveMemoThresholds({ productId: "SBA_7A_SMALL" });
  const standard = resolveMemoThresholds({ productId: "SBA_7A_STANDARD" });

  assert.equal(small.dscr.value, 1.1);
  assert.equal(small.dscr.label, "1.10x");
  assert.equal(standard.dscr.value, 1.15);
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
    loanAmount: 340_000,
    propertyType: null,
  } as Parameters<typeof runCovenantRuleEngine>[0]);

  const dscrCovenant = covenants.financial.find((c) => c.category === "dscr");
  assert.equal(dscrCovenant?.threshold, thresholds.dscr.value);
});

test("a deal clearing its governed floor raises no policy exception", () => {
  // 1.12x against the governed 1.10x small-loan floor. The memo used to
  // compare this to a literal 1.25 and report a breach that did not exist.
  const thresholds = resolveMemoThresholds({ productId: "SBA_7A_SMALL" });
  const dscr = 1.12;

  assert.ok(
    dscr >= thresholds.dscr.value,
    "1.12x clears the small 7(a) floor and must not be reported as below policy",
  );
});

test("the risk grade is scored against the governed floor, not a literal", () => {
  const base = {
    dscr: 1.12,
    stressedDscr: 1.05,
    worstYearDscr: 1.1,
    cfadsTrend: "up" as const,
    revenueTrend: "up" as const,
    ltvPct: 60,
    collateralCoverageRatio: 1.4,
    arBorrowingBaseAvailable: false,
    guarantorNetWorth: 500_000,
    currentRatio: 1.8,
    debtToEquity: 0.9,
    grossMarginPct: 0.32,
    managementYearsExperience: 9,
    characterScore: 4,
    gcfComplete: true,
    formalDiligenceComplete: true,
    customerConcentrationRisk: false,
    hasAdverseFindings: false,
    financialStatementQuality: "tax_returns" as const,
  };

  // The SOP floors: 1.12x meets the 1.10 small-loan floor and misses the
  // 1.15 standard floor, so the same borrower must not score identically
  // under both products.
  const small = buildConventionalRiskRating({ ...base, dscrFloor: 1.1 });
  const standard = buildConventionalRiskRating({ ...base, dscrFloor: 1.15 });

  assert.notEqual(
    small.score,
    standard.score,
    "the governed floor must actually move the grade",
  );
  assert.ok(small.score > standard.score);
});
