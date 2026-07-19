import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";
import { materializeTruth } from "@/lib/agents/arbitration";
import { fireDealTruthEvent } from "@/lib/events/deal-truth";
import type { ArbitrationSupabaseClient } from "./ingestClaims";

export type MaterializeTruthSnapshotResult = {
  truth_snapshot_created: boolean;
  snapshot_id?: string;
  version?: number;
  total_claims?: number;
  resolved_claims?: number;
  needs_human_review?: number;
  overall_confidence?: number;
  truth?: Record<string, unknown>;
  message?: string;
};

/**
 * Compiles all arbitrated decisions into a single truth_json snapshot.
 *
 * Extracted from the POST /arbitration/materialize route body — see
 * ingestClaims.ts's header comment for why (in-process call from the
 * autopilot orchestrator instead of a self-fetch with no auth context) and
 * for the `sb` DI rationale.
 */
export async function materializeTruthSnapshotForDeal(
  dealId: string,
  bankId: string,
  opts: { sb?: ArbitrationSupabaseClient } = {},
): Promise<MaterializeTruthSnapshotResult> {
  const sb = opts.sb ?? supabaseAdmin();

  const { data: decisions, error: decisionsError } = await sb
    .from("arbitration_decisions")
    .select("*")
    .eq("deal_id", dealId)
    .eq("bank_id", bankId);

  if (decisionsError) {
    throw new Error(`Failed to fetch decisions: ${decisionsError.message}`);
  }

  if (!decisions || decisions.length === 0) {
    return { truth_snapshot_created: false, message: "No decisions to materialize" };
  }

  const truthJson = materializeTruth(decisions);

  const totalClaims = decisions.length;
  const resolvedClaims = decisions.filter((d: any) => d.decision_status === "chosen").length;
  const needsHuman = decisions.filter((d: any) => d.requires_human_review).length;

  const confidences: number[] = decisions
    .filter((d: any) => d.rule_trace_json?.final_scores)
    .map((d: any) => {
      const scores = Object.values(d.rule_trace_json.final_scores || {}) as number[];
      return Math.max(...scores, 0);
    });

  const overallConfidence =
    confidences.length > 0 ? confidences.reduce((sum, c) => sum + c, 0) / confidences.length : 0;

  const { data: latestSnapshot } = await sb
    .from("deal_truth_snapshots")
    .select("version")
    .eq("deal_id", dealId)
    .order("version", { ascending: false })
    .limit(1)
    .single();

  const nextVersion = (latestSnapshot?.version || 0) + 1;

  const { data: activeOverlay } = await sb
    .from("bank_overlays")
    .select("id, version")
    .eq("bank_id", bankId)
    .eq("is_active", true)
    .single();

  const { data: snapshot, error: snapshotError } = await sb
    .from("deal_truth_snapshots")
    .insert({
      deal_id: dealId,
      bank_id: bankId,
      truth_json: truthJson,
      version: nextVersion,
      total_claims: totalClaims,
      resolved_claims: resolvedClaims,
      needs_human: needsHuman,
      overall_confidence: overallConfidence,
      bank_overlay_id: activeOverlay?.id,
      bank_overlay_version: activeOverlay?.version,
      created_by: "system",
    })
    .select()
    .single();

  if (snapshotError) {
    throw new Error(`Failed to create snapshot: ${snapshotError.message}`);
  }

  const changedTopics = [...new Set(decisions.map((d: any) => d.topic))] as string[];
  await fireDealTruthEvent({
    type: "deal.truth.updated",
    deal_id: dealId,
    bank_id: bankId,
    truth_snapshot_id: snapshot.id,
    trigger: "agent_run",
    changed_topics: changedTopics,
    timestamp: new Date(),
  });

  return {
    truth_snapshot_created: true,
    snapshot_id: snapshot.id,
    version: nextVersion,
    total_claims: totalClaims,
    resolved_claims: resolvedClaims,
    needs_human_review: needsHuman,
    overall_confidence: overallConfidence,
    truth: truthJson,
  };
}
