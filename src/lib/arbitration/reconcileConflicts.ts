import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";
import { reconcileAllConflicts, DEFAULT_ARBITRATION_CONFIG } from "@/lib/agents/arbitration";
import { applyBankOverlay } from "@/lib/agents/bank-overlay";
import type { ArbitrationConfig } from "@/lib/agents/arbitration";
import type { ArbitrationSupabaseClient } from "./ingestClaims";

export type ReconcileConflictsResult = {
  decisions_made: number;
  auto_resolved?: number;
  needs_human_review?: number;
  overlay_applied?: boolean;
  overlay_log?: Record<string, unknown> | null;
  message?: string;
};

/**
 * Applies arbitration rules R0-R5 to resolve open conflict sets.
 *
 * Extracted from the POST /arbitration/reconcile route body — see
 * ingestClaims.ts's header comment for why (in-process call from the
 * autopilot orchestrator instead of a self-fetch with no auth context) and
 * for the `sb` DI rationale.
 */
export async function reconcileConflictsForDeal(
  dealId: string,
  bankId: string,
  opts: { applyBankOverlay?: boolean; sb?: ArbitrationSupabaseClient } = {},
): Promise<ReconcileConflictsResult> {
  const sb = opts.sb ?? supabaseAdmin();

  const { data: conflictSets, error: conflictsError } = await sb
    .from("claim_conflict_sets")
    .select("*")
    .eq("deal_id", dealId)
    .eq("bank_id", bankId)
    .eq("status", "open");

  if (conflictsError) {
    throw new Error(`Failed to fetch conflict sets: ${conflictsError.message}`);
  }

  if (!conflictSets || conflictSets.length === 0) {
    return { decisions_made: 0, message: "No open conflicts to reconcile" };
  }

  const claimHashes = conflictSets.map((cs: any) => cs.claim_hash);
  const { data: claims, error: claimsError } = await sb
    .from("agent_claims")
    .select("*")
    .eq("deal_id", dealId)
    .in("claim_hash", claimHashes);

  if (claimsError) {
    throw new Error(`Failed to fetch claims: ${claimsError.message}`);
  }

  const enrichedConflictSets = conflictSets.map((cs: any) => ({
    ...cs,
    claims: claims?.filter((c: any) => c.claim_hash === cs.claim_hash) || [],
  }));

  let config: ArbitrationConfig = DEFAULT_ARBITRATION_CONFIG;
  let overlayApplicationLog: Record<string, unknown> | null = null;

  if (opts.applyBankOverlay) {
    const { data: activeOverlay } = await sb
      .from("bank_overlays")
      .select("*")
      .eq("bank_id", bankId)
      .eq("is_active", true)
      .single();

    if (activeOverlay) {
      const overlayResult = applyBankOverlay(
        activeOverlay.overlay_json,
        claims || [],
        undefined,
        DEFAULT_ARBITRATION_CONFIG,
      );

      if (overlayResult.adjusted_config) {
        config = overlayResult.adjusted_config;
      }

      overlayApplicationLog = {
        deal_id: dealId,
        bank_id: bankId,
        overlay_id: activeOverlay.id,
        overlay_version: activeOverlay.version,
        triggered_rules: overlayResult.triggered_rules,
        added_conditions: overlayResult.added_conditions,
        added_documents: overlayResult.added_documents,
        requires_human_review_flags: overlayResult.requires_human_review_flags,
        adjusted_agent_weights: overlayResult.adjusted_config?.agent_weights || null,
        adjusted_thresholds: overlayResult.adjusted_config?.thresholds || null,
      };

      await sb.from("overlay_application_log").insert(overlayApplicationLog);
    }
  }

  const decisions = reconcileAllConflicts(enrichedConflictSets, config);

  const decisionRecords = decisions.map((d) => ({
    deal_id: dealId,
    bank_id: bankId,
    claim_hash: d.claim_hash,
    chosen_value_json: d.chosen_value_json,
    chosen_claim_id: d.chosen_claim_id,
    decision_status: d.decision_status,
    rationale: d.rationale,
    rule_trace_json: d.rule_trace_json,
    provenance_json: d.provenance_json,
    dissent_json: d.dissent_json,
    requires_human_review: d.requires_human_review,
    created_by: d.created_by,
  }));

  const { error: decisionsError } = await sb
    .from("arbitration_decisions")
    .upsert(decisionRecords, { onConflict: "deal_id,claim_hash" })
    .select();

  if (decisionsError) {
    throw new Error(`Failed to insert decisions: ${decisionsError.message}`);
  }

  for (const decision of decisions) {
    const status = decision.requires_human_review ? "needs_human" : "resolved";
    await sb
      .from("claim_conflict_sets")
      .update({ status })
      .eq("deal_id", dealId)
      .eq("claim_hash", decision.claim_hash);
  }

  const needsHuman = decisions.filter((d) => d.requires_human_review).length;
  const resolved = decisions.filter((d) => !d.requires_human_review).length;

  return {
    decisions_made: decisions.length,
    auto_resolved: resolved,
    needs_human_review: needsHuman,
    overlay_applied: !!overlayApplicationLog,
    overlay_log: overlayApplicationLog,
  };
}
