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
import type { EntityScope } from "@/lib/finengine/shadow/dealInputAdapter";
import { SENTINEL_PERIOD } from "@/lib/finengine/shadow/dealInputAdapter";
import {
  goldenEbitda, goldenCurrentRatio, goldenDebtToEquity, goldenGrossMargin,
} from "@/lib/finengine/spread/fullSpreadGoldenSet";

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
];

/**
 * Validate a DealSpread for one scope (default BUSINESS) against the independent
 * golden derivations from each certified snapshot's facts.
 */
export function validateSpread(
  spread: DealSpread,
  opts?: { scope?: EntityScope; intended?: IntendedDivergence[] },
): SpreadValidation {
  const scope = opts?.scope ?? "BUSINESS";
  const intended = opts?.intended ?? [];
  const checks: SpreadCheck[] = [];

  const cellFor = (metric: string, period: string): MetricCell | undefined =>
    spread.cells.find((c) => c.scope === scope && c.metric === metric && c.period === period);

  for (const snap of spread.snapshots) {
    if (snap.entityScope !== scope || !isReal(snap.fiscalPeriodEnd)) continue;
    for (const g of GOLDEN_VS_ENGINE) {
      const { value: golden, source } = g.derive(snap.facts);
      if (golden == null) continue; // golden undefined on this period — nothing to validate
      const engine = cellFor(g.metric, snap.fiscalPeriodEnd)?.value ?? null;

      let classification: Classification;
      let note: string | undefined;
      if (eq(engine, golden)) {
        classification = "ZERO";
      } else {
        const reg = intended.find((i) => i.metric === g.metric && (i.period == null || i.period === snap.fiscalPeriodEnd) && eq(engine, i.expected));
        if (reg) {
          classification = "INTENDED";
          note = reg.rationale;
        } else {
          classification = "UNEXPECTED";
          note = "engine diverges from the independent golden with no registered reason";
        }
      }

      checks.push({
        scope, period: snap.fiscalPeriodEnd, metric: g.metric,
        engine, golden, absDelta: engine != null && golden != null ? Math.abs(engine - golden) : null,
        classification, goldenSource: source, note,
      });
    }
  }

  const zero = checks.filter((c) => c.classification === "ZERO").length;
  const intendedN = checks.filter((c) => c.classification === "INTENDED").length;
  const unexpected = checks.filter((c) => c.classification === "UNEXPECTED").length;
  return { dealId: spread.dealId, checks, zero, intended: intendedN, unexpected, cutoverBlocked: unexpected > 0 };
}
