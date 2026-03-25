/**
 * Deterministic structuring scenario generation.
 * Takes live deal state and produces actionable scenarios.
 * Pure module — no DB, no server-only.
 */

import type { BuilderReadiness, BuilderPolicyException } from "@/lib/builder/builderTypes";
import type { CollateralLtvSummary } from "@/lib/builder/collateralLtv";
import type { BuilderPolicyResolution } from "@/lib/builder/builderPolicyResolver";
import type { NormalizedCollateralItem } from "@/lib/builder/normalizeCollateralItem";
import type { StructuringScenario, StructuringAction } from "./types";
import { scoreStructuringScenario } from "./scoreStructuringScenario";

// ── Input ────────────────────────────────────────────────────────

export type StructuringEngineInput = {
  deal_id: string;
  requested_amount: number | null;
  ltv: CollateralLtvSummary;
  equity_required_pct?: number | null;
  equity_actual_pct?: number | null;
  equity_actual_amount?: number | null;
  base_transaction_amount?: number | null;
  collateral_items: NormalizedCollateralItem[];
  policy_exceptions: BuilderPolicyException[];
  readiness: BuilderReadiness;
  policy_resolution: BuilderPolicyResolution;
};

// ── Generator ────────────────────────────────────────────────────

export function generateStructuringScenarios(
  input: StructuringEngineInput,
): StructuringScenario[] {
  const scenarios: StructuringScenario[] = [];
  const activeExceptionKeys = input.policy_exceptions.map((e) => e.type);
  const loanAmt = input.requested_amount ?? 0;

  // Scenario A — Reduce loan amount to meet policy
  const ltvExceeded = input.ltv.ltv != null && input.ltv.policyLimit != null && input.ltv.ltv > input.ltv.policyLimit;
  if (ltvExceeded && input.ltv.totalLendableValue > 0 && input.ltv.policyLimit != null) {
    const maxLoan = Math.floor(input.ltv.totalLendableValue * input.ltv.policyLimit);
    if (maxLoan > 0 && maxLoan < loanAmt) {
      const reduction = loanAmt - maxLoan;
      const projectedLtv = maxLoan / input.ltv.totalLendableValue;
      scenarios.push({
        id: `scn_reduce_loan_${maxLoan}`,
        label: "Reduce loan to meet policy",
        recommendation_type: "reduce_loan_amount",
        summary: `Reduce loan from $${loanAmt.toLocaleString()} to $${maxLoan.toLocaleString()} (−$${reduction.toLocaleString()}) to achieve ${(projectedLtv * 100).toFixed(1)}% LTV within policy.`,
        projected_loan_amount: maxLoan,
        projected_lendable_value: input.ltv.totalLendableValue,
        projected_ltv: projectedLtv,
        projected_gross_collateral_value: input.ltv.totalGrossValue,
        resolves_exception_keys: ["ltv_exceeded"],
        remaining_exception_keys: activeExceptionKeys.filter((k) => k !== "ltv_exceeded"),
        new_exception_keys: [],
        actions: [{ kind: "set_loan_amount", from: loanAmt, to: maxLoan }],
        tradeoffs: [`Loan amount reduced by $${reduction.toLocaleString()}`],
        assumptions: ["Current collateral and advance rates remain unchanged"],
        rationale: `Reducing the loan to $${maxLoan.toLocaleString()} brings LTV to ${(projectedLtv * 100).toFixed(1)}%, within the ${(input.ltv.policyLimit * 100).toFixed(0)}% policy limit.`,
        recommendation_score: 0,
        recommendation_band: "best",
        path_type: "inside_policy",
      });
    }
  }

  // Scenario B — Increase equity to close shortfall
  const equityShortfall =
    input.equity_required_pct != null &&
    input.equity_actual_pct != null &&
    input.equity_actual_pct < input.equity_required_pct;
  if (equityShortfall && input.base_transaction_amount != null && input.base_transaction_amount > 0) {
    const reqAmt = input.equity_required_pct! * input.base_transaction_amount;
    const actAmt = input.equity_actual_amount ?? (input.equity_actual_pct! * input.base_transaction_amount);
    const additional = reqAmt - actAmt;
    if (additional > 0) {
      scenarios.push({
        id: `scn_increase_equity_${Math.round(input.equity_required_pct! * 100)}`,
        label: "Increase equity to meet requirement",
        recommendation_type: "increase_equity",
        summary: `Increase equity injection from ${(input.equity_actual_pct! * 100).toFixed(0)}% to ${(input.equity_required_pct! * 100).toFixed(0)}% (+$${additional.toLocaleString(undefined, { maximumFractionDigits: 0 })}).`,
        projected_equity_pct: input.equity_required_pct,
        projected_equity_amount: reqAmt,
        resolves_exception_keys: ["equity_shortfall"],
        remaining_exception_keys: activeExceptionKeys.filter((k) => k !== "equity_shortfall"),
        new_exception_keys: [],
        actions: [
          { kind: "set_equity_pct", from: input.equity_actual_pct, to: input.equity_required_pct! },
          { kind: "set_equity_amount", from: actAmt, to: reqAmt },
        ],
        tradeoffs: [`Borrower must provide additional $${additional.toLocaleString(undefined, { maximumFractionDigits: 0 })}`],
        assumptions: ["Transaction base amount remains unchanged"],
        rationale: `Increasing equity to ${(input.equity_required_pct! * 100).toFixed(0)}% meets the policy requirement and eliminates the equity shortfall exception.`,
        recommendation_score: 0,
        recommendation_band: "strong",
        path_type: "inside_policy",
      });
    }
  }

  // Scenario C — Add collateral
  if (ltvExceeded && loanAmt > 0 && input.ltv.policyLimit != null) {
    const requiredLendable = loanAmt / input.ltv.policyLimit;
    const gap = requiredLendable - input.ltv.totalLendableValue;
    if (gap > 0) {
      scenarios.push({
        id: "scn_add_collateral",
        label: "Add eligible collateral",
        recommendation_type: "add_collateral",
        summary: `Add $${gap.toLocaleString(undefined, { maximumFractionDigits: 0 })} of additional lendable collateral value to support the current loan request within policy.`,
        projected_lendable_value: requiredLendable,
        projected_ltv: loanAmt / requiredLendable,
        resolves_exception_keys: ["ltv_exceeded"],
        remaining_exception_keys: activeExceptionKeys.filter((k) => k !== "ltv_exceeded"),
        new_exception_keys: [],
        actions: [{ kind: "require_additional_collateral", additional_lendable_value_needed: gap }],
        tradeoffs: ["Requires identification and pledging of additional eligible assets"],
        assumptions: ["Additional collateral meets bank advance rate and valuation standards"],
        rationale: `Adding $${gap.toLocaleString(undefined, { maximumFractionDigits: 0 })} of policy-adjusted lendable value brings total support to $${requiredLendable.toLocaleString(undefined, { maximumFractionDigits: 0 })}, sufficient for the requested loan at the current policy limit.`,
        recommendation_score: 0,
        recommendation_band: "possible",
        path_type: "inside_policy",
      });
    }
  }

  // Scenario D — Improve valuation support
  const missingValuation = input.collateral_items.filter((c) => !c.valuation_method || c.valuation_method === "management_stated_value");
  if (missingValuation.length > 0) {
    const actions: StructuringAction[] = missingValuation.map((c) => ({
      kind: "require_valuation_upgrade" as const,
      collateral_id: c.id,
      from_method: c.valuation_method ?? null,
      to_method_hint: "appraisal",
    }));
    scenarios.push({
      id: "scn_improve_valuation",
      label: "Strengthen valuation support",
      recommendation_type: "improve_valuation_support",
      summary: `Obtain formal appraisal or stronger valuation for ${missingValuation.length} collateral item${missingValuation.length > 1 ? "s" : ""} currently relying on weak or missing valuation methodology.`,
      resolves_exception_keys: activeExceptionKeys.filter((k) => k === "missing_valuation_method"),
      remaining_exception_keys: activeExceptionKeys.filter((k) => k !== "missing_valuation_method"),
      new_exception_keys: [],
      actions,
      tradeoffs: ["Appraisal costs and timeline"],
      assumptions: ["Formal valuation does not materially reduce collateral value"],
      rationale: "Stronger valuation support improves committee defensibility and may resolve valuation-related exceptions.",
      recommendation_score: 0,
      recommendation_band: "possible",
      path_type: "inside_policy",
    });
  }

  // Scenario E — Exception path
  if (activeExceptionKeys.length > 0) {
    scenarios.push({
      id: "scn_exception_path",
      label: "Proceed with exception",
      recommendation_type: "convert_to_exception_path",
      summary: `Retain current structure, document ${activeExceptionKeys.length} policy exception${activeExceptionKeys.length > 1 ? "s" : ""} with mitigants, and submit as Credit Ready with Exceptions.`,
      projected_loan_amount: loanAmt,
      resolves_exception_keys: [],
      remaining_exception_keys: activeExceptionKeys,
      new_exception_keys: [],
      actions: [{
        kind: "proceed_with_exception",
        exception_keys: activeExceptionKeys,
        required_mitigants: ["Document compensating factors for each active exception"],
      }],
      tradeoffs: ["Requires committee acceptance of policy variance", "Additional documentation burden"],
      assumptions: ["Deal has sufficient mitigating support for committee consideration"],
      rationale: "If the borrower cannot or will not adjust the proposed structure, the deal may still proceed with documented exceptions and committee approval.",
      recommendation_score: 0,
      recommendation_band: "exception_only",
      path_type: "ready_with_exceptions",
    });
  }

  // Scenario F — Defer until inputs resolved
  const unresolvedBlockers = input.readiness.credit_ready_blockers.filter((b) => b.severity === "blocker");
  if (unresolvedBlockers.length > 0) {
    const actions: StructuringAction[] = unresolvedBlockers.slice(0, 5).map((b) => ({
      kind: "resolve_missing_input" as const,
      blocker_key: b.key,
      field_hint: b.label,
    }));
    scenarios.push({
      id: "scn_defer_inputs",
      label: "Resolve missing inputs first",
      recommendation_type: "defer_until_missing_inputs_resolved",
      summary: `${unresolvedBlockers.length} critical input${unresolvedBlockers.length > 1 ? "s" : ""} must be resolved before a defensible structuring recommendation can be made.`,
      resolves_exception_keys: [],
      remaining_exception_keys: activeExceptionKeys,
      new_exception_keys: [],
      actions,
      tradeoffs: ["Delays structuring recommendation"],
      assumptions: ["Missing inputs will become available"],
      rationale: "Structuring recommendations are unreliable without complete critical inputs. Resolve blockers first.",
      recommendation_score: 0,
      recommendation_band: "possible",
      path_type: "not_yet_ready",
    });
  }

  // Score all scenarios
  for (const scenario of scenarios) {
    scenario.recommendation_score = scoreStructuringScenario(scenario, input);
  }

  // Sort by score descending
  scenarios.sort((a, b) => b.recommendation_score - a.recommendation_score);

  // Assign bands based on rank
  if (scenarios.length > 0) {
    scenarios[0].recommendation_band = "best";
    for (let i = 1; i < scenarios.length; i++) {
      if (scenarios[i].path_type === "inside_policy") {
        scenarios[i].recommendation_band = "strong";
      } else if (scenarios[i].path_type === "ready_with_exceptions") {
        scenarios[i].recommendation_band = "exception_only";
      } else {
        scenarios[i].recommendation_band = "possible";
      }
    }
  }

  return scenarios;
}
