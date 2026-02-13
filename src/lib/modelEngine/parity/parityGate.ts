/**
 * Model Engine V2 — Parity Gate
 *
 * Evaluates a ParityReport against per-category thresholds.
 * Returns a gate verdict: PASS, WARN, or BLOCK.
 * Pure function — no DB, no side effects.
 */

import type { ParityReport, Diff } from "./parityCompare";
import { CANONICAL_PARITY_METRICS } from "./metricDictionary";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type GateVerdict = "PASS" | "WARN" | "BLOCK";

export interface MetricTypeThreshold {
  warnAbsDelta: number;
  warnPctDelta: number;
  blockAbsDelta: number;
  blockPctDelta: number;
}

export interface ParityGateConfig {
  income_statement: MetricTypeThreshold;
  balance_sheet: MetricTypeThreshold;
  derived: MetricTypeThreshold;
}

export interface ParityGateIssue {
  metric: string;
  periodEnd: string;
  absDelta: number;
  pctDelta: number | undefined;
  category: string;
}

export interface ParityGateResult {
  verdict: GateVerdict;
  warnings: ParityGateIssue[];
  blocks: ParityGateIssue[];
}

// ---------------------------------------------------------------------------
// Default config
// ---------------------------------------------------------------------------

export const DEFAULT_PARITY_GATE_CONFIG: ParityGateConfig = {
  income_statement: {
    warnAbsDelta: 100,       // $100
    warnPctDelta: 0.01,      // 1%
    blockAbsDelta: 10_000,   // $10k
    blockPctDelta: 0.10,     // 10%
  },
  balance_sheet: {
    warnAbsDelta: 100,
    warnPctDelta: 0.01,
    blockAbsDelta: 10_000,
    blockPctDelta: 0.10,
  },
  derived: {
    warnAbsDelta: 0.10,      // DSCR delta > 0.10
    warnPctDelta: 0.05,      // 5% for ratios
    blockAbsDelta: 0.50,     // DSCR delta > 0.50
    blockPctDelta: 0.25,     // 25% for ratios
  },
};

// ---------------------------------------------------------------------------
// Category lookup (built once from frozen dictionary)
// ---------------------------------------------------------------------------

type CategoryKey = keyof ParityGateConfig;

const CATEGORY_MAP = new Map<string, CategoryKey>();
for (const m of CANONICAL_PARITY_METRICS) {
  CATEGORY_MAP.set(m.key, m.category as CategoryKey);
}

// ---------------------------------------------------------------------------
// Evaluator
// ---------------------------------------------------------------------------

export function evaluateParityGate(
  report: ParityReport,
  config: ParityGateConfig = DEFAULT_PARITY_GATE_CONFIG,
): ParityGateResult {
  const warnings: ParityGateIssue[] = [];
  const blocks: ParityGateIssue[] = [];

  for (const pc of report.periodComparisons) {
    const periodEnd = pc.periodEnd ?? pc.periodId;

    for (const [key, diff] of Object.entries(pc.differences)) {
      if (!diff) continue;
      const d = diff as Diff;
      if (!d.material) continue;

      const category = CATEGORY_MAP.get(key) ?? "derived";
      const threshold = config[category];

      const absDelta = Math.abs(d.delta);
      const pctDelta = d.pctDelta !== undefined ? Math.abs(d.pctDelta) : undefined;

      const issue: ParityGateIssue = {
        metric: key,
        periodEnd,
        absDelta,
        pctDelta,
        category,
      };

      // Check block thresholds first (either absolute or percentage)
      if (
        absDelta >= threshold.blockAbsDelta ||
        (pctDelta !== undefined && pctDelta >= threshold.blockPctDelta)
      ) {
        blocks.push(issue);
      } else if (
        absDelta >= threshold.warnAbsDelta ||
        (pctDelta !== undefined && pctDelta >= threshold.warnPctDelta)
      ) {
        warnings.push(issue);
      }
    }
  }

  const verdict: GateVerdict =
    blocks.length > 0 ? "BLOCK" :
    warnings.length > 0 ? "WARN" :
    "PASS";

  return { verdict, warnings, blocks };
}
