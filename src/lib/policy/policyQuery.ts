/**
 * Query bank_policy_rules for resolved policy values.
 * Server module — uses Supabase client.
 */
import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

// ── Types ────────────────────────────────────────────────────────

export type PolicyRule = {
  id: string;
  bank_id: string;
  policy_type: string;
  collateral_type: string | null;
  product_type: string | null;
  min_value: number | null;
  max_value: number | null;
  rule_value: number | null;
  rule_unit: string | null;
  policy_reference: string | null;
  source_document_id: string | null;
  confidence: number | null;
};

export type PolicyLookupResult = {
  advance_rates: Record<string, { rate: number; reference: string | null; confidence: number | null }>;
  equity_requirement: { pct: number; reference: string | null; confidence: number | null } | null;
  ltv_limit: { limit: number; reference: string | null; confidence: number | null } | null;
};

// ── Query ────────────────────────────────────────────────────────

/**
 * Load all policy rules for a bank, optionally filtered by product type.
 */
export async function loadBankPolicyRules(
  sb: SupabaseClient,
  bankId: string,
  productType?: string | null,
): Promise<PolicyRule[]> {
  let query = sb
    .from("bank_policy_rules")
    .select("*")
    .eq("bank_id", bankId)
    .order("confidence", { ascending: false, nullsFirst: false });

  // Include rules matching the product type OR generic (null product_type)
  if (productType) {
    query = query.or(`product_type.eq.${productType},product_type.is.null`);
  }

  const { data, error } = await query;
  if (error) {
    console.error("[policyQuery] loadBankPolicyRules failed:", error.message);
    return [];
  }
  return (data ?? []) as PolicyRule[];
}

/**
 * Resolve policy rules into a structured lookup result.
 * More specific rules (with collateral_type/product_type) win over generic.
 * Higher confidence wins within same specificity.
 */
export function resolvePolicyRules(
  rules: PolicyRule[],
  collateralTypes: string[],
): PolicyLookupResult {
  const advance_rates: PolicyLookupResult["advance_rates"] = {};
  let equity_requirement: PolicyLookupResult["equity_requirement"] = null;
  let ltv_limit: PolicyLookupResult["ltv_limit"] = null;

  // Advance rates — find best match per collateral type
  for (const ct of collateralTypes) {
    const matches = rules
      .filter((r) => r.policy_type === "advance_rate" && r.collateral_type === ct)
      .sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0));

    if (matches.length > 0 && matches[0].rule_value != null) {
      advance_rates[ct] = {
        rate: matches[0].rule_value,
        reference: matches[0].policy_reference,
        confidence: matches[0].confidence,
      };
    }
  }

  // Equity requirement — best match
  const equityRules = rules
    .filter((r) => r.policy_type === "equity_requirement")
    .sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0));

  if (equityRules.length > 0 && equityRules[0].rule_value != null) {
    equity_requirement = {
      pct: equityRules[0].rule_value,
      reference: equityRules[0].policy_reference,
      confidence: equityRules[0].confidence,
    };
  }

  // LTV limit — best match
  const ltvRules = rules
    .filter((r) => r.policy_type === "ltv_limit")
    .sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0));

  if (ltvRules.length > 0 && ltvRules[0].rule_value != null) {
    ltv_limit = {
      limit: ltvRules[0].rule_value,
      reference: ltvRules[0].policy_reference,
      confidence: ltvRules[0].confidence,
    };
  }

  return { advance_rates, equity_requirement, ltv_limit };
}
