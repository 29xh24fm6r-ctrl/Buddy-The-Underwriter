/**
 * Record formal loan decision and manage finalization.
 * Server module — uses Supabase client.
 */
import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

// ── Types ────────────────────────────────────────────────────────

export type LoanDecisionResult =
  | "approved"
  | "approved_with_exceptions"
  | "approved_with_changes"
  | "declined";

export type LoanDecisionRow = {
  id: string;
  deal_id: string;
  committee_decision_id: string;
  freeze_id: string;
  memo_snapshot_id: string;
  decision_result: LoanDecisionResult;
  decision_summary: string | null;
  approved_amount: number | null;
  approved_structure_json: Record<string, unknown>;
  approved_exception_count: number;
  recorded_by: string | null;
  recorded_at: string;
};

// ── Record ───────────────────────────────────────────────────────

export async function recordLoanDecision(
  sb: SupabaseClient,
  args: {
    dealId: string;
    committeeDecisionId: string;
    freezeId: string;
    memoSnapshotId: string;
    decisionResult: LoanDecisionResult;
    decisionSummary?: string;
    approvedAmount?: number | null;
    approvedStructure: Record<string, unknown>;
    approvedExceptionCount: number;
    recordedBy?: string;
  },
): Promise<{ ok: boolean; id?: string; error?: string }> {
  const { data, error } = await sb
    .from("deal_loan_decisions")
    .insert({
      deal_id: args.dealId,
      committee_decision_id: args.committeeDecisionId,
      freeze_id: args.freezeId,
      memo_snapshot_id: args.memoSnapshotId,
      decision_result: args.decisionResult,
      decision_summary: args.decisionSummary ?? null,
      approved_amount: args.approvedAmount ?? null,
      approved_structure_json: args.approvedStructure,
      approved_exception_count: args.approvedExceptionCount,
      recorded_by: args.recordedBy ?? null,
    })
    .select("id")
    .single();

  if (error) {
    console.error("[recordLoanDecision] failed:", error.message);
    return { ok: false, error: "Failed to record loan decision." };
  }

  // Update memo status
  await sb
    .from("deal_credit_memo_status")
    .upsert({
      deal_id: args.dealId,
      current_status: "decision_recorded",
      active_memo_snapshot_id: args.memoSnapshotId,
      active_freeze_id: args.freezeId,
      updated_at: new Date().toISOString(),
      updated_by: args.recordedBy ?? null,
    }, { onConflict: "deal_id" });

  return { ok: true, id: data?.id };
}

// ── Finalize ─────────────────────────────────────────────────────

export async function finalizeLoanDecision(
  sb: SupabaseClient,
  args: {
    dealId: string;
    loanDecisionId: string;
    finalPackage: Record<string, unknown>;
    finalizedBy?: string;
  },
): Promise<{ ok: boolean; id?: string; error?: string }> {
  const { data, error } = await sb
    .from("deal_decision_finalization")
    .insert({
      deal_id: args.dealId,
      loan_decision_id: args.loanDecisionId,
      final_package_json: args.finalPackage,
      finalized_by: args.finalizedBy ?? null,
    })
    .select("id")
    .single();

  if (error) {
    console.error("[finalizeLoanDecision] failed:", error.message);
    return { ok: false, error: "Failed to finalize decision." };
  }

  // Update memo status to finalized
  await sb
    .from("deal_credit_memo_status")
    .upsert({
      deal_id: args.dealId,
      current_status: "finalized",
      updated_at: new Date().toISOString(),
      updated_by: args.finalizedBy ?? null,
    }, { onConflict: "deal_id" });

  return { ok: true, id: data?.id };
}

// ── Load ─────────────────────────────────────────────────────────

export async function loadLatestLoanDecision(
  sb: SupabaseClient,
  dealId: string,
): Promise<LoanDecisionRow | null> {
  const { data } = await sb
    .from("deal_loan_decisions")
    .select("*")
    .eq("deal_id", dealId)
    .order("recorded_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return (data as LoanDecisionRow) ?? null;
}

export async function loadMemoStatus(
  sb: SupabaseClient,
  dealId: string,
): Promise<{ current_status: string; active_memo_snapshot_id: string | null; active_freeze_id: string | null } | null> {
  const { data } = await sb
    .from("deal_credit_memo_status")
    .select("current_status, active_memo_snapshot_id, active_freeze_id")
    .eq("deal_id", dealId)
    .maybeSingle();

  return data as any ?? null;
}
