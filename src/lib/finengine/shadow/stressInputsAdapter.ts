/**
 * SPEC-FINENGINE-DECISION-CORE-SHADOW-1 §1 — stress-input assembler.
 *
 * Maps the assembled finengine global cash flow + certified business facts into the
 * `StressInputs` the unified stress engine consumes. Used by the decision-core shadow
 * harness to produce the finengine's `DSCR_STRESSED_300BPS` analog.
 *
 * Base/DS definition (R4): the legacy `DSCR_STRESSED_300BPS = cashFlowAvailable /
 * stressedAds` is a PURE +300bps rate shock (numerator unchanged). The harness pairs
 * it with the finengine `rateShock` (not `stressC`, which also compresses revenue).
 * The finengine stresses its GLOBAL base (cash-before-debt / global debt service) —
 * the same base its global DSCR uses — so the stressed comparison carries the same
 * documented denominator fix as the base DSCR, consistently, not a new artifact.
 *
 * `debtServiceStressed300` is left undefined in v1 (no amortization-engine stressed-DS
 * value is persisted), so the stress engine applies its conservative +12% fallback;
 * the chosen path is recorded.
 *
 * Warn-don't-paper-over for every missing input (mirrors the assembler). Pure — no DB.
 */

import {
  buildCertifiedSnapshots,
  type CertifiedFactRow,
} from "@/lib/finengine/shadow/dealInputAdapter";
import type { StressInputs } from "@/lib/finengine/stress/stressEngine";

const num = (v: number | null | undefined): number | null => (v == null ? null : v);

export type StressInputAssembly = {
  stressInputs: StressInputs;
  warnings: string[];
  /** Which stressed-debt-service path the stress engine will use. */
  stressedDsPath: "amort_engine" | "fallback_12pct";
};

/**
 * Assemble `StressInputs` for the +300bps rate shock from the global cash flow result
 * and the certified BUSINESS facts at the analysis period.
 *
 * @param baseCashFlow  finengine global cash-before-debt (the rate-shock numerator)
 * @param debtService   finengine global fully-amortizing debt service (denominator)
 */
export function buildStressInputs(
  dealId: string,
  rows: CertifiedFactRow[],
  analysisPeriod: string,
  baseCashFlow: number,
  debtService: number,
): StressInputAssembly {
  const warnings: string[] = [];
  const snaps = buildCertifiedSnapshots(dealId, rows);
  const bizSnap = snaps.find((s) => s.entityScope === "BUSINESS" && s.fiscalPeriodEnd === analysisPeriod);

  const revenue = bizSnap ? num(bizSnap.facts["TOTAL_REVENUE"]) ?? num(bizSnap.facts["GROSS_RECEIPTS"]) : null;
  const grossProfit = bizSnap ? num(bizSnap.facts["GROSS_PROFIT"]) : null;

  let baseRevenue = 0;
  if (revenue != null && revenue > 0) baseRevenue = revenue;
  else warnings.push(`stress: no business revenue (TOTAL_REVENUE/GROSS_RECEIPTS) at ${analysisPeriod} — baseRevenue treated as 0 (revenue scenarios inert).`);

  let grossMarginPct = 0;
  if (revenue != null && revenue > 0 && grossProfit != null) grossMarginPct = grossProfit / revenue;
  else warnings.push("stress: gross margin unresolved (need GROSS_PROFIT and revenue) — grossMarginPct treated as 0.");

  // v1: no persisted amortization-engine stressed DS → conservative +12% fallback.
  const stressedDsPath: StressInputAssembly["stressedDsPath"] = "fallback_12pct";
  warnings.push("stress: no amortization-engine +300bps debt service available — using the stress engine's conservative +12% fallback.");

  const stressInputs: StressInputs = {
    baseCashFlow,
    baseRevenue,
    grossMarginPct,
    debtService,
    // debtServiceStressed300 intentionally undefined → engine applies +12% fallback.
  };

  return { stressInputs, warnings, stressedDsPath };
}
