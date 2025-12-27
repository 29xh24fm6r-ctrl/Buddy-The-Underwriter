/**
 * SBA God Mode: Deal Truth Event System
 * 
 * Centralized event emitter for deal truth changes.
 * When truth snapshots are created/updated, fire events that trigger:
 * - Narrative Agent regeneration
 * - Evidence Agent verification
 * - Borrower task updates
 */

import { supabaseAdmin } from "@/lib/supabase/admin";

export type DealTruthEventType = "deal.truth.updated" | "deal.truth.conflict_resolved";

export interface DealTruthEvent {
  type: DealTruthEventType;
  deal_id: string;
  bank_id: string;
  truth_snapshot_id: string;
  trigger: "agent_run" | "manual_override" | "bank_overlay" | "periodic_refresh";
  changed_topics: string[];
  timestamp: Date;
}

/**
 * Fire a deal truth event and trigger downstream consumers
 */
export async function fireDealTruthEvent(event: DealTruthEvent): Promise<void> {
  console.log("[EventBus] Firing event:", event.type, "for deal:", event.deal_id);

  const sb = supabaseAdmin();

  // Insert event log
  await sb.from("deal_truth_events").insert({
    deal_id: event.deal_id,
    bank_id: event.bank_id,
    event_type: event.type,
    truth_snapshot_id: event.truth_snapshot_id,
    trigger: event.trigger,
    changed_topics: event.changed_topics,
    created_at: event.timestamp.toISOString(),
  });

  // Trigger consumers in parallel
  await Promise.allSettled([
    triggerNarrativeRegeneration(event),
    triggerEvidenceVerification(event),
    triggerBorrowerTaskUpdate(event),
  ]);
}

/**
 * Consumer 1: Regenerate narrative agent summary
 */
async function triggerNarrativeRegeneration(event: DealTruthEvent): Promise<void> {
  // Skip if narrative agent not affected
  const narrativeTopics = ["risks", "eligibility", "credit"];
  const hasNarrativeChange = event.changed_topics.some((t) =>
    narrativeTopics.some((nt) => t.includes(nt))
  );

  if (!hasNarrativeChange) {
    console.log("[EventBus] Skipping narrative regen, no relevant changes");
    return;
  }

  console.log("[EventBus] Triggering narrative agent regeneration");

  // TODO: Call narrative agent API
  // await fetch(`/api/deals/${event.deal_id}/agents/execute`, {
  //   method: 'POST',
  //   body: JSON.stringify({ agent_name: 'narrative' }),
  // });
}

/**
 * Consumer 2: Trigger evidence agent verification
 */
async function triggerEvidenceVerification(event: DealTruthEvent): Promise<void> {
  // Skip if evidence agent not affected
  const evidenceTopics = ["documents", "verification"];
  const hasEvidenceChange = event.changed_topics.some((t) =>
    evidenceTopics.some((et) => t.includes(et))
  );

  if (!hasEvidenceChange) {
    console.log("[EventBus] Skipping evidence verification, no relevant changes");
    return;
  }

  console.log("[EventBus] Triggering evidence agent verification");

  // TODO: Call evidence agent API
  // await fetch(`/api/deals/${event.deal_id}/agents/execute`, {
  //   method: 'POST',
  //   body: JSON.stringify({ agent_name: 'evidence' }),
  // });
}

/**
 * Consumer 3: Update borrower tasks and readiness score
 */
async function triggerBorrowerTaskUpdate(event: DealTruthEvent): Promise<void> {
  console.log("[EventBus] Updating borrower tasks");

  const sb = supabaseAdmin();

  // Recalculate readiness score
  // TODO: Call readiness score calculator and update deal record
  // const readinessScore = await calculateReadinessScore(event.deal_id, event.bank_id);

  // Update deal.borrower_readiness_score
  // await sb.from("deals").update({ borrower_readiness_score: readinessScore.overall_score }).eq("id", event.deal_id);

  // TODO: Notify borrower if milestone crossed (e.g., 25% → 50%)
}

/**
 * Get event history for a deal
 */
export async function getDealTruthEvents(
  dealId: string,
  limit: number = 50
): Promise<DealTruthEvent[]> {
  const sb = supabaseAdmin();

  const { data, error } = await sb
    .from("deal_truth_events")
    .select("*")
    .eq("deal_id", dealId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    console.error("Failed to fetch truth events:", error);
    return [];
  }

  return (data || []).map((row) => ({
    type: row.event_type as DealTruthEventType,
    deal_id: row.deal_id,
    bank_id: row.bank_id,
    truth_snapshot_id: row.truth_snapshot_id,
    trigger: row.trigger,
    changed_topics: row.changed_topics || [],
    timestamp: new Date(row.created_at),
  }));
}
