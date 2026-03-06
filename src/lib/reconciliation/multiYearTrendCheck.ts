import type { ReconciliationCheck } from "./types";
import type { IndustryProfile } from "@/lib/industryIntelligence/types";

/**
 * Flag extreme multi-year revenue swings.
 * Pure function — no DB.
 */
export function checkMultiYearTrend(params: {
  currentRevenue: number | null;
  priorRevenue: number | null;
  currentYear: number;
  priorYear: number;
  industryProfile?: IndustryProfile | null;
}): ReconciliationCheck {
  const { currentRevenue, priorRevenue, currentYear, priorYear } = params;

  if (currentRevenue === null || priorRevenue === null) {
    const missing = currentRevenue === null
      ? `${currentYear} revenue`
      : `${priorYear} revenue`;
    return {
      checkId: "MULTI_YEAR_TREND",
      description: `Revenue trend ${priorYear} → ${currentYear}`,
      status: "SKIPPED",
      severity: "SOFT",
      skipReason: `Missing ${missing}`,
      lhsLabel: `Revenue ${currentYear}`,
      lhsValue: null,
      rhsLabel: `Revenue ${priorYear}`,
      rhsValue: null,
      delta: null,
      toleranceAmount: null,
      notes: "",
    };
  }

  if (priorRevenue === 0) {
    return {
      checkId: "MULTI_YEAR_TREND",
      description: `Revenue trend ${priorYear} → ${currentYear}`,
      status: "SKIPPED",
      severity: "SOFT",
      skipReason: "Prior year revenue is zero — cannot compute percentage change",
      lhsLabel: `Revenue ${currentYear}`,
      lhsValue: currentRevenue,
      rhsLabel: `Revenue ${priorYear}`,
      rhsValue: priorRevenue,
      delta: null,
      toleranceAmount: null,
      notes: "",
    };
  }

  const pctChange = (currentRevenue - priorRevenue) / priorRevenue;
  const threshold = 0.50;
  const delta = currentRevenue - priorRevenue; // signed — direction matters
  const passed = Math.abs(pctChange) <= threshold;

  const direction = pctChange >= 0 ? "grew" : "declined";
  const pctStr = (Math.abs(pctChange) * 100).toFixed(1);

  return {
    checkId: "MULTI_YEAR_TREND",
    description: `Revenue trend ${priorYear} → ${currentYear}`,
    status: passed ? "PASSED" : "FAILED",
    severity: "SOFT",
    lhsLabel: `Revenue ${currentYear}`,
    lhsValue: currentRevenue,
    rhsLabel: `Revenue ${priorYear}`,
    rhsValue: priorRevenue,
    delta,
    toleranceAmount: priorRevenue * threshold,
    notes: passed
      ? `Revenue ${direction} ${pctStr}% from ${priorYear} to ${currentYear}.`
      : `Revenue ${direction} ${pctStr}% from ${priorYear} to ${currentYear}. Verify with borrower explanation.`,
  };
}
