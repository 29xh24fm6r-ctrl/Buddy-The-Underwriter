/**
 * SPEC-FINENGINE-LIVE-SPREAD-1 — Phase 3: live-spread validator.
 *
 * Compares the engine's DealSpread output to the INDEPENDENT golden-set (derived
 * from the filed 1120 lines by a separate code path — NG4) and classifies every
 * check ZERO / INTENDED / UNEXPECTED. ZERO = engine agrees with the independent
 * hand-derivation (the win condition — agreement means correctness because the
 * two derivations are independent). UNEXPECTED = a divergence with no registered
 * reason; it BLOCKS any future cutover and must be root-caused. Read-only.
 */

import type { DealSpread, MetricCell } from "@/lib/finengine/spread/dealSpread";
import type { CertifiedFactRow, EntityScope } from "@/lib/finengine/shadow/dealInputAdapter";
import { SENTINEL_PERIOD } from "@/lib/finengine/shadow/dealInputAdapter";
import {
  goldenEbitda, goldenCurrentRatio, goldenDebtToEquity, goldenGrossMargin,
  goldenEffectiveTNW, goldenDebtToEtnw, goldenLeverageTotal, goldenDscr,
} from "@/lib/finengine/spread/fullSpreadGoldenSet";
import { selectionChecks } from "@/lib/finengine/spread/selectionGuard";

export type Classification = "ZERO" | "INTENDED" | "UNEXPECTED";

export type SpreadCheck = {
  scope: EntityScope;
  period: string;
  metric: string;
  engine: number | null;
  golden: number | null;
  absDelta: number | null;
  classification: Classification;
  goldenSource: string;
  note?: string;
};

export type IntendedDivergence = {
  metric: string;
  period?: string;
  expected: number | null;
  rationale: string;
};

export type SpreadValidation = {
  dealId: string;
  checks: SpreadCheck[];
  zero: number;
  intended: number;
  unexpected: number;
  cutoverBlocked: boolean;
};

const REL_TOL = 1e-6;
function eq(a: number | null, b: number | null): boolean {
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  return Math.abs(a - b) / Math.max(Math.abs(a), Math.abs(b), 1) <= REL_TOL;
}

const isReal = (p: string) => p !== SENTINEL_PERIOD && /^\d{4}-\d{2}-\d{2}$/.test(p);

/** Each golden metric paired with the engine metric name that should match it. */
const GOLDEN_VS_ENGINE: Array<{
  metric: string;
  derive: (facts: Record<string, number | null>) => { value: number | null; source: string };
}> = [
  { metric: "EBITDA", derive: goldenEbitda },
  { metric: "CURRENT_RATIO", derive: goldenCurrentRatio },
  { metric: "DEBT_TO_EQUITY", derive: goldenDebtToEquity },
  { metric: "GROSS_MARGIN", derive: goldenGrossMargin },
  // Decision metrics the memo surfaces (validated the moment the spread emits them).
  { metric: "EFFECTIVE_TANGIBLE_NET_WORTH", derive: goldenEffectiveTNW },
  { metric: "DEBT_TO_ETNW", derive: goldenDebtToEtnw },
  { metric: "LEVERAGE_TOTAL", derive: goldenLeverageTotal },
  { metric: "DSCR", derive: goldenDscr },
];

/** A pre-registered, raw-anchored expected value — independent of the adapter's selection (NG5). */
export type HardAnchor = { metric: string; period: string; expected: number; source: string };

/**
 * Validate a DealSpread for one scope (default BUSINESS) against the independent
 * golden derivations from each certified snapshot's facts.
 */
export function validateSpread(
  spread: DealSpread,
  opts?: { scope?: EntityScope; intended?: IntendedDivergence[]; rawRows?: CertifiedFactRow[]; hardAnchors?: HardAnchor[] },
): SpreadValidation {
  const scope = opts?.scope ?? "BUSINESS";
  const intended = opts?.intended ?? [];
  const checks: SpreadCheck[] = [];

  const cellFor = (metric: string, period: string): MetricCell | undefined =>
    spread.cells.find((c) => c.scope === scope && c.metric === metric && c.period === period);

  for (const snap of spread.snapshots) {
    if (snap.entityScope !== scope || !isReal(snap.fiscalPeriodEnd)) continue;

    // --- Computation goldens (engine value vs independent derivation) ---
    for (const g of GOLDEN_VS_ENGINE) {
      const cell = cellFor(g.metric, snap.fiscalPeriodEnd);
      if (!cell) continue; // metric not surfaced by the spread — nothing to validate yet
      const { value: golden, source } = g.derive(snap.facts);
      if (golden == null) continue; // golden undefined on this period
      const engine = cell.value ?? null;

      let classification: Classification;
      let note: string | undefined;
      if (eq(engine, golden)) {
        classification = "ZERO";
      } else {
        const reg = intended.find((i) => i.metric === g.metric && (i.period == null || i.period === snap.fiscalPeriodEnd) && eq(engine, i.expected));
        if (reg) { classification = "INTENDED"; note = reg.rationale; }
        else { classification = "UNEXPECTED"; note = "engine diverges from the independent golden with no registered reason"; }
      }

      checks.push({
        scope, period: snap.fiscalPeriodEnd, metric: g.metric,
        engine, golden, absDelta: engine != null && golden != null ? Math.abs(engine - golden) : null,
        classification, goldenSource: source, note,
      });
    }

    // --- Selection-layer guard (adapter's chosen value vs independent raw selection) ---
    if (opts?.rawRows) {
      for (const sc of selectionChecks(snap.facts, opts.rawRows, scope, snap.fiscalPeriodEnd)) {
        checks.push({
          scope, period: sc.period, metric: `SELECT:${sc.factKey}`,
          engine: sc.adapterValue, golden: sc.independentValue,
          absDelta: Math.abs(sc.adapterValue! - sc.independentValue!),
          classification: sc.agrees ? "ZERO" : "UNEXPECTED",
          goldenSource: "independent raw-row selection (separate code path — NG5)",
          note: sc.agrees ? undefined : "adapter selected a different value than an independent raw selection — possible entity-partition / extractor mis-selection",
        });
      }
    }
  }

  // --- Hard anchors (pre-registered audited values, independent of snap.facts) ---
  for (const a of opts?.hardAnchors ?? []) {
    const engine = cellFor(a.metric, a.period)?.value ?? null;
    const agrees = eq(engine, a.expected);
    const reg = !agrees && intended.find((i) => i.metric === a.metric && (i.period == null || i.period === a.period) && eq(engine, i.expected));
    checks.push({
      scope, period: a.period, metric: `ANCHOR:${a.metric}`,
      engine, golden: a.expected, absDelta: engine != null ? Math.abs(engine - a.expected) : null,
      classification: agrees ? "ZERO" : reg ? "INTENDED" : "UNEXPECTED",
      goldenSource: a.source,
      note: agrees ? undefined : reg ? (reg as IntendedDivergence).rationale : "engine value does not match the pre-registered audited anchor",
    });
  }

  const zero = checks.filter((c) => c.classification === "ZERO").length;
  const intendedN = checks.filter((c) => c.classification === "INTENDED").length;
  const unexpected = checks.filter((c) => c.classification === "UNEXPECTED").length;
  return { dealId: spread.dealId, checks, zero, intended: intendedN, unexpected, cutoverBlocked: unexpected > 0 };
}
