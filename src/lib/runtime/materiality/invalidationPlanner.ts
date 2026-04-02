/**
 * Invalidation Planner — Phase 66B Material Change Engine
 *
 * Pure function. Given a change type and scope, determines which downstream
 * systems need recomputation.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ChangeType =
  | "document_uploaded"
  | "loan_amount_changed"
  | "entity_name_changed"
  | "financial_data_updated"
  | "structure_changed"
  | "benchmark_refreshed"
  | "manual_override"
  | "monitoring_signal";

export type ChangeScope = "trivial" | "localized" | "material" | "mission_wide";

export interface InvalidationPlan {
  affectedStages: string[];
  affectedInsightModules: string[];
  affectedScenarios: boolean;
  affectedBenchmarks: boolean;
  memoUsableDuringRefresh: boolean;
  rationale: string;
}

// ---------------------------------------------------------------------------
// Invalidation map
// ---------------------------------------------------------------------------

interface InvalidationTemplate {
  stages: string[];
  insightModules: string[];
  scenarios: boolean;
  benchmarks: boolean;
  memoUsable: boolean;
  rationale: string;
}

const INVALIDATION_MAP: Record<ChangeType, InvalidationTemplate> = {
  document_uploaded: {
    stages: ["extraction", "spreading", "ratios", "snapshot"],
    insightModules: ["financial_analysis", "risk_assessment", "evidence_audit"],
    scenarios: true,
    benchmarks: false,
    memoUsable: false,
    rationale: "New document may change extracted facts, spreads, and downstream ratios",
  },
  loan_amount_changed: {
    stages: ["scenarios", "pricing", "structure"],
    insightModules: ["debt_service", "structure_analysis"],
    scenarios: true,
    benchmarks: false,
    memoUsable: false,
    rationale: "Loan amount directly affects DSCR, LTV, debt service, and pricing scenarios",
  },
  entity_name_changed: {
    stages: ["identity", "matching"],
    insightModules: ["entity_resolution"],
    scenarios: false,
    benchmarks: false,
    memoUsable: true,
    rationale: "Entity name change affects identity resolution but not financial calculations",
  },
  financial_data_updated: {
    stages: ["spreading", "ratios", "snapshot", "scenarios", "pricing"],
    insightModules: ["financial_analysis", "risk_assessment", "trend_analysis"],
    scenarios: true,
    benchmarks: false,
    memoUsable: false,
    rationale: "Financial data change cascades through spreads, ratios, snapshot, and pricing",
  },
  structure_changed: {
    stages: ["scenarios", "pricing", "structure", "policy"],
    insightModules: ["structure_analysis", "policy_compliance", "debt_service"],
    scenarios: true,
    benchmarks: false,
    memoUsable: false,
    rationale: "Structure change affects scenario modeling, pricing, and policy compliance",
  },
  benchmark_refreshed: {
    stages: ["benchmarks", "scenarios"],
    insightModules: ["peer_comparison", "industry_analysis"],
    scenarios: true,
    benchmarks: true,
    memoUsable: true,
    rationale: "Benchmark refresh updates peer comparisons but core deal data is unchanged",
  },
  manual_override: {
    stages: ["snapshot", "scenarios", "pricing"],
    insightModules: ["risk_assessment", "override_audit"],
    scenarios: true,
    benchmarks: false,
    memoUsable: false,
    rationale: "Manual override may alter snapshot inputs, requiring downstream recomputation",
  },
  monitoring_signal: {
    stages: ["monitoring", "risk"],
    insightModules: ["covenant_tracking", "early_warning", "portfolio_impact"],
    scenarios: false,
    benchmarks: false,
    memoUsable: true,
    rationale: "Monitoring signal affects risk assessment but does not change deal financials",
  },
};

// ---------------------------------------------------------------------------
// Scope amplifiers — wider scope expands the affected surface
// ---------------------------------------------------------------------------

function amplifyByScope(
  base: InvalidationTemplate,
  scope: ChangeScope,
): InvalidationPlan {
  if (scope === "trivial") {
    // Trivial scope: keep stages minimal, memo always usable
    return {
      affectedStages: base.stages.slice(0, 1),
      affectedInsightModules: base.insightModules.slice(0, 1),
      affectedScenarios: false,
      affectedBenchmarks: false,
      memoUsableDuringRefresh: true,
      rationale: `[trivial] ${base.rationale}`,
    };
  }

  if (scope === "localized") {
    return {
      affectedStages: base.stages,
      affectedInsightModules: base.insightModules,
      affectedScenarios: base.scenarios,
      affectedBenchmarks: base.benchmarks,
      memoUsableDuringRefresh: base.memoUsable,
      rationale: `[localized] ${base.rationale}`,
    };
  }

  if (scope === "material") {
    return {
      affectedStages: [...base.stages, "memo"],
      affectedInsightModules: [...base.insightModules, "memo_generation"],
      affectedScenarios: true,
      affectedBenchmarks: base.benchmarks,
      memoUsableDuringRefresh: false,
      rationale: `[material] ${base.rationale}`,
    };
  }

  // mission_wide — everything must recompute
  return {
    affectedStages: [
      ...new Set([
        ...base.stages,
        "extraction",
        "spreading",
        "ratios",
        "snapshot",
        "scenarios",
        "pricing",
        "memo",
      ]),
    ],
    affectedInsightModules: [
      ...new Set([...base.insightModules, "financial_analysis", "risk_assessment", "memo_generation"]),
    ],
    affectedScenarios: true,
    affectedBenchmarks: true,
    memoUsableDuringRefresh: false,
    rationale: `[mission_wide] ${base.rationale}`,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function planInvalidation(
  changeType: ChangeType,
  changeScope: ChangeScope,
): InvalidationPlan {
  const template = INVALIDATION_MAP[changeType];
  return amplifyByScope(template, changeScope);
}
