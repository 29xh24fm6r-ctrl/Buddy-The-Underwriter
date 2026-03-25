/**
 * Create a reproducible credit memo snapshot at generation time.
 * Persists builder state, exceptions, decisions, and memo output.
 * Server module — uses Supabase client.
 */
import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

export type CreditMemoSnapshotInput = {
  dealId: string;
  generatedBy?: string;
  builderState: Record<string, unknown>;
  policyExceptions: unknown[];
  builderDecisions: unknown[];
  memoOutput: Record<string, unknown>;
};

/**
 * Persist a credit memo snapshot. Returns the snapshot ID.
 */
export async function createCreditMemoSnapshot(
  sb: SupabaseClient,
  input: CreditMemoSnapshotInput,
): Promise<string | null> {
  const { data, error } = await sb
    .from("credit_memo_snapshots")
    .insert({
      deal_id: input.dealId,
      generated_by: input.generatedBy ?? null,
      builder_state_json: input.builderState,
      policy_exceptions_json: input.policyExceptions,
      builder_decisions_json: input.builderDecisions,
      memo_output_json: input.memoOutput,
    })
    .select("id")
    .single();

  if (error) {
    console.error("[createCreditMemoSnapshot] failed:", error.message);
    return null;
  }

  return data?.id ?? null;
}

/**
 * Load a credit memo snapshot by ID.
 */
export async function loadCreditMemoSnapshot(
  sb: SupabaseClient,
  snapshotId: string,
): Promise<CreditMemoSnapshotInput | null> {
  const { data, error } = await sb
    .from("credit_memo_snapshots")
    .select("*")
    .eq("id", snapshotId)
    .maybeSingle();

  if (error || !data) return null;

  return {
    dealId: (data as any).deal_id,
    generatedBy: (data as any).generated_by,
    builderState: (data as any).builder_state_json,
    policyExceptions: (data as any).policy_exceptions_json,
    builderDecisions: (data as any).builder_decisions_json,
    memoOutput: (data as any).memo_output_json,
  };
}
