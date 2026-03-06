/**
 * Proof-of-Correctness — Reasonableness Engine
 *
 * Hard failures (IMPOSSIBLE) and soft warnings (ANOMALOUS) for extracted facts.
 * Optionally calibrated by industry profile (Phase 6).
 * Pure function — no DB calls.
 */

import type { IndustryProfile } from "@/lib/industryIntelligence/types";

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
 * @param industryProfile - Optional industry profile for calibrated norms
 */
export function checkReasonableness(
  facts: FactMap,
  formType: string,
  priorYearFacts?: FactMap,
  industryProfile?: IndustryProfile,
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
  const salariesWages = val(facts, "SALARIES_WAGES");
  const accountsReceivable = val(facts, "ACCOUNTS_RECEIVABLE");

  // Resolve thresholds from industry profile or broad defaults
  const officerCompUpper = industryProfile
    ? industryProfile.officerCompNormal.max
    : 0.5;
  const officerCompLower = industryProfile
    ? industryProfile.officerCompNormal.min
    : 0.02;

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

  // OFFICER_COMP_EXTREME: using industry-calibrated or default thresholds
  if (officerComp !== null && grossReceipts !== null && grossReceipts > 0) {
    const upperThreshold = grossReceipts * officerCompUpper;
    const lowerThreshold = grossReceipts * officerCompLower;
    const outOfRange = officerComp > upperThreshold || officerComp < lowerThreshold;
    results.push({
      checkId: "OFFICER_COMP_EXTREME",
      severity: "ANOMALOUS",
      description: `Officer compensation outside ${(officerCompLower * 100).toFixed(0)}%-${(officerCompUpper * 100).toFixed(0)}% of revenue range`,
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

  // --- Industry-specific checks (when profile provided) ---

  if (industryProfile) {
    // Interest-in-COGS warning
    if (
      industryProfile.interestInCogs &&
      interestExpense === null &&
      cogs !== null &&
      cogs > 0
    ) {
      results.push({
        checkId: "INDUSTRY_INTEREST_IN_COGS",
        severity: "ANOMALOUS",
        description: `Industry profile indicates interest may be embedded in COGS (${industryProfile.interestInCogsNote})`,
        value: cogs,
        threshold: null,
        passed: true, // warning only, not a failure
      });
    }

    // Evaluate profile red flags from available facts
    if (grossReceipts !== null && grossReceipts > 0) {
      // Gross margin checks
      if (grossProfit !== null) {
        const grossMargin = grossProfit / grossReceipts;

        for (const flag of industryProfile.redFlags) {
          if (flag.id === "MARITIME_MARGIN_LOW" && grossMargin < 0.35) {
            results.push({
              checkId: flag.id,
              severity: "ANOMALOUS",
              description: flag.description,
              value: grossMargin,
              threshold: 0.35,
              passed: false,
            });
          }
          if (flag.id === "CONST_MARGIN_LOW" && grossMargin < 0.12) {
            results.push({
              checkId: flag.id,
              severity: "ANOMALOUS",
              description: flag.description,
              value: grossMargin,
              threshold: 0.12,
              passed: false,
            });
          }
        }
      }

      for (const flag of industryProfile.redFlags) {
        // REST_FOOD_COST_HIGH: COGS / revenue > 0.42
        if (flag.id === "REST_FOOD_COST_HIGH" && cogs !== null && cogs / grossReceipts > 0.42) {
          results.push({
            checkId: flag.id,
            severity: "ANOMALOUS",
            description: flag.description,
            value: cogs / grossReceipts,
            threshold: 0.42,
            passed: false,
          });
        }

        // REST_LABOR_HIGH: salaries / revenue > 0.35
        if (flag.id === "REST_LABOR_HIGH" && salariesWages !== null && salariesWages / grossReceipts > 0.35) {
          results.push({
            checkId: flag.id,
            severity: "ANOMALOUS",
            description: flag.description,
            value: salariesWages / grossReceipts,
            threshold: 0.35,
            passed: false,
          });
        }

        // REST_PRIME_COST_HIGH: (COGS + labor) / revenue > 0.70
        if (flag.id === "REST_PRIME_COST_HIGH" && cogs !== null && salariesWages !== null && (cogs + salariesWages) / grossReceipts > 0.70) {
          results.push({
            checkId: flag.id,
            severity: "ANOMALOUS",
            description: flag.description,
            value: (cogs + salariesWages) / grossReceipts,
            threshold: 0.70,
            passed: false,
          });
        }

        // MARITIME_COGS_NO_INTEREST
        if (flag.id === "MARITIME_COGS_NO_INTEREST" && cogs !== null && cogs > 0 && interestExpense === null) {
          results.push({
            checkId: flag.id,
            severity: "ANOMALOUS",
            description: flag.description,
            value: cogs,
            threshold: null,
            passed: false,
          });
        }

        // MEDICAL_AR_HIGH: AR > revenue / 3
        if (flag.id === "MEDICAL_AR_HIGH" && accountsReceivable !== null && accountsReceivable > grossReceipts / 3) {
          results.push({
            checkId: flag.id,
            severity: "ANOMALOUS",
            description: flag.description,
            value: accountsReceivable,
            threshold: grossReceipts / 3,
            passed: false,
          });
        }

        // MEDICAL_COMP_EXTREME: officer comp > revenue * 0.65
        if (flag.id === "MEDICAL_COMP_EXTREME" && officerComp !== null && officerComp > grossReceipts * 0.65) {
          results.push({
            checkId: flag.id,
            severity: "ANOMALOUS",
            description: flag.description,
            value: officerComp,
            threshold: grossReceipts * 0.65,
            passed: false,
          });
        }

        // RE_MORTGAGE_HEAVY: interest > (OBI + interest) * 0.40
        if (flag.id === "RE_MORTGAGE_HEAVY" && interestExpense !== null && obi !== null && interestExpense > (obi + interestExpense) * 0.40) {
          results.push({
            checkId: flag.id,
            severity: "ANOMALOUS",
            description: flag.description,
            value: interestExpense,
            threshold: (obi + interestExpense) * 0.40,
            passed: false,
          });
        }

        // PROSERV_DSO_HIGH: AR / (revenue / 365) > 90
        if (flag.id === "PROSERV_DSO_HIGH" && accountsReceivable !== null && accountsReceivable / (grossReceipts / 365) > 90) {
          results.push({
            checkId: flag.id,
            severity: "ANOMALOUS",
            description: flag.description,
            value: accountsReceivable / (grossReceipts / 365),
            threshold: 90,
            passed: false,
          });
        }

        // RETAIL_INVENTORY_HIGH: inventory > COGS / 4
        if (flag.id === "RETAIL_INVENTORY_HIGH" && cogs !== null && cogs > 0) {
          const inventory = val(facts, "INVENTORY");
          if (inventory !== null && inventory > cogs / 4) {
            results.push({
              checkId: flag.id,
              severity: "ANOMALOUS",
              description: flag.description,
              value: inventory,
              threshold: cogs / 4,
              passed: false,
            });
          }
        }
      }
    }
  }

  return results;
}
