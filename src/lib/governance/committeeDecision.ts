/**
 * Committee disposition tracking.
 * Records formal committee decisions tied to a specific freeze snapshot.
 * Server module — uses Supabase client.
 */
import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

export type CommitteeDecisionType =
  | "approved"
  | "approved_with_exceptions"
  | "approved_with_changes"
  | "declined";

export type CommitteeDecisionRow = {
  id: string;
  deal_id: string;
  freeze_id: string;
  decision: CommitteeDecisionType;
  decision_notes: string | null;
  decided_by: string | null;
  decided_at: string;
};

/**
 * Record a committee decision. Tied to a specific freeze snapshot.
 */
export async function recordCommitteeDecision(
  sb: SupabaseClient,
  dealId: string,
  freezeId: string,
  decision: CommitteeDecisionType,
  decidedBy: string,
  notes?: string,
): Promise<{ ok: boolean; id?: string; error?: string }> {
  // Require notes for approved_with_changes and declined
  if (
    (decision === "approved_with_changes" || decision === "declined") &&
    (!notes || notes.trim().length < 10)
  ) {
    return { ok: false, error: "Decision notes required (min 10 characters) for this decision type." };
  }

  const { data, error } = await sb
    .from("deal_committee_decisions")
    .insert({
      deal_id: dealId,
      freeze_id: freezeId,
      decision,
      decision_notes: notes?.trim() || null,
      decided_by: decidedBy,
    })
    .select("id")
    .single();

  if (error) {
    console.error("[committeeDecision] record failed:", error.message);
    return { ok: false, error: "Failed to record committee decision." };
  }

  return { ok: true, id: data?.id };
}

/**
 * Load committee decisions for a deal.
 */
export async function loadCommitteeDecisions(
  sb: SupabaseClient,
  dealId: string,
): Promise<CommitteeDecisionRow[]> {
  const { data, error } = await sb
    .from("deal_committee_decisions")
    .select("*")
    .eq("deal_id", dealId)
    .order("decided_at", { ascending: false });

  if (error) {
    console.error("[committeeDecision] load failed:", error.message);
    return [];
  }
  return (data ?? []) as CommitteeDecisionRow[];
}

/**
 * Load the latest committee decision for a deal.
 */
export async function loadLatestCommitteeDecision(
  sb: SupabaseClient,
  dealId: string,
): Promise<CommitteeDecisionRow | null> {
  const { data } = await sb
    .from("deal_committee_decisions")
    .select("*")
    .eq("deal_id", dealId)
    .order("decided_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return (data as CommitteeDecisionRow) ?? null;
}
