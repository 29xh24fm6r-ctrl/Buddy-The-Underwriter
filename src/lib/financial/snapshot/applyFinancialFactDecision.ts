import "server-only";

/**
 * Phase 55A — Apply Banker Fact Decision
 *
 * Controlled fact-level review actions with required rationale
 * for adjustments and rejections.
 */

import { supabaseAdmin } from "@/lib/supabase/admin";
import { logLedgerEvent } from "@/lib/pipeline/logLedgerEvent";
import type { FactDecisionInput, FactValidationState } from "./financial-fact-types";

type FactDecisionResult = {
  ok: true;
  factId: string;
  newState: FactValidationState;
} | {
  ok: false;
  error: string;
};

const ACTION_TO_STATE: Record<string, FactValidationState> = {
  confirm_fact: "banker_confirmed",
  select_conflict_source: "banker_confirmed",
  adjust_fact: "banker_adjusted",
  reject_fact: "rejected",
  mark_follow_up_needed: "needs_review",
};

export async function applyFinancialFactDecision(input: FactDecisionInput): Promise<FactDecisionResult> {
  const newState = ACTION_TO_STATE[input.action];
  if (!newState) return { ok: false, error: `Unknown action: ${input.action}` };

  // Validate rationale requirements
  if ((input.action === "adjust_fact" || input.action === "reject_fact") && !input.rationale) {
    return { ok: false, error: `${input.action} requires rationale` };
  }
  if (input.action === "select_conflict_source" && !input.selectedProvenanceSourceDocumentId) {
    return { ok: false, error: "select_conflict_source requires selectedProvenanceSourceDocumentId" };
  }

  const sb = supabaseAdmin();
  const now = new Date().toISOString();

  try {
    const update: Record<string, unknown> = {
      validation_state: newState,
      reviewer_user_id: input.reviewerUserId,
      reviewer_rationale: input.rationale ?? null,
      updated_at: now,
    };

    if (input.action === "adjust_fact" && input.replacementValue != null) {
      update.numeric_value = input.replacementValue;
    }
    if (input.action === "select_conflict_source" && input.selectedProvenanceSourceDocumentId) {
      update.primary_document_id = input.selectedProvenanceSourceDocumentId;
      update.conflict_state = null; // resolved
    }

    const { error } = await sb
      .from("financial_snapshot_facts")
      .update(update)
      .eq("id", input.factId)
      .eq("snapshot_id", input.snapshotId)
      .eq("deal_id", input.dealId);

    if (error) throw new Error(error.message);

    // Update snapshot aggregate counts
    await recalculateSnapshotAggregates(sb, input.snapshotId);

    // Audit
    const { data: fact } = await sb
      .from("financial_snapshot_facts")
      .select("deal_id, metric_key")
      .eq("id", input.factId)
      .maybeSingle();

    const { data: snap } = await sb
      .from("financial_snapshots_v2")
      .select("bank_id")
      .eq("id", input.snapshotId)
      .maybeSingle();

    if (fact && snap) {
      await logLedgerEvent({
        dealId: fact.deal_id,
        bankId: snap.bank_id,
        eventKey: `financial_fact.${input.action}`,
        uiState: "done",
        uiMessage: `Financial fact ${input.action}: ${fact.metric_key}`,
        meta: {
          fact_id: input.factId,
          snapshot_id: input.snapshotId,
          action: input.action,
          metric_key: fact.metric_key,
          reviewer_user_id: input.reviewerUserId,
          new_state: newState,
        },
      }).catch(() => {});
    }

    return { ok: true, factId: input.factId, newState };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

async function recalculateSnapshotAggregates(sb: ReturnType<typeof supabaseAdmin>, snapshotId: string) {
  const { data: facts } = await sb
    .from("financial_snapshot_facts")
    .select("validation_state")
    .eq("snapshot_id", snapshotId);

  if (!facts) return;

  const validated = new Set(["banker_confirmed", "banker_adjusted", "auto_supported"]);
  const conflicted = new Set(["conflicted", "needs_review"]);

  const materialFactCount = facts.length;
  const validatedFactCount = facts.filter((f: any) => validated.has(f.validation_state)).length;
  const unresolvedConflictCount = facts.filter((f: any) => conflicted.has(f.validation_state)).length;
  const missingFactCount = facts.filter((f: any) => f.validation_state === "missing").length;

  await sb
    .from("financial_snapshots_v2")
    .update({
      material_fact_count: materialFactCount,
      validated_fact_count: validatedFactCount,
      unresolved_conflict_count: unresolvedConflictCount,
      missing_fact_count: missingFactCount,
      updated_at: new Date().toISOString(),
    })
    .eq("id", snapshotId);
}
