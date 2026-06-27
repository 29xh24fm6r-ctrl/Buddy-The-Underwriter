/**
 * SPEC-BUDDY-FINANCIAL-ENGINE-ELITE-1 — Phase 6: Covenant & Monitoring engine.
 *
 * Recommends and monitors DSCR / FCCR / leverage / min-liquidity covenants plus
 * the reporting package (borrowing-base cadence, AR aging, financial-statement
 * and tax-return delivery, collateral audit, appraisal updates, guarantor PFS
 * refresh, and negative covenants). Maintenance vs incurrence testing with a
 * cushion, and equity-cure handling. Thresholds resolve from the registry (NG4).
 * Pure — no DB.
 */

import type { PolicyContext } from "@/lib/finengine/contracts";
import { resolvePolicy } from "@/lib/finengine/policyRegistry";

export type CovenantType = "DSCR" | "FCCR" | "LEVERAGE" | "MIN_LIQUIDITY";
export type CovenantTest = "maintenance" | "incurrence";
export type Covenant = {
  name: CovenantType;
  direction: "floor" | "cap";
  threshold: number;
  test: CovenantTest;
  /** Cushion below/above the underwriting metric used to set the covenant. */
  cushion: number;
  citation: string;
  note: string;
};

export type CovenantRecommendationInputs = {
  productId?: string;
  /** Underwritten DSCR / leverage at close, used to set a cushioned covenant. */
  underwrittenDscr?: number | null;
  underwrittenLeverage?: number | null;
  minLiquidity?: number | null;
  ctx?: PolicyContext;
};

/** Recommend the financial covenant package, cushioned off the registry floors. */
export function recommendCovenants(i: CovenantRecommendationInputs): Covenant[] {
  const ctx = { ...i.ctx, productId: i.productId };
  const out: Covenant[] = [];

  const dscrFloor = resolvePolicy("dscr_floor", ctx);
  if (dscrFloor.effective != null) {
    // Set the covenant at the policy floor, or 0.10x below the underwriting
    // DSCR if that is tighter — whichever is more protective (higher).
    const cushioned = i.underwrittenDscr != null ? Math.max(dscrFloor.effective, i.underwrittenDscr - 0.1) : dscrFloor.effective;
    out.push({ name: "DSCR", direction: "floor", threshold: Number(cushioned.toFixed(2)), test: "maintenance", cushion: 0.1, citation: dscrFloor.citation, note: "Maintenance DSCR tested quarterly." });
  }

  const fccrFloor = resolvePolicy("fccr_floor", ctx);
  if (fccrFloor.effective != null) {
    out.push({ name: "FCCR", direction: "floor", threshold: fccrFloor.effective, test: "maintenance", cushion: 0.1, citation: fccrFloor.citation, note: "Fixed-charge coverage tested quarterly." });
  }

  const levCap = resolvePolicy("leverage_max", ctx);
  if (levCap.effective != null) {
    const cushioned = i.underwrittenLeverage != null ? Math.min(levCap.effective, i.underwrittenLeverage + 0.5) : levCap.effective;
    out.push({ name: "LEVERAGE", direction: "cap", threshold: Number(cushioned.toFixed(2)), test: "incurrence", cushion: 0.5, citation: levCap.citation, note: "Leverage incurrence test on new debt." });
  }

  if (i.minLiquidity != null) {
    out.push({ name: "MIN_LIQUIDITY", direction: "floor", threshold: i.minLiquidity, test: "maintenance", cushion: 0, citation: "Institutional minimum liquidity overlay", note: "Minimum liquidity maintained at all times." });
  }

  return out;
}

export type CovenantTestResult = {
  covenant: CovenantType;
  actual: number | null;
  threshold: number;
  inCompliance: boolean | null;
  /** Headroom: positive => cushion remaining; negative => breach magnitude. */
  headroom: number | null;
  curedByEquity: boolean;
  note: string;
};

/** Test a covenant against an actual value, with optional equity-cure. */
export function testCovenant(c: Covenant, actual: number | null, equityCure?: number): CovenantTestResult {
  if (actual == null) {
    return { covenant: c.name, actual, threshold: c.threshold, inCompliance: null, headroom: null, curedByEquity: false, note: "No actual value." };
  }
  let effectiveActual = actual;
  let curedByEquity = false;
  // Equity cure: a cash equity injection is treated as added EBITDA/cash for the
  // coverage/leverage test (for floors it raises the actual; for caps it lowers).
  if (equityCure && equityCure > 0) {
    effectiveActual = c.direction === "floor" ? actual + equityCure : Math.max(0, actual - equityCure);
    curedByEquity = true;
  }
  const inCompliance = c.direction === "floor" ? effectiveActual >= c.threshold : effectiveActual <= c.threshold;
  const headroom = c.direction === "floor" ? effectiveActual - c.threshold : c.threshold - effectiveActual;
  return {
    covenant: c.name,
    actual,
    threshold: c.threshold,
    inCompliance,
    headroom,
    curedByEquity,
    note: inCompliance ? "In compliance." : curedByEquity ? "Cured by equity injection." : "BREACH.",
  };
}

// ---- Reporting / monitoring package ---------------------------------------

export type MonitoringRequirement = { item: string; cadence: string; citation: string };

export function recommendMonitoringPackage(productId?: string): MonitoringRequirement[] {
  const pkg: MonitoringRequirement[] = [
    { item: "Financial statements", cadence: "annual (audited/reviewed per size)", citation: "Loan agreement reporting covenants" },
    { item: "Business tax returns", cadence: "annual within 30 days of filing", citation: "Loan agreement" },
    { item: "Guarantor PFS + tax returns", cadence: "annual", citation: "Loan agreement" },
    { item: "Covenant compliance certificate", cadence: "quarterly", citation: "Loan agreement" },
  ];
  if (productId === "ABL_REVOLVER" || productId === "WORKING_CAPLINE") {
    pkg.push({ item: "Borrowing-base certificate", cadence: "monthly (weekly if availability tight)", citation: "ABL agreement" });
    pkg.push({ item: "AR aging + inventory report", cadence: "monthly", citation: "ABL agreement" });
    pkg.push({ item: "Collateral field exam / audit", cadence: "annual", citation: "ABL agreement" });
  }
  if (productId === "CRE_OWNER_OCC" || productId === "CRE_INVESTOR" || productId === "SBA_504") {
    pkg.push({ item: "Updated appraisal", cadence: "per policy / on material change", citation: "CRE policy" });
    pkg.push({ item: "Rent roll / operating statement", cadence: "annual", citation: "CRE agreement" });
  }
  return pkg;
}
