/**
 * SPEC-FINENGINE-DECISION-CORE-GOLDEN-1 — decision-core golden-set registry
 * (third spec of the decision-core cutover track).
 *
 * Registers the finengine's deliberate decision-core fixes as INTENDED divergences so
 * `runDecisionCoreShadow` classifies them INTENDED instead of UNEXPECTED:
 *   - `DSCR`               — the corrected GLOBAL denominator (business existing+proposed
 *                            debt service + personal guarantees), vs legacy's proposed-only.
 *   - `DSCR_STRESSED_300BPS`— STRESS C: simultaneous +300bps AND −15% revenue at 1.00x,
 *                            vs legacy's rate-only stressed number.
 *
 * NG2 — THE CORE RULE: every expected value is recomputed INDEPENDENTLY from the
 * certified facts using the documented policy — NEVER read from `computeGlobalCashFlow`,
 * `stressEngine`, or `runDecisionCoreShadow`. This module imports only the shared fact
 * layer (`buildCertifiedSnapshots`) and the independent EBITDA derivation
 * (`goldenConservativeEbitda`, the same NG2-clean path Phase 2 used) — never the engine.
 * An INTENDED match therefore proves TWO independent paths concur. Enforced by the
 * import-grep guard + the NG2 unit test.
 *
 * Income side EXCLUDES K-1 Box 1 and distributions (single-count), mirroring the
 * assembler. Null derivation ⇒ no entry (a genuinely unresolved DSCR stays UNEXPECTED).
 *
 * Pure — no DB, no engine import. Read-only (NG1).
 */

import {
  buildCertifiedSnapshots,
  SENTINEL_PERIOD,
  type CertifiedFactRow,
  type CertifiedPeriodSnapshot,
} from "@/lib/finengine/shadow/dealInputAdapter";
import { goldenConservativeEbitda } from "@/lib/finengine/shadow/ebitdaGoldenSet";
import type { GoldenSetEntry } from "@/lib/finengine/shadow/reconcile";

const SPEC = "SPEC-FINENGINE-DECISION-CORE-GOLDEN-1";

/** Stress C policy constants (documented; mirror stress/stressEngine defaults). */
const STRESS_REVENUE_COMPRESSION = 0.15;
const STRESS_DS_FALLBACK_MULT = 1.12; // +300bps fallback when no amort-engine stressed DS

const num = (v: number | null | undefined): number | null => (v == null ? null : v);

/** Live deal-level value for a key: non-superseded, latest period, |value| tie-break. */
function liveDealValue(rows: CertifiedFactRow[], key: string): number | null {
  const pool = rows.filter((r) => r.fact_key === key && !r.is_superseded && r.fact_value_num != null);
  if (pool.length === 0) return null;
  return [...pool].sort(
    (a, b) =>
      (a.fact_period_end < b.fact_period_end ? 1 : a.fact_period_end > b.fact_period_end ? -1 : 0) ||
      Math.abs(b.fact_value_num!) - Math.abs(a.fact_value_num!),
  )[0].fact_value_num;
}

function latestPfsSnapshot(personalSnaps: CertifiedPeriodSnapshot[]): CertifiedPeriodSnapshot | undefined {
  const withPfs = personalSnaps.filter((s) => Object.keys(s.facts).some((k) => k.startsWith("PFS_")));
  if (withPfs.length === 0) return undefined;
  return [...withPfs].sort((a, b) => (a.fiscalPeriodEnd < b.fiscalPeriodEnd ? -1 : 1)).at(-1);
}

type Globals = {
  globalCashBeforeDebt: number;
  globalDebtService: number;
  baseRevenue: number;
  grossMarginPct: number;
  resolved: boolean; // false when the denominator is unusable
};

/**
 * Independent recomputation of the finengine global cash flow figures from facts —
 * mirroring the assembler's documented policy, but with EBITDA from the independent
 * `goldenConservativeEbitda` (NOT `coreOperatingEarnings`) and the DSCR arithmetic
 * done here (NOT `computeGlobalCashFlow`). This is the NG2 firewall.
 */
function deriveGlobals(dealId: string, rows: CertifiedFactRow[]): Globals {
  const snaps = buildCertifiedSnapshots(dealId, rows);
  const businessSnaps = snaps.filter((s) => s.entityScope === "BUSINESS");
  const realBusiness = businessSnaps.filter((s) => s.fiscalPeriodEnd !== SENTINEL_PERIOD);
  const analysisPeriod = realBusiness.length > 0 ? realBusiness[realBusiness.length - 1].fiscalPeriodEnd : businessSnaps[0]?.fiscalPeriodEnd ?? SENTINEL_PERIOD;
  const bizSnap = businessSnaps.find((s) => s.fiscalPeriodEnd === analysisPeriod) ?? businessSnaps[0];

  // Business operating cash = INDEPENDENT conservative EBITDA (pre-distribution).
  const businessOperating = bizSnap ? goldenConservativeEbitda(bizSnap.facts).conservativeEbitda ?? 0 : 0;

  // Business debt service = existing + proposed (summed).
  const businessDS = (liveDealValue(rows, "ANNUAL_DEBT_SERVICE") ?? 0) + (liveDealValue(rows, "ANNUAL_DEBT_SERVICE_PROPOSED") ?? 0);

  // Personal side — external income only (single-count: NO K-1, NO distributions).
  const personalSnaps = snaps.filter((s) => s.entityScope === "PERSONAL");
  let personalIncome = 0;
  let personalDS = 0;
  let living = 0;
  if (personalSnaps.length > 0) {
    const atAnalysis = personalSnaps.find((s) => s.fiscalPeriodEnd === analysisPeriod)?.facts ?? {};
    const pfs = latestPfsSnapshot(personalSnaps)?.facts ?? {};
    const wages = num(atAnalysis["WAGES_W2"]) ?? num(atAnalysis["W2_WAGES"]) ?? num(pfs["PFS_SALARY_WAGES"]) ?? 0;
    const netRental =
      num(atAnalysis["SCH_E_RENTAL_TOTAL"]) ?? num(atAnalysis["SCH_E_NET_PER_PROPERTY"]) ?? num(atAnalysis["NET_RENTAL_INCOME"]) ??
      num(atAnalysis["SCH_E_GROSS_RENTS_RECEIVED"]) ?? num(atAnalysis["SCH_E_RENTS_RECEIVED"]) ?? 0;
    const investment = (num(atAnalysis["F1099DIV_ORDINARY"]) ?? 0) + (num(atAnalysis["F1099INT_INTEREST"]) ?? 0);
    personalIncome = wages + netRental + investment; // K1_ORDINARY_INCOME / distributions intentionally absent
    personalDS = num(pfs["PFS_ANNUAL_DEBT_SERVICE"]) ?? 0;
    living = num(pfs["PFS_LIVING_EXPENSES"]) ?? 0; // worst-of-three with only `stated` available
  }

  const revenue = bizSnap ? num(bizSnap.facts["TOTAL_REVENUE"]) ?? num(bizSnap.facts["GROSS_RECEIPTS"]) : null;
  const grossProfit = bizSnap ? num(bizSnap.facts["GROSS_PROFIT"]) : null;
  const baseRevenue = revenue != null && revenue > 0 ? revenue : 0;
  const grossMarginPct = revenue != null && revenue > 0 && grossProfit != null ? grossProfit / revenue : 0;

  const globalCashBeforeDebt = businessOperating + (personalIncome - living);
  const globalDebtService = businessDS + personalDS;

  return { globalCashBeforeDebt, globalDebtService, baseRevenue, grossMarginPct, resolved: globalDebtService > 0 };
}

/** Independent global DSCR = globalCashBeforeDebt ÷ (business + personal debt service). */
export function goldenGlobalDscr(dealId: string, rows: CertifiedFactRow[]): { value: number | null; rationale: string } {
  const g = deriveGlobals(dealId, rows);
  if (!g.resolved) return { value: null, rationale: "global debt service unresolved (no proposed/existing/personal DS) — DSCR not derivable." };
  return {
    value: g.globalCashBeforeDebt / g.globalDebtService,
    rationale: `Corrected GLOBAL denominator: cash-before-debt(${Math.round(g.globalCashBeforeDebt)}) ÷ (business existing+proposed + personal guarantees = ${Math.round(g.globalDebtService)}). Income excludes K-1 Box 1 and distributions (single-count). Legacy used the proposed-loan-only denominator.`,
  };
}

/** Independent Stress C DSCR = (globalCash − baseRevenue×15%×grossMargin) ÷ (globalDS × 1.12). */
export function goldenStressCDscr(dealId: string, rows: CertifiedFactRow[]): { value: number | null; rationale: string } {
  const g = deriveGlobals(dealId, rows);
  if (!g.resolved) return { value: null, rationale: "global debt service unresolved — Stress C not derivable." };
  const stressedCash = g.globalCashBeforeDebt - g.baseRevenue * STRESS_REVENUE_COMPRESSION * g.grossMarginPct;
  const stressedDS = g.globalDebtService * STRESS_DS_FALLBACK_MULT;
  return {
    value: stressedCash / stressedDS,
    rationale: `Stress C: simultaneous +300bps (DS ×${STRESS_DS_FALLBACK_MULT}) AND −${Math.round(STRESS_REVENUE_COMPRESSION * 100)}% revenue (cash −${Math.round(g.baseRevenue * STRESS_REVENUE_COMPRESSION * g.grossMarginPct)}) on the GLOBAL base. Legacy's stressed number was rate-only (revenue-compression half absent).`,
  };
}

/**
 * Registered INTENDED divergences for the decision-core overlapping set
 * ({ DSCR, DSCR_STRESSED_300BPS }). One entry per key, matched by dealId+factKey
 * (ownerType/period omitted → matches the harness's DEAL-keyed shadow value
 * regardless of the legacy row's period). Null derivation ⇒ no entry.
 */
export function decisionCoreGoldenSet(dealId: string, rows: CertifiedFactRow[]): GoldenSetEntry[] {
  const out: GoldenSetEntry[] = [];
  const dscr = goldenGlobalDscr(dealId, rows);
  if (dscr.value != null) {
    out.push({ dealId, factKey: "DSCR", expectedNewValue: dscr.value, rationale: dscr.rationale, spec: SPEC });
  }
  const stressed = goldenStressCDscr(dealId, rows);
  if (stressed.value != null) {
    out.push({ dealId, factKey: "DSCR_STRESSED_300BPS", expectedNewValue: stressed.value, rationale: stressed.rationale, spec: SPEC });
  }
  return out;
}
