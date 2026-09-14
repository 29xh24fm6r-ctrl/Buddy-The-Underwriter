import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { resolveFinancialReviewItem } from "@/lib/financialReview/resolveFinancialReviewItem";
import type { ResolutionAction } from "@/lib/financialReview/validateResolutionInput";
import type { FactDecisionInput, FactValidationState } from "./financial-fact-types";

const ACTIONS: Record<string, { action: ResolutionAction; state: FactValidationState }> = {
  confirm_fact: { action: "confirm_value", state: "banker_confirmed" },
  select_conflict_source: { action: "choose_source_value", state: "banker_confirmed" },
  adjust_fact: { action: "override_value", state: "banker_adjusted" },
  reject_fact: { action: "reject_value", state: "rejected" },
  mark_follow_up_needed: { action: "mark_follow_up", state: "needs_review" },
};

/** Legacy endpoint adapter. Snapshot IDs never authorize or receive fact edits. */
export async function applyFinancialFactDecision(input: FactDecisionInput): Promise<
  { ok: true; factId: string; newState: FactValidationState } | { ok: false; error: string }
> {
  const mapped = ACTIONS[input.action];
  if (!mapped || !input.bankId) return { ok: false, error: "invalid_review_input" };
  try {
    const sb = supabaseAdmin();
    let query = sb.from("deal_gap_queue").select("id, conflict_id")
      .eq("deal_id", input.dealId).eq("bank_id", input.bankId).eq("status", "open");
    query = input.gapId ? query.eq("id", input.gapId) : query.eq("fact_id", input.factId);
    const { data: gap, error } = await query.maybeSingle();
    if (error || !gap) return { ok: false, error: "gap_not_found" };
    let selectedId = input.factId;
    if (input.action === "select_conflict_source") {
      if (!input.selectedProvenanceSourceDocumentId || !gap.conflict_id) return { ok: false, error: "conflict_source_required" };
      const { data: conflict, error: conflictError } = await sb.from("deal_fact_conflicts").select("conflicting_fact_ids")
        .eq("id", gap.conflict_id).eq("deal_id", input.dealId).eq("bank_id", input.bankId).maybeSingle();
      if (conflictError || !conflict) return { ok: false, error: "conflict_not_found" };
      const { data: source, error: sourceError } = await sb.from("deal_financial_facts").select("id")
        .eq("deal_id", input.dealId).eq("bank_id", input.bankId)
        .eq("source_document_id", input.selectedProvenanceSourceDocumentId)
        .in("id", conflict.conflicting_fact_ids).maybeSingle();
      if (sourceError || !source) return { ok: false, error: "conflict_source_not_found" };
      selectedId = source.id;
    }
    const result = await resolveFinancialReviewItem({
      gapId: gap.id, factId: selectedId, conflictId: gap.conflict_id,
      dealId: input.dealId, bankId: input.bankId, actorUserId: input.reviewerUserId, actorRole: "banker",
      action: mapped.action, rationale: input.rationale, resolvedValue: input.replacementValue,
    });
    return result.ok ? { ok: true, factId: result.resolution.factId ?? input.factId, newState: mapped.state }
      : { ok: false, error: result.errors?.[0]?.message ?? result.error };
  } catch {
    return { ok: false, error: "review_commit_failed" };
  }
}
