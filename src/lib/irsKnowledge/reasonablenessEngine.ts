/**
 * Proof-of-Correctness — Reasonableness Engine
 *
 * Hard failures (IMPOSSIBLE) and soft warnings (ANOMALOUS) for extracted facts.
 * Pure function — no DB calls.
 */

export type ReasonablenessSeverity = "IMPOSSIBLE" | "ANOMALOUS";

export type ReasonablenessCheck = {
  checkId: string;
  severity: ReasonablenessSeverity;
  description: string;
  value: number | null;
  threshold: number | null;
  passed: boolean;
};

type FactMap = Record<string, number | null>;

function val(facts: FactMap, key: string): number | null {
  const v = facts[key];
  return v === undefined ? null : v;
}

/**
 * Run reasonableness checks against extracted facts.
 *
 * IMPOSSIBLE checks that fail = hard failure for the gate.
 * ANOMALOUS checks that fail = score penalty only.
 * Checks where required facts are null are skipped (not emitted).
 *
 * @param facts - Extracted fact map
 * @param formType - IRS form type (unused for now, reserved for form-specific checks)
 * @param priorYearFacts - Prior year facts for year-over-year comparisons
 */
export function checkReasonableness(
  facts: FactMap,
  formType: string,
  priorYearFacts?: FactMap,
): ReasonablenessCheck[] {
  const results: ReasonablenessCheck[] = [];

  const grossReceipts = val(facts, "GROSS_RECEIPTS");
  const cogs = val(facts, "COST_OF_GOODS_SOLD");
  const grossProfit = val(facts, "GROSS_PROFIT");
  const totalAssets = val(facts, "TOTAL_ASSETS");
  const obi = val(facts, "ORDINARY_BUSINESS_INCOME");
  const depreciation = val(facts, "DEPRECIATION");
  const fixedAssetsGross = val(facts, "FIXED_ASSETS_GROSS");
  const officerComp = val(facts, "OFFICER_COMPENSATION");
  const interestExpense = val(facts, "INTEREST_EXPENSE");
  const ltDebt = val(facts, "LT_DEBT");

  // --- Hard failures (IMPOSSIBLE) ---

  // COGS_EXCEEDS_REVENUE: cogs > grossReceipts
  if (cogs !== null && grossReceipts !== null) {
    results.push({
      checkId: "COGS_EXCEEDS_REVENUE",
      severity: "IMPOSSIBLE",
      description: "Cost of goods sold exceeds gross receipts",
      value: cogs,
      threshold: grossReceipts,
      passed: cogs <= grossReceipts,
    });
  }

  // NEGATIVE_TOTAL_ASSETS: totalAssets < 0
  if (totalAssets !== null) {
    results.push({
      checkId: "NEGATIVE_TOTAL_ASSETS",
      severity: "IMPOSSIBLE",
      description: "Total assets is negative",
      value: totalAssets,
      threshold: 0,
      passed: totalAssets >= 0,
    });
  }

  // GROSS_MARGIN_OVER_100: grossProfit > grossReceipts
  if (grossProfit !== null && grossReceipts !== null) {
    results.push({
      checkId: "GROSS_MARGIN_OVER_100",
      severity: "IMPOSSIBLE",
      description: "Gross profit exceeds gross receipts (margin > 100%)",
      value: grossProfit,
      threshold: grossReceipts,
      passed: grossProfit <= grossReceipts,
    });
  }

  // INCOME_WITHOUT_REVENUE: obi > 0 && grossReceipts === 0
  if (obi !== null && grossReceipts !== null) {
    results.push({
      checkId: "INCOME_WITHOUT_REVENUE",
      severity: "IMPOSSIBLE",
      description: "Ordinary business income present but gross receipts is zero",
      value: obi,
      threshold: 0,
      passed: !(obi > 0 && grossReceipts === 0),
    });
  }

  // --- Soft warnings (ANOMALOUS) ---

  // REVENUE_CHANGE_EXTREME: priorYear provided && |yoyChange| > 50%
  if (grossReceipts !== null && priorYearFacts) {
    const priorGR = val(priorYearFacts, "GROSS_RECEIPTS");
    if (priorGR !== null && priorGR !== 0) {
      const yoyChange = Math.abs((grossReceipts - priorGR) / priorGR);
      results.push({
        checkId: "REVENUE_CHANGE_EXTREME",
        severity: "ANOMALOUS",
        description: "Year-over-year revenue change exceeds 50%",
        value: yoyChange,
        threshold: 0.5,
        passed: yoyChange <= 0.5,
      });
    }
  }

  // DEPRECIATION_IMPLAUSIBLE: depreciation > fixedAssetsGross * 0.5
  if (depreciation !== null && fixedAssetsGross !== null) {
    const threshold = fixedAssetsGross * 0.5;
    results.push({
      checkId: "DEPRECIATION_IMPLAUSIBLE",
      severity: "ANOMALOUS",
      description: "Depreciation exceeds 50% of gross fixed assets",
      value: depreciation,
      threshold,
      passed: depreciation <= threshold,
    });
  }

  // OFFICER_COMP_EXTREME: officerComp > revenue * 0.5 || officerComp < revenue * 0.02
  if (officerComp !== null && grossReceipts !== null && grossReceipts > 0) {
    const upperThreshold = grossReceipts * 0.5;
    const lowerThreshold = grossReceipts * 0.02;
    const outOfRange = officerComp > upperThreshold || officerComp < lowerThreshold;
    results.push({
      checkId: "OFFICER_COMP_EXTREME",
      severity: "ANOMALOUS",
      description: "Officer compensation outside 2%-50% of revenue range",
      value: officerComp,
      threshold: upperThreshold,
      passed: !outOfRange,
    });
  }

  // INTEREST_IMPLAUSIBLE: interestExpense > ltDebt * 0.20
  if (interestExpense !== null && ltDebt !== null) {
    const threshold = ltDebt * 0.20;
    results.push({
      checkId: "INTEREST_IMPLAUSIBLE",
      severity: "ANOMALOUS",
      description: "Interest expense exceeds 20% of long-term debt",
      value: interestExpense,
      threshold,
      passed: interestExpense <= threshold,
    });
  }

  return results;
}
