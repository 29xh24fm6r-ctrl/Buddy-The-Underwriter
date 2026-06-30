/**
 * SPEC-FINENGINE-FULL-SPREAD-SHADOW-1 — full-spread shadow runner (Phase 1 of the
 * god-tier one-engine cutover).
 *
 * Mirrors `runEbitdaShadow` structurally, generalized from one metric to the whole
 * diagnostic spread: compute `computeDealSpread` (the full credit-measurement
 * universe), then split its cells into two disjoint streams —
 *
 *   - GATED: cells whose metric is in OVERLAPPING_METRICS (metrics the legacy
 *     engine ALSO persists). These are diffed against the deal's legacy canonical
 *     facts via `compareProducers` — the SR 11-7 wall. Only these can read as
 *     UNEXPECTED / set `cutoverBlocked`.
 *   - ADDITIVE: every net-new metric (no legacy equivalent) — surfaced as an
 *     informational list with rating + meaning, NEVER fed to the gate.
 *
 * The load-bearing invariant (§0.2 trap, R1): the gated `report` is constructed
 * SOLELY from OVERLAPPING_METRICS, so a net-new ratio (e.g. CURRENT_RATIO), which
 * has no legacy counterpart, can never be classified UNEXPECTED nor block cutover.
 * It always lands in `additiveMetrics` instead.
 *
 * Pure — no DB. The script `scripts/finengine-shadow-fullspread.ts` loads rows and
 * calls this. NG1: writes nothing; no canonical fact, no flag, no rendering.
 */

import { computeDealSpread, type DealSpread } from "@/lib/finengine/spread/dealSpread";
import {
  scopeOf,
  type CertifiedFactRow,
} from "@/lib/finengine/shadow/dealInputAdapter";
import {
  compareProducers,
  type ShadowValue,
  type GoldenSetEntry,
  type ShadowReport,
} from "@/lib/finengine/shadow/reconcile";
import { fullSpreadGoldenSet } from "@/lib/finengine/shadow/fullSpreadGoldenSet";

/**
 * The gated set — metrics the legacy engine also persists as canonical facts.
 *
 * Finalized in §0.3: of every `cell.metric` `computeDealSpread` emits, the only
 * one that is also a canonical `fact_key` the legacy spread writers persist is
 * `EBITDA` (the method branch emits `metric: "EBITDA"`, exact string-match to the
 * legacy fact key — §0.4, no rename needed). Every other diagnostic cell is a
 * ratio/score/margin name (CURRENT_RATIO, DEBT_TO_EQUITY, ALTMAN_Z_PRIME, …) that
 * legacy does not persist under that key, so it is net-new (additive).
 *
 * R2: start minimal and expand only with evidence — a missed overlap is caught
 * later as the set grows; a wrong inclusion risks spurious UNEXPECTED.
 */
export const OVERLAPPING_METRICS: ReadonlySet<string> = new Set([
  "EBITDA",
]);

export type AdditiveCell = {
  family: string;
  metric: string;
  scope: string;
  period: string;
  value: number;
  rating: string;
  meaning: string;
};

export type FullSpreadShadowResult = {
  dealId: string;
  spread: DealSpread;              // the full computed spread (inspection)
  report: ShadowReport;            // GATED diff over OVERLAPPING_METRICS only
  additiveMetrics: AdditiveCell[]; // net-new metrics (no legacy equiv) — informational, NOT gated
};

export function runFullSpreadShadow(
  dealId: string,
  rows: CertifiedFactRow[],
  goldenSet?: GoldenSetEntry[],
): FullSpreadShadowResult {
  // SPEC-FINENGINE-FULL-SPREAD-GOLDEN-1 §2 — self-classifying out of the box: when
  // the caller omits a golden set, build the registry (EBITDA intended-divergence
  // entries from the INDEPENDENT derivation). An explicit argument — including an
  // explicit `[]` — still wins, so fixtures can drive classification deterministically.
  const golden = goldenSet ?? fullSpreadGoldenSet(dealId, rows);

  const spread = computeDealSpread(dealId, rows);

  // SHADOW side: finengine cells whose metric is in the overlapping set. The cell
  // already carries an EntityScope (`cell.scope`) — the join key the legacy side
  // is normalized to below (R3).
  const shadow: ShadowValue[] = spread.cells
    .filter((c) => OVERLAPPING_METRICS.has(c.metric) && c.value != null)
    .map((c) => ({
      dealId,
      factKey: c.metric,
      ownerType: c.scope,
      fiscalPeriodEnd: c.period,
      value: c.value,
    }));

  // LEGACY side: live persisted canonical facts for the SAME overlapping keys.
  // R3 — `compareProducers` joins on dealId|factKey|ownerType|period, and the
  // shadow side keys on EntityScope (BUSINESS/PERSONAL/AFFILIATE). The raw
  // `owner_type` string ("borrower"/"opco"/"DEAL"/…) does NOT match, so normalize
  // each legacy row to its EntityScope via the same `scopeOf` the certified layer
  // uses to assign `cell.scope`. Rows that do not classify to a finengine scope
  // (DEAL / unknown source) cannot align to any cell and are dropped.
  const legacy: ShadowValue[] = rows
    .filter((r) => OVERLAPPING_METRICS.has(r.fact_key) && !r.is_superseded && scopeOf(r) != null)
    .map((r) => ({
      dealId,
      factKey: r.fact_key,
      ownerType: scopeOf(r)!,
      fiscalPeriodEnd: r.fact_period_end,
      value: r.fact_value_num,
    }));

  const report = compareProducers(legacy, shadow, golden);

  // ADDITIVE: every net-new metric the engine produces (the credit-measurement
  // universe). Constructed from the COMPLEMENT of OVERLAPPING_METRICS, so it can
  // never intersect the gated set — the §0.2 / R1 firewall.
  const additiveMetrics: AdditiveCell[] = spread.cells
    .filter((c) => !OVERLAPPING_METRICS.has(c.metric) && c.value != null)
    .map((c) => ({
      family: c.family,
      metric: c.metric,
      scope: c.scope,
      period: c.period,
      value: c.value!,
      rating: c.rating,
      meaning: c.interpretation.meaning,
    }));

  return { dealId, spread, report, additiveMetrics };
}
