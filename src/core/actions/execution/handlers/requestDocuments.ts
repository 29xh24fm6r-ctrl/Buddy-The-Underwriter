import type { SupabaseClient } from "@supabase/supabase-js";
import type { ExecuteCanonicalActionInput, ExecuteCanonicalActionResult } from "../types";

/**
 * request_documents — Create open document-request conditions.
 * Idempotent: skips if an open canonical-action-sourced condition already exists.
 */
export async function handleRequestDocuments(
  sb: SupabaseClient,
  input: ExecuteCanonicalActionInput,
): Promise<ExecuteCanonicalActionResult> {
  const { data: existing, error: lookupError } = await sb
    .from("deal_conditions")
    .select("id")
    .eq("deal_id", input.dealId)
    .eq("source", "system")
    .eq("source_key", "canonical_request_documents")
    .eq("bank_id", input.bankId)
    .maybeSingle();

  if (lookupError) return { ok: false, actionCode: "request_documents", target: "conditions", targetRecordId: null, status: "failed", error: "condition_lookup_failed" };

  if (existing) {
    return {
      ok: true,
      actionCode: "request_documents",
      target: "conditions",
      targetRecordId: existing.id,
      status: "already_exists",
    };
  }

  const { data: cond, error: insertError } = await sb
    .from("deal_conditions")
    .insert({
      deal_id: input.dealId,
      bank_id: input.bankId,
      code: "canonical_request_documents",
      title: "Documents Requested",
      description: "Required documents must be submitted to proceed with underwriting.",
      category: "credit",
      source: "system",
      source_key: "canonical_request_documents",
      status: "open",
      created_by: input.executedBy,
    })
    .select("id")
    .single();

  if (insertError || !cond?.id) return { ok: false, actionCode: "request_documents", target: "conditions", targetRecordId: null, status: "failed", error: "condition_insert_failed" };

  return {
    ok: true,
    actionCode: "request_documents",
    target: "conditions",
    targetRecordId: cond?.id ?? null,
    status: "created",
  };
}
