/**
 * Canonical Credit Memo Provenance
 *
 * Tracks the provenance of every computed field in the canonical memo.
 * Ensures memo numerics are:
 *   1. Reproducible from canonical state
 *   2. Traceable to their source (snapshot, facts, pricing)
 *   3. Stale-detectable when canonical state changes
 *   4. Never dependent on deal_memo_overrides for computed values
 *
 * Pure module — no DB, no server-only.
 */

import { createHash } from "node:crypto";

// ── Provenance Types ──────────────────────────────────────────────────────

export type MemoFieldSource =
  | "canonical_snapshot"
  | "canonical_facts"
  | "canonical_pricing"
  | "canonical_deal"
  | "computed"
  | "qualitative_override";

export type MemoFieldProvenance = {
  field: string;
  source: MemoFieldSource;
  sourceDetail: string;
  value: number | string | null;
  updatedAt: string | null;
};

export type MemoProvenanceManifest = {
  version: "provenance_v1";
  dealId: string;
  generatedAt: string;
  inputHash: string;
  computedFieldCount: number;
  qualitativeFieldCount: number;
  fields: MemoFieldProvenance[];
};

// ── Computed Fields Registry ──────────────────────────────────────────────

/**
 * All computed memo fields and their canonical source.
 * Any field NOT in this list that appears as numeric in the memo is a bug.
 */
export const COMPUTED_MEMO_FIELDS: ReadonlyArray<{
  field: string;
  source: MemoFieldSource;
  sourceDetail: string;
}> = [
  // Key metrics — all from snapshot
  { field: "dscr_global", source: "canonical_snapshot", sourceDetail: "dscr" },
  { field: "dscr_stressed_300bps", source: "canonical_snapshot", sourceDetail: "dscr_stressed_300bps" },
  { field: "cash_flow_available", source: "canonical_snapshot", sourceDetail: "cash_flow_available" },
  { field: "annual_debt_service", source: "canonical_snapshot", sourceDetail: "annual_debt_service" },
  { field: "excess_cash_flow", source: "canonical_snapshot", sourceDetail: "excess_cash_flow" },

  // Collateral — from snapshot
  { field: "collateral_gross_value", source: "canonical_snapshot", sourceDetail: "collateral_gross_value" },
  { field: "collateral_net_value", source: "canonical_snapshot", sourceDetail: "collateral_net_value" },
  { field: "collateral_discounted_value", source: "canonical_snapshot", sourceDetail: "collateral_discounted_value" },

  // LTV — computed from snapshot values
  { field: "ltv_gross", source: "computed", sourceDetail: "bank_loan_total / collateral_gross_value" },
  { field: "ltv_net", source: "computed", sourceDetail: "bank_loan_total / collateral_net_value" },
  { field: "discounted_coverage", source: "computed", sourceDetail: "collateral_discounted_value / bank_loan_total" },

  // Sources & uses — from snapshot
  { field: "total_project_cost", source: "canonical_snapshot", sourceDetail: "total_project_cost" },
  { field: "borrower_equity", source: "canonical_snapshot", sourceDetail: "borrower_equity" },
  { field: "borrower_equity_pct", source: "canonical_snapshot", sourceDetail: "borrower_equity_pct" },
  { field: "bank_loan_total", source: "canonical_snapshot", sourceDetail: "bank_loan_total" },

  // Financial analysis — from snapshot
  { field: "noi_ttm", source: "canonical_snapshot", sourceDetail: "noi_ttm" },
  { field: "revenue", source: "canonical_snapshot", sourceDetail: "revenue" },
  { field: "ebitda", source: "canonical_snapshot", sourceDetail: "ebitda" },
  { field: "net_income", source: "canonical_snapshot", sourceDetail: "net_income" },
  { field: "working_capital", source: "canonical_snapshot", sourceDetail: "working_capital" },
  { field: "current_ratio", source: "canonical_snapshot", sourceDetail: "current_ratio" },
  { field: "debt_to_equity", source: "canonical_snapshot", sourceDetail: "debt_to_equity" },

  // Pricing — from pricing decisions
  { field: "rate_index", source: "canonical_pricing", sourceDetail: "pricing_decisions.index_code" },
  { field: "spread_bps", source: "canonical_pricing", sourceDetail: "pricing_decisions.spread_bps" },
  { field: "initial_rate", source: "canonical_pricing", sourceDetail: "pricing_decisions.initial_rate_pct" },
  { field: "term_months", source: "canonical_pricing", sourceDetail: "pricing_decisions.term_months" },
  { field: "amort_months", source: "canonical_pricing", sourceDetail: "pricing_decisions.amort_months" },

  // Period facts — from canonical facts table
  { field: "period_revenue", source: "canonical_facts", sourceDetail: "TOTAL_REVENUE by period" },
  { field: "period_net_income", source: "canonical_facts", sourceDetail: "NET_INCOME by period" },
  { field: "period_ebitda", source: "canonical_facts", sourceDetail: "EBITDA by period" },
  { field: "period_depreciation", source: "canonical_facts", sourceDetail: "DEPRECIATION by period" },
  { field: "period_interest_expense", source: "canonical_facts", sourceDetail: "INTEREST_EXPENSE by period" },
] as const;

/**
 * Qualitative memo fields that ARE permitted from overrides.
 */
export const QUALITATIVE_MEMO_FIELDS = [
  "business_description",
  "revenue_mix",
  "seasonality",
  "collateral_description",
  "principal_bio",
] as const;

// ── Provenance Hash ──────────────────────────────────────────────────────

/**
 * Compute a deterministic hash of canonical memo inputs.
 * If this hash matches a previously generated memo, the memo is NOT stale.
 */
export function computeMemoInputHash(inputs: {
  snapshotId: string | null;
  snapshotUpdatedAt: string | null;
  pricingDecisionId: string | null;
  pricingUpdatedAt: string | null;
  factCount: number;
  latestFactUpdatedAt: string | null;
}): string {
  const payload = [
    inputs.snapshotId ?? "none",
    inputs.snapshotUpdatedAt ?? "none",
    inputs.pricingDecisionId ?? "none",
    inputs.pricingUpdatedAt ?? "none",
    String(inputs.factCount),
    inputs.latestFactUpdatedAt ?? "none",
  ].join("|");

  return createHash("sha256").update(payload).digest("hex").slice(0, 16);
}

// ── Staleness Detection ──────────────────────────────────────────────────

export type MemoStalenessResult = {
  stale: boolean;
  reasons: string[];
  currentInputHash: string;
  memoInputHash: string | null;
};

/**
 * Check if a previously generated memo is stale relative to current canonical state.
 */
export function checkMemoStaleness(
  currentHash: string,
  memoHash: string | null,
): MemoStalenessResult {
  if (!memoHash) {
    return {
      stale: true,
      reasons: ["No memo has been generated yet"],
      currentInputHash: currentHash,
      memoInputHash: null,
    };
  }

  if (currentHash !== memoHash) {
    return {
      stale: true,
      reasons: ["Canonical state has changed since memo was generated"],
      currentInputHash: currentHash,
      memoInputHash: memoHash,
    };
  }

  return {
    stale: false,
    reasons: [],
    currentInputHash: currentHash,
    memoInputHash: memoHash,
  };
}

// ── Provenance Builder ──────────────────────────────────────────────────

/**
 * Build a provenance manifest from a generated memo's computed values.
 * This proves which canonical source each computed field came from.
 */
export function buildProvenanceManifest(
  dealId: string,
  inputHash: string,
  computedValues: Array<{ field: string; value: number | string | null; updatedAt: string | null }>,
  qualitativeValues: Array<{ field: string; value: string | null }>,
): MemoProvenanceManifest {
  const computedFields: MemoFieldProvenance[] = computedValues.map((cv) => {
    const def = COMPUTED_MEMO_FIELDS.find((f) => f.field === cv.field);
    return {
      field: cv.field,
      source: def?.source ?? "computed",
      sourceDetail: def?.sourceDetail ?? "unknown",
      value: cv.value,
      updatedAt: cv.updatedAt,
    };
  });

  const qualitativeFields: MemoFieldProvenance[] = qualitativeValues.map((qv) => ({
    field: qv.field,
    source: "qualitative_override" as const,
    sourceDetail: "deal_memo_overrides",
    value: qv.value,
    updatedAt: null,
  }));

  return {
    version: "provenance_v1",
    dealId,
    generatedAt: new Date().toISOString(),
    inputHash,
    computedFieldCount: computedFields.length,
    qualitativeFieldCount: qualitativeFields.length,
    fields: [...computedFields, ...qualitativeFields],
  };
}
