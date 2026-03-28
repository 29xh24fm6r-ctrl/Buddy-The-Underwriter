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
  const { data: existing } = await sb
    .from("deal_conditions")
    .select("id")
    .eq("deal_id", input.dealId)
    .eq("source", "system")
    .eq("source_key", "canonical_request_documents")
    .eq("status", "open")
    .maybeSingle();

  if (existing) {
    return {
      ok: true,
      actionCode: "request_documents",
      target: "conditions",
      targetRecordId: existing.id,
      status: "already_exists",
    };
  }

  const { data: cond } = await sb
    .from("deal_conditions")
    .insert({
      deal_id: input.dealId,
      bank_id: input.bankId,
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

  return {
    ok: true,
    actionCode: "request_documents",
    target: "conditions",
    targetRecordId: cond?.id ?? null,
    status: "created",
  };
}
