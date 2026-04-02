/**
 * Banker Trust Calibration — Phase 66C, System 4
 *
 * Records and analyzes banker trust behavior: acceptances, rejections,
 * overrides, drilldowns, and memo reuses against Buddy recommendations.
 */
import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export type TrustEventSummary = {
  totalEvents: number;
  acceptances: number;
  rejections: number;
  overrides: number;
  drilldowns: number;
  memoReuses: number;
};

export interface TrustEventInput {
  bankId: string;
  dealId: string;
  actorId?: string;
  eventType: string;
  conclusionKey?: string;
  recommendationId?: string;
  payload?: Record<string, unknown>;
}

/* ------------------------------------------------------------------ */
/*  recordTrustEvent                                                   */
/* ------------------------------------------------------------------ */

export async function recordTrustEvent(
  sb: SupabaseClient,
  input: TrustEventInput,
): Promise<void> {
  const { error } = await sb.from("buddy_banker_trust_events").insert({
    bank_id: input.bankId,
    deal_id: input.dealId,
    actor_id: input.actorId ?? null,
    event_type: input.eventType,
    conclusion_key: input.conclusionKey ?? null,
    recommendation_id: input.recommendationId ?? null,
    payload_json: input.payload ?? {},
  });

  if (error) {
    console.error("[bankerTrustCalibration] recordTrustEvent failed:", error.message);
  }
}

/* ------------------------------------------------------------------ */
/*  getTrustEventSummary                                               */
/* ------------------------------------------------------------------ */

export async function getTrustEventSummary(
  sb: SupabaseClient,
  dealId: string,
): Promise<TrustEventSummary> {
  const { data, error } = await sb
    .from("buddy_banker_trust_events")
    .select("event_type")
    .eq("deal_id", dealId);

  if (error || !data) {
    console.error("[bankerTrustCalibration] getTrustEventSummary failed:", error?.message);
    return { totalEvents: 0, acceptances: 0, rejections: 0, overrides: 0, drilldowns: 0, memoReuses: 0 };
  }

  const summary: TrustEventSummary = {
    totalEvents: data.length,
    acceptances: 0,
    rejections: 0,
    overrides: 0,
    drilldowns: 0,
    memoReuses: 0,
  };

  for (const row of data) {
    switch (row.event_type) {
      case "recommendation_accepted":
        summary.acceptances++;
        break;
      case "recommendation_rejected":
        summary.rejections++;
        break;
      case "override":
        summary.overrides++;
        break;
      case "evidence_drilldown":
        summary.drilldowns++;
        break;
      case "memo_reuse":
        summary.memoReuses++;
        break;
    }
  }

  return summary;
}
