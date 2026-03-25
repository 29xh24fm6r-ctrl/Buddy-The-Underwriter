/**
 * Structuring scenario scoring engine.
 * Weighted scoring across policy resolution, disruption, realism, defensibility.
 * Pure module — no DB, no server-only.
 */

import type { StructuringScenario } from "./types";
import type { StructuringEngineInput } from "./generateStructuringScenarios";

// ── Weights ──────────────────────────────────────────────────────

const W_POLICY_RESOLUTION = 40;
const W_MINIMAL_DISRUPTION = 25;
const W_OPERATIONAL_REALISM = 20;
const W_DEFENSIBILITY = 15;

// ── Scorer ───────────────────────────────────────────────────────

export function scoreStructuringScenario(
  scenario: StructuringScenario,
  input: StructuringEngineInput,
): number {
  let score = 0;

  // A. Policy resolution strength (0–40)
  const totalExceptions = input.policy_exceptions.length;
  if (totalExceptions > 0) {
    const resolvedPct = scenario.resolves_exception_keys.length / totalExceptions;
    score += resolvedPct * W_POLICY_RESOLUTION;
  } else {
    // No exceptions — all scenarios score full resolution
    score += W_POLICY_RESOLUTION;
  }

  // B. Minimal structural disruption (0–25)
  const disruptionPenalty = computeDisruptionPenalty(scenario, input);
  score += (1 - disruptionPenalty) * W_MINIMAL_DISRUPTION;

  // C. Operational realism (0–20)
  const realismScore = computeRealismScore(scenario);
  score += realismScore * W_OPERATIONAL_REALISM;

  // D. Committee defensibility (0–15)
  if (scenario.path_type === "inside_policy") {
    score += W_DEFENSIBILITY;
  } else if (scenario.path_type === "ready_with_exceptions") {
    score += W_DEFENSIBILITY * 0.6;
  } else {
    score += W_DEFENSIBILITY * 0.2;
  }

  return Math.round(score);
}

// ── Sub-scores ───────────────────────────────────────────────────

function computeDisruptionPenalty(
  scenario: StructuringScenario,
  input: StructuringEngineInput,
): number {
  const loanAmt = input.requested_amount ?? 0;
  if (loanAmt <= 0) return 0;

  // Loan reduction disruption
  if (scenario.recommendation_type === "reduce_loan_amount" && scenario.projected_loan_amount != null) {
    const reductionPct = (loanAmt - scenario.projected_loan_amount) / loanAmt;
    return Math.min(reductionPct, 1); // 0-1 scale
  }

  // Equity increase disruption
  if (scenario.recommendation_type === "increase_equity") {
    const reqPct = input.equity_required_pct ?? 0;
    const actPct = input.equity_actual_pct ?? 0;
    const deltaPct = Math.abs(reqPct - actPct);
    return Math.min(deltaPct * 2, 1); // Scale: 50% shortfall = full penalty
  }

  // Add collateral — moderate disruption
  if (scenario.recommendation_type === "add_collateral") return 0.4;

  // Valuation upgrade — low disruption
  if (scenario.recommendation_type === "improve_valuation_support") return 0.2;

  // Exception path — no structural disruption
  if (scenario.recommendation_type === "convert_to_exception_path") return 0;

  // Defer — no disruption but no resolution
  if (scenario.recommendation_type === "defer_until_missing_inputs_resolved") return 0.1;

  return 0.5;
}

function computeRealismScore(scenario: StructuringScenario): number {
  // Actions the banker can execute immediately score highest
  const immediateKinds = new Set(["set_loan_amount", "set_equity_amount", "set_equity_pct", "proceed_with_exception"]);
  const totalActions = scenario.actions.length;
  if (totalActions === 0) return 0.5;

  const immediateActions = scenario.actions.filter((a) => immediateKinds.has(a.kind)).length;
  return immediateActions / totalActions;
}
