import "server-only";

/**
 * Phase 66C — Outcome Attribution: Links Buddy actions to deal outcomes.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export interface OutcomeEventInput {
  bankId: string;
  dealId: string;
  actorType: string;
  eventType: string;
  sourceSystem: string;
  visibility: string;
  payload: Record<string, unknown>;
}

export interface OutcomeEvent {
  id: string;
  bank_id: string;
  deal_id: string;
  actor_type: string;
  event_type: string;
  source_system: string;
  visibility: string;
  payload: Record<string, unknown>;
  created_at: string;
}

export interface RecommendationOutcomeInput {
  status: string;
  usefulness?: number;
  timing?: string;
  impact?: string;
  overridden?: boolean;
  overrideReason?: string;
}

/**
 * Inserts an outcome event into buddy_outcome_events. Returns the event id.
 */
export async function recordOutcomeEvent(
  sb: SupabaseClient,
  input: OutcomeEventInput,
): Promise<string> {
  const { data, error } = await sb
    .from("buddy_outcome_events")
    .insert({
      bank_id: input.bankId,
      deal_id: input.dealId,
      actor_type: input.actorType,
      event_type: input.eventType,
      source_system: input.sourceSystem,
      visibility: input.visibility,
      payload: input.payload,
    })
    .select("id")
    .single();

  if (error) throw new Error(`recordOutcomeEvent failed: ${error.message}`);
  return data.id as string;
}

/**
 * Retrieves outcome events for a deal, optionally filtered by event type.
 */
export async function getOutcomeEventsForDeal(
  sb: SupabaseClient,
  dealId: string,
  options?: { eventType?: string; limit?: number },
): Promise<OutcomeEvent[]> {
  let query = sb
    .from("buddy_outcome_events")
    .select("*")
    .eq("deal_id", dealId)
    .order("created_at", { ascending: false });

  if (options?.eventType) {
    query = query.eq("event_type", options.eventType);
  }
  if (options?.limit) {
    query = query.limit(options.limit);
  }

  const { data, error } = await query;
  if (error)
    throw new Error(`getOutcomeEventsForDeal failed: ${error.message}`);
  return (data ?? []) as OutcomeEvent[];
}

/**
 * Records the outcome of a specific recommendation.
 */
export async function attributeRecommendation(
  sb: SupabaseClient,
  recommendationId: string,
  dealId: string,
  bankId: string,
  outcome: RecommendationOutcomeInput,
): Promise<void> {
  const { error } = await sb.from("buddy_recommendation_outcomes").insert({
    recommendation_id: recommendationId,
    deal_id: dealId,
    bank_id: bankId,
    status: outcome.status,
    usefulness: outcome.usefulness ?? null,
    timing: outcome.timing ?? null,
    impact: outcome.impact ?? null,
    overridden: outcome.overridden ?? false,
    override_reason: outcome.overrideReason ?? null,
  });

  if (error)
    throw new Error(`attributeRecommendation failed: ${error.message}`);
}
