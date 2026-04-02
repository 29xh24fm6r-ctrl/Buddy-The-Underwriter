/**
 * Phase 66C — Outcome Measurement: Metric types and computation helpers.
 * Pure module — no server-only, no DB access.
 */

export type OutcomeMetricKey =
  | "time_to_research_completion"
  | "time_to_memo"
  | "time_to_borrower_readiness"
  | "doc_turnaround_speed"
  | "recommendation_acceptance_rate"
  | "borrower_action_completion_rate"
  | "recompute_avoidance_rate"
  | "banker_trust_score"
  | "borrower_usefulness_score"
  | "deal_conversion_lift"
  | "readiness_lift"
  | "override_rate"
  | "false_warning_rate"
  | "stale_guidance_rate";

export interface OutcomeMetric {
  key: OutcomeMetricKey;
  value: number;
  unit: string;
  direction: "higher_better" | "lower_better";
  benchmark?: number;
}

/** Safe division — returns 0 when denominator is 0. */
export function computeRate(numerator: number, denominator: number): number {
  if (denominator === 0) return 0;
  return numerator / denominator;
}

/** Percentage change from before to after. Returns 0 when before is 0. */
export function computeLift(before: number, after: number): number {
  if (before === 0) return 0;
  return ((after - before) / before) * 100;
}
