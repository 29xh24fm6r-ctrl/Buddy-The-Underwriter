/**
 * Ratio Explanations — Phase 66A (Commit 6)
 *
 * Generates plain-English ratio explanations for borrowers and bankers.
 * EXTENDS the existing ratio system (altmanZScore, efficiencyRatios, healthScoring)
 * — does NOT duplicate computation logic.
 *
 * Uses the existing:
 * - src/lib/ratios/altmanZScore.ts (Altman Z-Score)
 * - src/lib/ratios/efficiencyRatios.ts (ROA, ROE, etc.)
 * - src/lib/ratios/healthScoring.ts (composite health)
 * - src/lib/metrics/registry.ts (32 MetricDefinition entries)
 * - src/lib/metrics/evaluateMetric.ts (safe expression evaluator)
 */

import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

// ============================================================================
// Types
// ============================================================================

export type RatioExplanation = {
  metricKey: string;
  periodLabel: string | null;
  computedValue: number | null;
  thresholdValue: number | null;
  pass: boolean | null;
  explanationText: string;
  bankerNote: string | null;
  formulaUsed: string | null;
};

// ============================================================================
// Explanation Templates
// ============================================================================

type ExplanationTemplate = {
  metricKey: string;
  label: string;
  /** Generates borrower-safe explanation */
  explain: (value: number, threshold?: number) => string;
  /** Generates banker-only context */
  bankerContext: (value: number, threshold?: number) => string;
  formulaDescription: string;
};

const EXPLANATION_TEMPLATES: ExplanationTemplate[] = [
  {
    metricKey: "dscr",
    label: "Debt Service Coverage Ratio",
    explain: (v, t) => {
      const pct = (v * 100).toFixed(0);
      if (v >= 1.25) return `Your business generates ${pct}% of what's needed to cover loan payments — that's a strong position.`;
      if (v >= 1.0) return `Your business generates ${pct}% of what's needed for loan payments — this is adequate but leaves a thin margin.`;
      return `Your business currently generates ${pct}% of what's needed — additional cash flow sources may be needed.`;
    },
    bankerContext: (v, t) =>
      `DSCR ${v.toFixed(2)}x vs ${t?.toFixed(2) ?? "1.25"}x policy min. ${v < (t ?? 1.25) ? "Below threshold — exception or mitigant required." : "Meets policy."}`,
    formulaDescription: "Net Operating Income / Total Debt Service",
  },
  {
    metricKey: "ltv",
    label: "Loan-to-Value Ratio",
    explain: (v) => {
      const pct = (v * 100).toFixed(0);
      if (v <= 0.75) return `The loan represents ${pct}% of the property value — strong collateral cushion.`;
      if (v <= 0.85) return `The loan represents ${pct}% of the property value — standard coverage.`;
      return `The loan represents ${pct}% of the property value — higher leverage may require additional collateral.`;
    },
    bankerContext: (v, t) =>
      `LTV ${(v * 100).toFixed(1)}% vs ${((t ?? 0.80) * 100).toFixed(0)}% policy max. ${v > (t ?? 0.80) ? "Exceeds threshold." : "Within policy."}`,
    formulaDescription: "Loan Amount / Appraised Value",
  },
  {
    metricKey: "debt_yield",
    label: "Debt Yield",
    explain: (v) => {
      const pct = (v * 100).toFixed(1);
      if (v >= 0.10) return `The property generates ${pct}% debt yield — strong return relative to the loan.`;
      if (v >= 0.08) return `The property generates ${pct}% debt yield — adequate performance.`;
      return `The property generates ${pct}% debt yield — the loan is large relative to income.`;
    },
    bankerContext: (v) =>
      `Debt yield ${(v * 100).toFixed(2)}%. Industry floor typically 8-10%. ${v < 0.08 ? "Below institutional threshold." : "Acceptable."}`,
    formulaDescription: "Net Operating Income / Loan Amount",
  },
  {
    metricKey: "current_ratio",
    label: "Current Ratio",
    explain: (v) => {
      if (v >= 2.0) return `Your business has $${v.toFixed(2)} in short-term assets for every $1 of short-term debt — very liquid.`;
      if (v >= 1.0) return `Your business has $${v.toFixed(2)} in short-term assets per $1 of debt — adequate liquidity.`;
      return `Short-term assets are less than short-term debt — this may signal cash flow pressure.`;
    },
    bankerContext: (v) =>
      `Current ratio ${v.toFixed(2)}x. ${v < 1.0 ? "Working capital deficit." : v < 1.5 ? "Thin liquidity." : "Healthy liquidity."}`,
    formulaDescription: "Current Assets / Current Liabilities",
  },
  {
    metricKey: "leverage_ratio",
    label: "Leverage Ratio",
    explain: (v) => {
      if (v <= 2.0) return `Your business borrows $${v.toFixed(1)} for every $1 of equity — conservative leverage.`;
      if (v <= 4.0) return `Your business borrows $${v.toFixed(1)} for every $1 of equity — moderate leverage.`;
      return `Your business has $${v.toFixed(1)} of debt per $1 of equity — high leverage that lenders will scrutinize.`;
    },
    bankerContext: (v) =>
      `Leverage ${v.toFixed(2)}x. ${v > 4.0 ? "Elevated — stress test sensitivity." : "Within norms."}`,
    formulaDescription: "Total Liabilities / Total Equity",
  },
];

// ============================================================================
// Generate Explanations
// ============================================================================

/**
 * Generate explanations for a set of metric values.
 * Uses templates for known metrics; returns generic for unknown.
 */
export function generateExplanations(
  metrics: { key: string; value: number; threshold?: number; period?: string }[],
): RatioExplanation[] {
  return metrics.map((m) => {
    const template = EXPLANATION_TEMPLATES.find((t) => t.metricKey === m.key);

    if (template) {
      return {
        metricKey: m.key,
        periodLabel: m.period ?? null,
        computedValue: m.value,
        thresholdValue: m.threshold ?? null,
        pass: m.threshold != null ? meetsThreshold(m.key, m.value, m.threshold) : null,
        explanationText: template.explain(m.value, m.threshold),
        bankerNote: template.bankerContext(m.value, m.threshold),
        formulaUsed: template.formulaDescription,
      };
    }

    // Generic fallback
    return {
      metricKey: m.key,
      periodLabel: m.period ?? null,
      computedValue: m.value,
      thresholdValue: m.threshold ?? null,
      pass: null,
      explanationText: `${m.key.replace(/_/g, " ")} is ${m.value.toFixed(2)}.`,
      bankerNote: null,
      formulaUsed: null,
    };
  });
}

/**
 * Check if a metric meets its threshold (direction-aware).
 * Some metrics pass when ABOVE threshold (DSCR), some when BELOW (LTV).
 */
function meetsThreshold(key: string, value: number, threshold: number): boolean {
  // Metrics where lower is better
  const lowerIsBetter = new Set(["ltv", "leverage_ratio"]);
  if (lowerIsBetter.has(key)) return value <= threshold;
  return value >= threshold;
}

// ============================================================================
// Persist Explanations
// ============================================================================

/**
 * Persist ratio explanations to buddy_ratio_explanations.
 * Uses upsert on (deal_id, metric_key, period_label).
 */
export async function persistExplanations(
  sb: SupabaseClient,
  dealId: string,
  explanations: RatioExplanation[],
  snapshotId?: string,
): Promise<void> {
  if (explanations.length === 0) return;

  const rows = explanations.map((e) => ({
    deal_id: dealId,
    metric_key: e.metricKey,
    period_label: e.periodLabel,
    computed_value: e.computedValue,
    threshold_value: e.thresholdValue,
    pass: e.pass,
    explanation_text: e.explanationText,
    banker_note: e.bankerNote,
    formula_used: e.formulaUsed,
    snapshot_id: snapshotId ?? null,
  }));

  const { error } = await sb
    .from("buddy_ratio_explanations")
    .upsert(rows, { onConflict: "deal_id,metric_key,period_label" });

  if (error) {
    console.error("[ratioExplanations] persist failed", { dealId, error });
  }
}
