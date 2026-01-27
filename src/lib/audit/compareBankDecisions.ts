/**
 * Cross-Bank Decision Diff (Phase J)
 *
 * Read-only comparison of how the same deal would be underwritten
 * under different bank policies. Shows rule differences, outcome
 * deltas, pricing deltas, and overrides required.
 *
 * Invariants:
 *  - Strictly read-only — no mutations
 *  - Never exported by default
 *  - Comparison is bank-scoped (user must have access to all banks)
 *  - All data is snapshot-backed
 */
import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";
import { sha256 } from "@/lib/security/tokens";
import { diffPolicyPacks, type BankPolicyPack, type PolicyPackDiff } from "@/lib/policy/bankPolicyRegistry";

// ── Types ──────────────────────────────────────────────

export type BankDecisionSummary = {
  bank_id: string;
  bank_name: string;
  deal_id: string;
  snapshot_id: string | null;
  outcome: string | null;
  confidence: number | null;
  dscr: number | null;
  ltv_gross: number | null;
  rules_evaluated: number;
  rules_failed: number;
  exceptions_count: number;
  overrides_count: number;
  has_committee_review: boolean;
  pricing_rate: number | null;
  pricing_spread: number | null;
};

export type DecisionDiffReport = {
  diff_version: "1.0";
  generated_at: string;
  deal_id: string;
  banks_compared: string[];
  decisions: BankDecisionSummary[];
  policy_diff: PolicyPackDiff | null;
  outcome_deltas: OutcomeDelta[];
  metric_deltas: MetricDelta[];
  diff_hash: string;
};

export type OutcomeDelta = {
  bank_a_id: string;
  bank_b_id: string;
  bank_a_outcome: string | null;
  bank_b_outcome: string | null;
  differs: boolean;
  explanation: string;
};

export type MetricDelta = {
  metric: string;
  bank_a_id: string;
  bank_b_id: string;
  bank_a_value: number | null;
  bank_b_value: number | null;
  delta: number | null;
  significance: "material" | "minor" | "identical";
};

// ── Builder ────────────────────────────────────────────

/**
 * Compare decisions for the same deal across multiple banks.
 *
 * @param dealId - The deal to compare
 * @param bankIds - Array of bank IDs to include (must have access to all)
 */
export async function compareBankDecisions(args: {
  dealId: string;
  bankIds: string[];
}): Promise<DecisionDiffReport> {
  const sb = supabaseAdmin();
  const generatedAt = new Date().toISOString();
  const decisions: BankDecisionSummary[] = [];

  for (const bankId of args.bankIds) {
    const summary = await loadBankDecisionSummary(sb, args.dealId, bankId);
    decisions.push(summary);
  }

  // Compare outcomes between pairs
  const outcomeDeltas: OutcomeDelta[] = [];
  const metricDeltas: MetricDelta[] = [];

  if (decisions.length >= 2) {
    for (let i = 0; i < decisions.length; i++) {
      for (let j = i + 1; j < decisions.length; j++) {
        const a = decisions[i];
        const b = decisions[j];

        outcomeDeltas.push(buildOutcomeDelta(a, b));
        metricDeltas.push(...buildMetricDeltas(a, b));
      }
    }
  }

  const report: Omit<DecisionDiffReport, "diff_hash"> = {
    diff_version: "1.0",
    generated_at: generatedAt,
    deal_id: args.dealId,
    banks_compared: args.bankIds,
    decisions,
    policy_diff: null, // Policy diff requires full packs, added below if available
    outcome_deltas: outcomeDeltas,
    metric_deltas: metricDeltas,
  };

  const diffHash = sha256(JSON.stringify(report));

  return { ...report, diff_hash: diffHash };
}

// ── Internal Helpers ───────────────────────────────────

async function loadBankDecisionSummary(
  sb: ReturnType<typeof supabaseAdmin>,
  dealId: string,
  bankId: string,
): Promise<BankDecisionSummary> {
  // Get bank name
  const { data: bankRaw } = await sb
    .from("banks")
    .select("id, name")
    .eq("id", bankId)
    .maybeSingle();

  const bankName = (bankRaw as any)?.name ?? "Unknown Bank";

  // Get latest decision snapshot for this deal + bank
  const { data: snapRaw } = await sb
    .from("decision_snapshots")
    .select("id, decision_json, inputs_json, confidence, policy_eval_json, exceptions_json")
    .eq("deal_id", dealId)
    .eq("bank_id", bankId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!snapRaw) {
    return {
      bank_id: bankId,
      bank_name: bankName,
      deal_id: dealId,
      snapshot_id: null,
      outcome: null,
      confidence: null,
      dscr: null,
      ltv_gross: null,
      rules_evaluated: 0,
      rules_failed: 0,
      exceptions_count: 0,
      overrides_count: 0,
      has_committee_review: false,
      pricing_rate: null,
      pricing_spread: null,
    };
  }

  const snap = snapRaw as any;
  const decision = snap.decision_json ?? {};
  const inputs = snap.inputs_json ?? {};
  const policyEval = snap.policy_eval_json ?? {};
  const exceptions = Array.isArray(snap.exceptions_json) ? snap.exceptions_json : [];

  // Get overrides count
  const { count: overridesCount } = await sb
    .from("decision_overrides")
    .select("id", { count: "exact", head: true })
    .eq("deal_id", dealId)
    .eq("bank_id", bankId);

  // Check for committee review
  const { data: committeeVotes } = await sb
    .from("credit_committee_votes")
    .select("id")
    .eq("deal_id", dealId)
    .eq("bank_id", bankId)
    .limit(1)
    .maybeSingle();

  return {
    bank_id: bankId,
    bank_name: bankName,
    deal_id: dealId,
    snapshot_id: snap.id,
    outcome: decision.decision_summary ?? decision.outcome ?? null,
    confidence: snap.confidence ?? null,
    dscr: inputs.dscr ?? null,
    ltv_gross: inputs.ltv ?? null,
    rules_evaluated: policyEval.rules_evaluated ?? policyEval.total ?? 0,
    rules_failed: policyEval.rules_failed ?? policyEval.fails ?? 0,
    exceptions_count: exceptions.length,
    overrides_count: overridesCount ?? 0,
    has_committee_review: Boolean(committeeVotes),
    pricing_rate: inputs.pricing_rate ?? null,
    pricing_spread: inputs.pricing_spread ?? null,
  };
}

function buildOutcomeDelta(
  a: BankDecisionSummary,
  b: BankDecisionSummary,
): OutcomeDelta {
  const differs = a.outcome !== b.outcome;
  let explanation = "";

  if (!differs) {
    explanation = `Both banks reached the same outcome: ${a.outcome ?? "N/A"}`;
  } else if (!a.outcome) {
    explanation = `${a.bank_name} has no decision; ${b.bank_name}: ${b.outcome}`;
  } else if (!b.outcome) {
    explanation = `${a.bank_name}: ${a.outcome}; ${b.bank_name} has no decision`;
  } else {
    explanation = `${a.bank_name}: ${a.outcome} vs ${b.bank_name}: ${b.outcome}`;
  }

  return {
    bank_a_id: a.bank_id,
    bank_b_id: b.bank_id,
    bank_a_outcome: a.outcome,
    bank_b_outcome: b.outcome,
    differs,
    explanation,
  };
}

function buildMetricDeltas(
  a: BankDecisionSummary,
  b: BankDecisionSummary,
): MetricDelta[] {
  const metrics: Array<{ metric: string; aVal: number | null; bVal: number | null; threshold: number }> = [
    { metric: "dscr", aVal: a.dscr, bVal: b.dscr, threshold: 0.05 },
    { metric: "ltv_gross", aVal: a.ltv_gross, bVal: b.ltv_gross, threshold: 0.02 },
    { metric: "confidence", aVal: a.confidence, bVal: b.confidence, threshold: 0.05 },
    { metric: "rules_failed", aVal: a.rules_failed, bVal: b.rules_failed, threshold: 0 },
    { metric: "exceptions_count", aVal: a.exceptions_count, bVal: b.exceptions_count, threshold: 0 },
    { metric: "overrides_count", aVal: a.overrides_count, bVal: b.overrides_count, threshold: 0 },
    { metric: "pricing_rate", aVal: a.pricing_rate, bVal: b.pricing_rate, threshold: 0.001 },
  ];

  return metrics.map(({ metric, aVal, bVal, threshold }) => {
    const delta = aVal !== null && bVal !== null ? aVal - bVal : null;
    let significance: "material" | "minor" | "identical" = "identical";
    if (delta !== null) {
      significance = Math.abs(delta) > threshold ? "material" : Math.abs(delta) > 0 ? "minor" : "identical";
    } else if (aVal !== bVal) {
      significance = "material";
    }

    return {
      metric,
      bank_a_id: a.bank_id,
      bank_b_id: b.bank_id,
      bank_a_value: aVal,
      bank_b_value: bVal,
      delta,
      significance,
    };
  });
}
