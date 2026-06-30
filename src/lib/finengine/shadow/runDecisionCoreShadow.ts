/**
 * SPEC-FINENGINE-DECISION-CORE-SHADOW-1 §2 — decision-core shadow harness.
 *
 * Runs the finengine's global cash flow + stress engine on a real deal and diffs the
 * OVERLAPPING decision numbers — `DSCR` and `DSCR_STRESSED_300BPS` — against the
 * legacy engine via `compareProducers`. The SR 11-7 wall over the numbers a credit
 * decision actually turns on. Mirrors `runFullSpreadShadow` structurally.
 *
 * GATED set (§0.2): `DECISION_CORE_OVERLAPPING = { DSCR, DSCR_STRESSED_300BPS }`.
 * The legacy intermediates (`CASH_FLOW_AVAILABLE`, `PROPOSED_LOAN_COVERAGE`,
 * `EXCESS_CASH_FLOW`) are business-only by a different definition than the finengine's
 * global outputs, so they are NOT comparable and never gated.
 *
 * Key alignment (§0.4 / R3): legacy decision facts are keyed `DEAL | <decision period>`
 * (e.g. 2026-06-29), NOT the assembler's internal fiscal analysis period. The harness
 * keys each finengine value at the SAME owner_type + period as the legacy row it diffs
 * against, so a divergence is a real diff — not an all-shadow-only miss.
 *
 * Stress mapping: the finengine `DSCR_STRESSED_300BPS` analog is **Stress C** —
 * simultaneous +300bps AND −15% revenue compression at the 1.00x floor
 * (`stress/stressEngine.ts::stressC`), stressing the same global base as the
 * finengine's base DSCR. Legacy's `DSCR_STRESSED_300BPS` was rate-only (the
 * revenue-compression half was previously absent); the difference is the documented
 * Stress-C completion + global-denominator fix, registered INTENDED by
 * SPEC-FINENGINE-DECISION-CORE-GOLDEN-1.
 *
 * Golden set is the companion spec — here it defaults to `[]`, so the corrected global
 * denominator / Stress-C fixes diff as UNEXPECTED (the gate working). Pure — no DB.
 */

import type { CertifiedFactRow } from "@/lib/finengine/shadow/dealInputAdapter";
import { runGlobalCashFlowShadow } from "@/lib/finengine/shadow/globalCashFlowAdapter";
import { buildStressInputs } from "@/lib/finengine/shadow/stressInputsAdapter";
import { stressC } from "@/lib/finengine/stress/stressEngine";
import { decisionCoreGoldenSet } from "@/lib/finengine/shadow/decisionCoreGoldenSet";
import {
  compareProducers,
  type ShadowValue,
  type GoldenSetEntry,
  type ShadowReport,
} from "@/lib/finengine/shadow/reconcile";

/** The legacy ∩ finengine decision numbers this harness gates (§0.2). */
export const DECISION_CORE_OVERLAPPING: ReadonlySet<string> = new Set([
  "DSCR",
  "DSCR_STRESSED_300BPS",
]);

export type DecisionCoreShadowResult = {
  dealId: string;
  analysisPeriod: string;
  globalDSCR: number | null;
  stressedDSCR: number | null;
  report: ShadowReport; // GATED diff over DECISION_CORE_OVERLAPPING only
  warnings: string[];
};

/** The single non-superseded legacy row for a decision key, latest period first. */
function primaryLegacyRow(rows: CertifiedFactRow[], key: string): CertifiedFactRow | null {
  const pool = rows.filter((r) => r.fact_key === key && !r.is_superseded && r.fact_value_num != null);
  if (pool.length === 0) return null;
  // Prefer the real decision period (a date) over the sentinel '1900-01-01'.
  return [...pool].sort((a, b) => (a.fact_period_end < b.fact_period_end ? 1 : a.fact_period_end > b.fact_period_end ? -1 : 0))[0];
}

export function runDecisionCoreShadow(
  dealId: string,
  rows: CertifiedFactRow[],
  goldenSet?: GoldenSetEntry[],
): DecisionCoreShadowResult {
  // SPEC-FINENGINE-DECISION-CORE-GOLDEN-1 §2 — self-classifying out of the box: when
  // the caller omits a golden set, build the registry (corrected global denominator +
  // Stress C, from INDEPENDENT derivations). An explicit argument (incl. `[]`) wins.
  const golden = goldenSet ?? decisionCoreGoldenSet(dealId, rows);
  const warnings: string[] = [];

  // ── finengine producers ─────────────────────────────────────────────────────
  const { inputs, result } = runGlobalCashFlowShadow(dealId, rows);
  warnings.push(...inputs.warnings, ...result.warnings);
  const globalDSCR = result.globalDSCR;

  const stress = buildStressInputs(dealId, rows, inputs.analysisPeriod, result.globalCashBeforeDebt, result.globalDebtService);
  warnings.push(...stress.warnings);
  const stressedDSCR = stressC(stress.stressInputs).dscr;

  const finengineValue = (key: string): number | null =>
    key === "DSCR" ? globalDSCR : key === "DSCR_STRESSED_300BPS" ? stressedDSCR : null;

  // ── gated diff over the overlapping decision numbers ────────────────────────
  const legacy: ShadowValue[] = [];
  const shadow: ShadowValue[] = [];
  for (const key of DECISION_CORE_OVERLAPPING) {
    const leg = primaryLegacyRow(rows, key);
    if (!leg) {
      // §0.1 — legacy-missing: report the finengine value, do not gate (no crash).
      warnings.push(`legacy ${key} missing — finengine value ${finengineValue(key) ?? "—"} reported only (not gated).`);
      continue;
    }
    // Key BOTH sides identically: legacy row's owner_type + period (R3).
    legacy.push({ dealId, factKey: key, ownerType: leg.owner_type, fiscalPeriodEnd: leg.fact_period_end, value: leg.fact_value_num });
    shadow.push({ dealId, factKey: key, ownerType: leg.owner_type, fiscalPeriodEnd: leg.fact_period_end, value: finengineValue(key) });
  }

  const report = compareProducers(legacy, shadow, golden);

  return { dealId, analysisPeriod: inputs.analysisPeriod, globalDSCR, stressedDSCR, report, warnings };
}
