import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";
import { sha256 } from "@/lib/security/tokens";
import { stableStringify } from "./buildBorrowerAuditSnapshot";

/**
 * Canonical Credit Decision Audit Snapshot Builder (Phase F)
 *
 * Produces a tamper-evident, deterministic snapshot of an underwriting
 * credit decision including: decision record, financial metrics, policy
 * evaluation, human overrides, attestation chain, and committee record.
 *
 * Invariants:
 *  - Snapshot is read-only
 *  - Snapshot reflects historical truth as-of a timestamp
 *  - Same inputs → same hash (deterministic)
 *  - All timestamps UTC ISO-8601
 *  - Object keys ordered deterministically via stableStringify
 *  - decision_snapshot must be status='final' (immutable)
 *  - Overrides tracked with full before/after visibility
 */

// ── Types ───────────────────────────────────────────────

export type CreditDecisionAuditSnapshot = {
  meta: {
    deal_id: string;
    snapshot_id: string;
    snapshot_version: "1.0";
    generated_at: string;
    as_of: string;
  };

  decision: {
    status: string;
    outcome: string;
    summary: string;
    confidence: number | null;
    confidence_explanation: string;
    created_at: string;
    created_by_user_id: string | null;
    model: Record<string, unknown>;
  };

  financials: {
    dscr: number | null;
    dscr_stressed: number | null;
    ltv_gross: number | null;
    ltv_net: number | null;
    noi_ttm: number | null;
    cash_flow_available: number | null;
    annual_debt_service: number | null;
    collateral_coverage: number | null;
    completeness_pct: number;
    as_of_date: string | null;
  };

  policy: {
    rules_evaluated: number;
    rules_passed: number;
    rules_failed: number;
    exceptions: Array<{
      rule_key: string;
      severity: string;
      reason: string;
    }>;
    policy_eval_summary: Record<string, unknown>;
  };

  overrides: Array<{
    field_path: string;
    old_value: string | null;
    new_value: string | null;
    reason: string;
    justification: string;
    severity: string;
    created_by_user_id: string;
    created_at: string;
  }>;

  attestations: Array<{
    attested_by_user_id: string;
    attested_by_name: string | null;
    attested_role: string;
    statement: string;
    snapshot_hash: string;
    created_at: string;
  }>;

  committee: {
    quorum: number;
    vote_count: number;
    outcome: string;
    complete: boolean;
    votes: Array<{
      voter_user_id: string;
      voter_name: string | null;
      vote: string;
      comment: string | null;
      created_at: string;
    }>;
    minutes: string | null;
    minutes_hash: string | null;
    dissent: Array<{
      dissenter_user_id: string;
      dissenter_name: string | null;
      dissent_reason: string;
      created_at: string;
    }>;
  };

  ledger_events: Array<{
    id: string;
    type: string;
    created_at: string;
  }>;
};

export type CreditDecisionAuditResult = {
  snapshot: CreditDecisionAuditSnapshot;
  snapshot_hash: string;
};

// ── Builder ─────────────────────────────────────────────

export async function buildCreditDecisionAuditSnapshot(opts: {
  dealId: string;
  bankId: string;
  snapshotId: string;
  asOf?: string;
}): Promise<CreditDecisionAuditResult> {
  const sb = supabaseAdmin();
  const asOf = opts.asOf ?? new Date().toISOString();
  const generatedAt = new Date().toISOString();

  // 1) Load decision snapshot (must exist)
  const { data: decRaw } = await sb
    .from("decision_snapshots")
    .select("*")
    .eq("id", opts.snapshotId)
    .eq("deal_id", opts.dealId)
    .maybeSingle();

  if (!decRaw) {
    throw new Error("decision_snapshot_not_found");
  }

  const dec = decRaw as any;

  // 2) Load financial snapshot decision (latest for this deal)
  const { data: finDecRaw } = await sb
    .from("financial_snapshot_decisions")
    .select("snapshot_json")
    .eq("deal_id", opts.dealId)
    .eq("bank_id", opts.bankId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const finSnap = (finDecRaw as any)?.snapshot_json ?? {};

  // 3) Load decision overrides
  const { data: overridesRaw } = await sb
    .from("decision_overrides")
    .select(
      "field_path, old_value, new_value, reason, justification, severity, created_by_user_id, created_at",
    )
    .eq("decision_snapshot_id", opts.snapshotId)
    .eq("deal_id", opts.dealId)
    .order("created_at", { ascending: true });

  // 4) Load attestations
  const { data: attestRaw } = await sb
    .from("decision_attestations")
    .select(
      "attested_by_user_id, attested_by_name, attested_role, statement, snapshot_hash, created_at",
    )
    .eq("decision_snapshot_id", opts.snapshotId)
    .order("created_at", { ascending: true });

  // 5) Load committee votes
  const { data: votesRaw } = await sb
    .from("credit_committee_votes")
    .select("voter_user_id, voter_name, vote, comment, created_at")
    .eq("decision_snapshot_id", opts.snapshotId)
    .order("created_at", { ascending: true });

  // 6) Load committee minutes
  const { data: minutesRaw } = await sb
    .from("credit_committee_minutes")
    .select("content, snapshot_hash")
    .eq("decision_snapshot_id", opts.snapshotId)
    .maybeSingle();

  // 7) Load dissent opinions
  const { data: dissentRaw } = await sb
    .from("credit_committee_dissent")
    .select("dissenter_user_id, dissenter_name, dissent_reason, created_at")
    .eq("decision_snapshot_id", opts.snapshotId)
    .order("created_at", { ascending: true });

  // 8) Load committee member count for quorum
  const { data: membersRaw } = await sb
    .from("bank_credit_committee_members")
    .select("id")
    .eq("bank_id", opts.bankId);

  const totalMembers = membersRaw?.length ?? 0;
  const quorum = Math.ceil(totalMembers / 2);

  // 9) Compute committee outcome
  const votes = (votesRaw ?? []).map((v: any) => ({
    voter_user_id: v.voter_user_id ?? "",
    voter_name: v.voter_name ?? null,
    vote: v.vote ?? "",
    comment: v.comment ?? null,
    created_at: v.created_at ?? "",
  }));

  const tally = { approve: 0, approve_with_conditions: 0, decline: 0 };
  for (const v of votes) {
    if (v.vote === "approve") tally.approve++;
    else if (v.vote === "approve_with_conditions") tally.approve_with_conditions++;
    else if (v.vote === "decline") tally.decline++;
  }

  let committeeOutcome: string;
  if (tally.decline > 0) {
    committeeOutcome = "decline";
  } else if (tally.approve_with_conditions > 0) {
    committeeOutcome = "approve_with_conditions";
  } else if (votes.length >= quorum && tally.approve > 0) {
    committeeOutcome = "approve";
  } else {
    committeeOutcome = "pending";
  }

  // 10) Load deal ledger events (decision-related)
  const { data: ledgerRaw } = await sb
    .from("deal_pipeline_ledger")
    .select("id, event_key, created_at")
    .eq("deal_id", opts.dealId)
    .eq("bank_id", opts.bankId)
    .or("event_key.like.buddy.decision.%,event_key.like.buddy.committee.%,event_key.like.buddy.attestation.%")
    .order("created_at", { ascending: true })
    .limit(100);

  // 11) Parse policy evaluation
  const policyEval = dec.policy_eval_json ?? {};
  const exceptions = (dec.exceptions_json ?? []) as any[];

  // Count rules from policy eval
  const ruleResults = policyEval.rule_results ?? policyEval.rules ?? [];
  const rulesEvaluated = Array.isArray(ruleResults) ? ruleResults.length : 0;
  const rulesPassed = Array.isArray(ruleResults)
    ? ruleResults.filter((r: any) => r.passed === true || r.result === "pass").length
    : 0;

  // 12) Build deterministic snapshot
  const minutesContent = (minutesRaw as any)?.content ?? null;
  const minutesHash = minutesContent ? sha256(minutesContent) : null;

  const snapshot: CreditDecisionAuditSnapshot = {
    meta: {
      deal_id: opts.dealId,
      snapshot_id: opts.snapshotId,
      snapshot_version: "1.0",
      generated_at: generatedAt,
      as_of: asOf,
    },

    decision: {
      status: dec.status ?? "",
      outcome: dec.decision ?? "",
      summary: dec.decision_summary ?? "",
      confidence: typeof dec.confidence === "number" ? dec.confidence : null,
      confidence_explanation: dec.confidence_explanation ?? "",
      created_at: dec.created_at ?? "",
      created_by_user_id: dec.created_by_user_id ?? null,
      model: dec.model_json ?? {},
    },

    financials: {
      dscr: finSnap?.dscr?.value_num ?? null,
      dscr_stressed: finSnap?.dscr_stressed_300bps?.value_num ?? null,
      ltv_gross: finSnap?.ltv_gross?.value_num ?? null,
      ltv_net: finSnap?.ltv_net?.value_num ?? null,
      noi_ttm: finSnap?.noi_ttm?.value_num ?? null,
      cash_flow_available: finSnap?.cash_flow_available?.value_num ?? null,
      annual_debt_service: finSnap?.annual_debt_service?.value_num ?? null,
      collateral_coverage: finSnap?.collateral_coverage?.value_num ?? null,
      completeness_pct: finSnap?.completeness_pct ?? 0,
      as_of_date: finSnap?.as_of_date ?? null,
    },

    policy: {
      rules_evaluated: rulesEvaluated,
      rules_passed: rulesPassed,
      rules_failed: rulesEvaluated - rulesPassed,
      exceptions: exceptions.map((e: any) => ({
        rule_key: e.rule_key ?? e.key ?? "",
        severity: e.severity ?? "info",
        reason: e.reason ?? e.message ?? "",
      })),
      policy_eval_summary: policyEval,
    },

    overrides: (overridesRaw ?? []).map((o: any) => ({
      field_path: o.field_path ?? "",
      old_value: o.old_value ?? null,
      new_value: o.new_value ?? null,
      reason: o.reason ?? "",
      justification: o.justification ?? "",
      severity: o.severity ?? "info",
      created_by_user_id: o.created_by_user_id ?? "",
      created_at: o.created_at ?? "",
    })),

    attestations: (attestRaw ?? []).map((a: any) => ({
      attested_by_user_id: a.attested_by_user_id ?? "",
      attested_by_name: a.attested_by_name ?? null,
      attested_role: a.attested_role ?? "",
      statement: a.statement ?? "",
      snapshot_hash: a.snapshot_hash ?? "",
      created_at: a.created_at ?? "",
    })),

    committee: {
      quorum,
      vote_count: votes.length,
      outcome: committeeOutcome,
      complete: votes.length >= quorum,
      votes,
      minutes: minutesContent,
      minutes_hash: minutesHash,
      dissent: (dissentRaw ?? []).map((d: any) => ({
        dissenter_user_id: d.dissenter_user_id ?? "",
        dissenter_name: d.dissenter_name ?? null,
        dissent_reason: d.dissent_reason ?? "",
        created_at: d.created_at ?? "",
      })),
    },

    ledger_events: (ledgerRaw ?? []).map((e: any) => ({
      id: e.id,
      type: e.event_key,
      created_at: e.created_at,
    })),
  };

  // 13) Compute canonical hash
  const canonicalJson = stableStringify(snapshot);
  const snapshotHash = sha256(canonicalJson);

  return { snapshot, snapshot_hash: snapshotHash };
}
