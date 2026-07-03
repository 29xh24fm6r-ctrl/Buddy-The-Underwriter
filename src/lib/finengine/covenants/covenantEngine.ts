/**
 * SPEC-BUDDY-FINANCIAL-ENGINE-ELITE-1 — PR 16: Covenant Recommendation & Monitoring.
 *
 * Extends the Phase-6 covenant engine (`covenants/index.ts`, financial covenants
 * + equity-cure testing) to the FULL covenant taxonomy — financial, reporting,
 * and negative covenants — with product/risk-varying packages and a four-state
 * evaluation (pass / warning / breach / no_data) carrying breach severity.
 *
 * Pure — recommends and tests; never enforces, never writes. The existing engine
 * stays the authority for equity-cure financial testing; this layer adds the
 * broader package + the warning band + reporting/negative covenants.
 */

import type { ProductKey } from "@/lib/finengine/registry/productMetricRegistry";

export type ManagedCovenantType =
  | "DSCR"
  | "FCCR"
  | "LEVERAGE"
  | "MIN_LIQUIDITY"
  | "BORROWING_BASE"
  | "AR_AGING"
  | "COLLATERAL_REPORTING"
  | "TAX_RETURN_DELIVERY"
  | "PFS_DELIVERY"
  | "DEPOSIT_COVENANT"
  | "DISTRIBUTION_LIMITATION"
  | "DEBT_LIMITATION";

export type CovenantKind = "financial" | "reporting" | "negative";
export type CovenantDirection = "floor" | "cap" | "event";
export type ReportingFrequency = "monthly" | "quarterly" | "semiannual" | "annual";
export type RiskLevel = "low" | "moderate" | "elevated";

export type ManagedCovenant = {
  type: ManagedCovenantType;
  kind: CovenantKind;
  direction: CovenantDirection;
  /** Numeric threshold for financial covenants. */
  threshold?: number;
  /** Cadence for reporting covenants. */
  cadence?: ReportingFrequency;
  rationale: string;
};

export type CovenantPackageInput = {
  product: ProductKey;
  riskLevel: RiskLevel;
  underwrittenDscr?: number | null;
  underwrittenLeverage?: number | null;
  minLiquidity?: number | null;
};

const RISK_DSCR_CUSHION: Record<RiskLevel, number> = { low: 0.15, moderate: 0.1, elevated: 0.05 };
const RISK_REPORTING: Record<RiskLevel, ReportingFrequency> = { low: "quarterly", moderate: "quarterly", elevated: "monthly" };

const ABL_PRODUCTS: ReadonlySet<ProductKey> = new Set(["AR_REVOLVER", "ABL_REVOLVER", "WORKING_CAPITAL_LINE"]);
const CRE_PRODUCTS: ReadonlySet<ProductKey> = new Set(["CRE_OWNER_OCCUPIED", "CRE_INVESTOR", "SBA_504", "CONSTRUCTION"]);

/** Recommend a covenant package that varies by product AND risk level. */
export function recommendCovenantPackage(input: CovenantPackageInput): ManagedCovenant[] {
  const out: ManagedCovenant[] = [];
  const cushion = RISK_DSCR_CUSHION[input.riskLevel];

  // Financial — DSCR floor cushioned off the underwriting DSCR.
  if (input.underwrittenDscr != null) {
    out.push({
      type: "DSCR",
      kind: "financial",
      direction: "floor",
      threshold: Number(Math.max(1.0, input.underwrittenDscr - cushion).toFixed(2)),
      rationale: `DSCR floor set ${cushion.toFixed(2)} below underwriting (${input.riskLevel} risk).`,
    });
  }
  if (input.underwrittenLeverage != null) {
    out.push({
      type: "LEVERAGE",
      kind: "financial",
      direction: "cap",
      threshold: Number((input.underwrittenLeverage + (input.riskLevel === "elevated" ? 0.25 : 0.5)).toFixed(2)),
      rationale: "Leverage cap on new debt.",
    });
  }
  if (input.minLiquidity != null) {
    out.push({ type: "MIN_LIQUIDITY", kind: "financial", direction: "floor", threshold: input.minLiquidity, rationale: "Minimum liquidity maintained at all times." });
  }
  // FCCR for cash-flow / equipment / franchise / SBA products.
  if (["EQUIPMENT", "FRANCHISE", "SBA_7A", "CI_TERM"].includes(input.product)) {
    out.push({ type: "FCCR", kind: "financial", direction: "floor", threshold: 1.1, rationale: "Fixed-charge coverage for amortizing product." });
  }

  // Reporting — always: tax returns + guarantor PFS.
  out.push({ type: "TAX_RETURN_DELIVERY", kind: "reporting", direction: "event", cadence: "annual", rationale: "Annual business + guarantor tax returns." });
  out.push({ type: "PFS_DELIVERY", kind: "reporting", direction: "event", cadence: "annual", rationale: "Annual guarantor PFS refresh." });

  // Product-specific reporting.
  if (ABL_PRODUCTS.has(input.product)) {
    out.push({ type: "BORROWING_BASE", kind: "reporting", direction: "event", cadence: RISK_REPORTING[input.riskLevel], rationale: "Borrowing-base certificate cadence by risk." });
    out.push({ type: "AR_AGING", kind: "reporting", direction: "event", cadence: RISK_REPORTING[input.riskLevel], rationale: "AR aging with the borrowing base." });
    out.push({ type: "COLLATERAL_REPORTING", kind: "reporting", direction: "event", cadence: "annual", rationale: "Collateral field exam / audit." });
  }
  if (CRE_PRODUCTS.has(input.product)) {
    out.push({ type: "COLLATERAL_REPORTING", kind: "reporting", direction: "event", cadence: "annual", rationale: "Rent roll / operating statement / appraisal updates." });
  }

  // Negative — always debt limitation; elevated risk adds distributions + deposit.
  out.push({ type: "DEBT_LIMITATION", kind: "negative", direction: "cap", rationale: "Limitation on additional indebtedness." });
  if (input.riskLevel !== "low") {
    out.push({ type: "DISTRIBUTION_LIMITATION", kind: "negative", direction: "cap", rationale: "Distributions permitted only if in covenant compliance." });
  }
  if (input.riskLevel === "elevated") {
    out.push({ type: "DEPOSIT_COVENANT", kind: "negative", direction: "event", rationale: "Maintain primary operating deposit relationship." });
  }

  return out;
}

// ── Four-state evaluation ─────────────────────────────────────────────────────

export type CovenantStatus = "pass" | "warning" | "breach" | "no_data";
export type BreachSeverity = "none" | "minor" | "material" | "severe";

export type CovenantEvaluation = {
  type: ManagedCovenantType;
  status: CovenantStatus;
  actual: number | null;
  threshold: number | null;
  headroom: number | null;
  severity: BreachSeverity;
  message: string;
};

/**
 * Evaluate a FINANCIAL covenant against an actual value with a warning band.
 * `warnCushion` (fraction) defines the "close to breach" band adjacent to the threshold.
 */
export function evaluateFinancialCovenant(
  cov: ManagedCovenant,
  actual: number | null,
  warnCushion = 0.05,
): CovenantEvaluation {
  if (cov.kind !== "financial" || cov.threshold == null) {
    return { type: cov.type, status: "no_data", actual, threshold: cov.threshold ?? null, headroom: null, severity: "none", message: "Not a numeric financial covenant." };
  }
  if (actual == null) {
    return { type: cov.type, status: "no_data", actual: null, threshold: cov.threshold, headroom: null, severity: "none", message: "No actual value reported." };
  }
  const t = cov.threshold;
  let status: CovenantStatus;
  let headroom: number;
  if (cov.direction === "floor") {
    headroom = actual - t;
    if (actual < t) status = "breach";
    else if (actual < t * (1 + warnCushion)) status = "warning";
    else status = "pass";
  } else {
    // cap
    headroom = t - actual;
    if (actual > t) status = "breach";
    else if (actual > t * (1 - warnCushion)) status = "warning";
    else status = "pass";
  }

  const severity = breachSeverity(status, headroom, t);
  return {
    type: cov.type,
    status,
    actual,
    threshold: t,
    headroom: Number(headroom.toFixed(4)),
    severity,
    message:
      status === "pass" ? "In compliance." : status === "warning" ? "Approaching covenant threshold." : "COVENANT BREACH.",
  };
}

function breachSeverity(status: CovenantStatus, headroom: number, threshold: number): BreachSeverity {
  if (status !== "breach") return "none";
  const magnitude = threshold !== 0 ? Math.abs(headroom) / Math.abs(threshold) : Math.abs(headroom);
  if (magnitude > 0.2) return "severe";
  if (magnitude > 0.05) return "material";
  return "minor";
}

/** Evaluate a REPORTING/negative covenant from a delivered/complied boolean. */
export function evaluateReportingCovenant(cov: ManagedCovenant, delivered: boolean | null): CovenantEvaluation {
  if (delivered == null) {
    return { type: cov.type, status: "no_data", actual: null, threshold: null, headroom: null, severity: "none", message: "Delivery status unknown." };
  }
  return {
    type: cov.type,
    status: delivered ? "pass" : "breach",
    actual: null,
    threshold: null,
    headroom: null,
    severity: delivered ? "none" : "material",
    message: delivered ? "Delivered / in compliance." : "Required item not delivered.",
  };
}
