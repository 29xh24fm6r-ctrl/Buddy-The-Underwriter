/**
 * Credit Committee Governance
 * 
 * Deterministic logic to evaluate whether a decision requires
 * credit committee approval based on bank-configured rules.
 * 
 * PRINCIPLE: "AI explains, rules decide"
 * - Rules are stored in bank_credit_committee_policies.rules_json
 * - AI can suggest rules from policy docs, but rules are canonical
 * - This module only executes deterministic checks
 */

import { supabaseAdmin } from "@/lib/supabase/admin";

export interface CreditCommitteeEvaluation {
  committee_required: boolean;
  required: boolean;
  reasons: string[];
  policy: {
    enabled: boolean;
    rules: Record<string, any>;
    derived_from_upload_id: string | null;
  } | null;
}

export async function requiresCreditCommittee(args: {
  bankId: string;
  decisionSnapshot: any;
}): Promise<CreditCommitteeEvaluation> {
  const sb = supabaseAdmin();

  // Fetch bank's credit committee policy
  const { data: policy } = await sb
    .from("bank_credit_committee_policies")
    .select("*")
    .eq("bank_id", args.bankId)
    .maybeSingle();

  if (!policy?.enabled) {
    return {
      committee_required: false,
      required: false,
      reasons: [],
      policy: null
    };
  }

  const rules = policy.rules_json || {};
  const snap = args.decisionSnapshot;
  const reasons: string[] = [];

  // Rule: Loan amount exceeds threshold
  if (rules.loan_amount_gt && snap.inputs_json?.loan_amount > rules.loan_amount_gt) {
    reasons.push(`Loan amount ($${snap.inputs_json.loan_amount.toLocaleString()}) exceeds committee threshold ($${rules.loan_amount_gt.toLocaleString()})`);
  }

  // Rule: DSCR below policy minimum
  if (rules.dscr_lt && snap.policy_eval_json?.dscr < rules.dscr_lt) {
    reasons.push(`DSCR (${snap.policy_eval_json.dscr.toFixed(2)}) below committee threshold (${rules.dscr_lt})`);
  }

  // Rule: LTV exceeds maximum
  if (rules.ltv_gt && snap.policy_eval_json?.ltv > rules.ltv_gt) {
    reasons.push(`LTV (${(snap.policy_eval_json.ltv * 100).toFixed(1)}%) exceeds committee threshold (${(rules.ltv_gt * 100).toFixed(1)}%)`);
  }

  // Rule: Risk rating at or above threshold
  if (rules.risk_rating_gte && snap.policy_eval_json?.risk_rating >= rules.risk_rating_gte) {
    reasons.push(`Risk rating (${snap.policy_eval_json.risk_rating}) requires committee review`);
  }

  // Rule: Policy exceptions present
  if (rules.exceptions_present && (snap.exceptions_json?.length ?? 0) > 0) {
    reasons.push(`${snap.exceptions_json.length} policy exception(s) require committee review`);
  }

  // Rule: Collateral shortfall exceeds threshold
  if (rules.collateral_shortfall_gt && snap.policy_eval_json?.collateral_shortfall > rules.collateral_shortfall_gt) {
    reasons.push(`Collateral shortfall ($${snap.policy_eval_json.collateral_shortfall.toLocaleString()}) exceeds committee threshold`);
  }

  return {
    committee_required: reasons.length > 0,
    required: reasons.length > 0,
    reasons,
    policy: {
      enabled: policy.enabled,
      rules: policy.rules_json,
      derived_from_upload_id: policy.derived_from_upload_id
    }
  };
}

/**
 * Extract credit committee rules from uploaded credit policy document.
 * 
 * USAGE:
 * 1. Bank uploads credit policy PDF
 * 2. Call this function with extracted text
 * 3. AI suggests rules_json structure
 * 4. Human reviews + approves suggested rules
 * 5. Rules are saved to bank_credit_committee_policies
 * 
 * NOTE: This is AI-assisted extraction, but humans approve.
 */
export async function extractCommitteeRulesFromPolicy(args: {
  bankId: string;
  uploadId: string;
  policyText: string;
}): Promise<{
  suggested_rules: Record<string, any>;
  confidence: string;
  explanation: string;
}> {
  // TODO: Call aiJson() to extract structured rules from policy text
  // For now, return empty structure
  
  return {
    suggested_rules: {
      loan_amount_gt: null,
      dscr_lt: null,
      ltv_gt: null,
      risk_rating_gte: null,
      exceptions_present: null
    },
    confidence: "low",
    explanation: "Auto-extraction not yet implemented. Configure rules manually in Bank Settings."
  };
}
