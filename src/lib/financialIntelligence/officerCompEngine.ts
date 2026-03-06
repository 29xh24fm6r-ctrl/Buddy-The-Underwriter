/**
 * Financial Intelligence Layer — Officer Compensation Engine
 *
 * Analyzes officer compensation relative to revenue and flags extremes.
 * Pure function — no DB, no server-only.
 */

export type OfficerCompAnalysis = {
  reportedOfficerComp: number | null;
  reportedRevenue: number | null;
  compAsPercentOfRevenue: number | null;
  flag: "EXTREME_HIGH" | "EXTREME_LOW" | "NORMAL" | "INSUFFICIENT_DATA";
  marketRateEstimate: number | null;
  excessComp: number | null;
  adjustedEbitdaImpact: number | null;
  notes: string;
};

type FactMap = Record<string, number | null>;

function val(facts: FactMap, key: string): number | null {
  const v = facts[key];
  return v === undefined ? null : v;
}

export function analyzeOfficerComp(
  facts: FactMap,
  formType: string,
): OfficerCompAnalysis {
  const grossReceipts = val(facts, "GROSS_RECEIPTS");

  // For Form 1065, use GUARANTEED_PAYMENTS as officer comp proxy when OFFICER_COMPENSATION is null
  let officerComp = val(facts, "OFFICER_COMPENSATION");
  if (officerComp === null && formType === "FORM_1065") {
    officerComp = val(facts, "GUARANTEED_PAYMENTS");
  }

  // Insufficient data check
  if (officerComp === null || grossReceipts === null || grossReceipts === 0) {
    return {
      reportedOfficerComp: officerComp,
      reportedRevenue: grossReceipts,
      compAsPercentOfRevenue: null,
      flag: "INSUFFICIENT_DATA",
      marketRateEstimate: null,
      excessComp: null,
      adjustedEbitdaImpact: null,
      notes:
        officerComp === null
          ? "Officer compensation not available for analysis."
          : "Revenue is zero or unavailable — cannot compute compensation ratio.",
    };
  }

  const pct = officerComp / grossReceipts;
  const marketRateEstimate = grossReceipts * 0.10;

  // EXTREME_HIGH: > 40%
  if (pct > 0.40) {
    const excessComp = officerComp - marketRateEstimate;
    return {
      reportedOfficerComp: officerComp,
      reportedRevenue: grossReceipts,
      compAsPercentOfRevenue: pct,
      flag: "EXTREME_HIGH",
      marketRateEstimate,
      excessComp,
      adjustedEbitdaImpact: excessComp,
      notes:
        "Officer compensation exceeds 40% of revenue. May indicate above-market pay in closely-held entity. Excess over 10% market rate shown as potential add-back.",
    };
  }

  // EXTREME_LOW: < 2%
  if (pct < 0.02) {
    return {
      reportedOfficerComp: officerComp,
      reportedRevenue: grossReceipts,
      compAsPercentOfRevenue: pct,
      flag: "EXTREME_LOW",
      marketRateEstimate,
      excessComp: null,
      adjustedEbitdaImpact: null,
      notes:
        "Officer compensation below 2% of revenue. Owner may be taking distributions instead of salary. Personal cash flow likely higher than entity return indicates.",
    };
  }

  // NORMAL
  return {
    reportedOfficerComp: officerComp,
    reportedRevenue: grossReceipts,
    compAsPercentOfRevenue: pct,
    flag: "NORMAL",
    marketRateEstimate,
    excessComp: null,
    adjustedEbitdaImpact: null,
    notes: "",
  };
}
