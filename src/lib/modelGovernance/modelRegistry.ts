/**
 * Canonical Model Registry (Phase H)
 *
 * Static, code-defined registry of every AI model used by Buddy.
 * This is the single source of truth for model governance.
 *
 * Invariants:
 *  - Models are advisory, not autonomous
 *  - Final credit decisions are human-owned
 *  - Every model output is versioned, scoped, explainable, overrideable
 *  - No black-box outputs appear in examiner artifacts
 *  - Registry is code-defined, not DB-driven
 */

export type ModelRegistryEntry = {
  model_id: string;
  purpose: string;
  provider: "openai" | "anthropic" | "internal";
  model_version: string;
  input_scope: string[];
  output_scope: string[];
  decision_authority: "assistive-only";
  human_override_required: true;
  last_reviewed_at: string;
};

/**
 * Canonical model registry.
 * Every AI model used anywhere in Buddy must be listed here.
 */
export const MODEL_REGISTRY: ModelRegistryEntry[] = [
  {
    model_id: "borrower_extraction",
    purpose:
      "Extract borrower identity fields (legal name, EIN, entity type, NAICS, address, owners) " +
      "from uploaded tax returns (1120, 1065, 1120S, 1040) and supporting documents.",
    provider: "openai",
    model_version: "gpt-4o-2024-08-06",
    input_scope: [
      "deal_documents (OCR text)",
      "document_type classification",
    ],
    output_scope: [
      "borrower.legal_name",
      "borrower.entity_type",
      "borrower.ein",
      "borrower.naics_code",
      "borrower.address",
      "borrower.owners[]",
    ],
    decision_authority: "assistive-only",
    human_override_required: true,
    last_reviewed_at: "2026-01-27T00:00:00Z",
  },
  {
    model_id: "financial_normalization",
    purpose:
      "Normalize financial statements from uploaded tax returns and spreads into canonical " +
      "financial facts (income, expenses, NOI, DSCR, LTV). Handles multi-year periods " +
      "and resolves conflicting data sources.",
    provider: "openai",
    model_version: "gpt-4o-2024-08-06",
    input_scope: [
      "deal_documents (OCR text)",
      "financial_spreads",
      "rent_roll_rows",
    ],
    output_scope: [
      "deal_financial_facts.*",
      "financial_snapshot.dscr",
      "financial_snapshot.noi_ttm",
      "financial_snapshot.ltv_*",
      "financial_snapshot.collateral_*",
    ],
    decision_authority: "assistive-only",
    human_override_required: true,
    last_reviewed_at: "2026-01-27T00:00:00Z",
  },
  {
    model_id: "risk_factor_analysis",
    purpose:
      "Analyze underwriting risk factors including policy compliance, concentration risk, " +
      "borrower credit quality, and collateral adequacy. Produces risk narrative and " +
      "confidence scoring for decision support.",
    provider: "openai",
    model_version: "gpt-4o-2024-08-06",
    input_scope: [
      "financial_snapshot",
      "borrower_profile",
      "bank_policy_chunks (via pgvector retrieval)",
      "bank_policy_rules",
    ],
    output_scope: [
      "decision_snapshot.decision_summary",
      "decision_snapshot.confidence",
      "decision_snapshot.confidence_explanation",
      "decision_snapshot.evidence_snapshot_json",
      "decision_snapshot.policy_eval_json",
    ],
    decision_authority: "assistive-only",
    human_override_required: true,
    last_reviewed_at: "2026-01-27T00:00:00Z",
  },
  {
    model_id: "pricing_recommendation",
    purpose:
      "Generate risk-adjusted pricing recommendations based on financial metrics, " +
      "policy constraints, and market benchmarks. Outputs indicative rate, spread, " +
      "and fee structure for human review.",
    provider: "openai",
    model_version: "gpt-4o-2024-08-06",
    input_scope: [
      "financial_snapshot",
      "deal_terms",
      "bank_pricing_policies",
      "market_benchmarks",
    ],
    output_scope: [
      "pricing_quote.indicative_rate",
      "pricing_quote.spread",
      "pricing_quote.fees",
      "pricing_quote.risk_grade",
    ],
    decision_authority: "assistive-only",
    human_override_required: true,
    last_reviewed_at: "2026-01-27T00:00:00Z",
  },
];

/**
 * Look up a model by ID.
 */
export function getModelEntry(modelId: string): ModelRegistryEntry | undefined {
  return MODEL_REGISTRY.find((m) => m.model_id === modelId);
}

/**
 * Validate that no model has autonomous decision authority.
 * This is a runtime invariant check for tests and gate probes.
 */
export function validateGovernanceInvariants(): {
  ok: boolean;
  violations: string[];
} {
  const violations: string[] = [];

  for (const entry of MODEL_REGISTRY) {
    if (entry.decision_authority !== "assistive-only") {
      violations.push(
        `${entry.model_id}: decision_authority is "${entry.decision_authority}", expected "assistive-only"`,
      );
    }
    if (entry.human_override_required !== true) {
      violations.push(
        `${entry.model_id}: human_override_required is ${entry.human_override_required}, expected true`,
      );
    }
    if (!entry.purpose || entry.purpose.length < 10) {
      violations.push(
        `${entry.model_id}: purpose is missing or too short`,
      );
    }
    if (entry.input_scope.length === 0) {
      violations.push(
        `${entry.model_id}: input_scope is empty`,
      );
    }
    if (entry.output_scope.length === 0) {
      violations.push(
        `${entry.model_id}: output_scope is empty`,
      );
    }
  }

  return { ok: violations.length === 0, violations };
}
