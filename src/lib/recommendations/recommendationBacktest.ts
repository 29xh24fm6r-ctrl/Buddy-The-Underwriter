import "server-only";

/**
 * Phase 66C — Recommendation Backtest: Evaluates past recommendations against actual outcomes.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { QualityDimension } from "./recommendationQuality";
import { computeQualityScore } from "./recommendationQuality";

export interface BacktestResult {
  recommendationId: string;
  category: string;
  qualityScore: number;
  accepted: boolean;
  timing: "too_early" | "on_time" | "too_late";
  impact: string | null;
}

interface RecRow {
  id: string;
  category: string;
}

interface OutcomeRow {
  recommendation_id: string;
  status: string;
  usefulness: number | null;
  timing: string | null;
  impact: string | null;
  overridden: boolean;
}

/**
 * Loads recommendations and their outcomes for a deal, then scores each.
 */
export async function backtestRecommendations(
  sb: SupabaseClient,
  dealId: string,
  bankId: string,
): Promise<BacktestResult[]> {
  const [recsRes, outcomesRes] = await Promise.all([
    sb
      .from("buddy_action_recommendations")
      .select("id, category")
      .eq("deal_id", dealId)
      .eq("bank_id", bankId),
    sb
      .from("buddy_recommendation_outcomes")
      .select(
        "recommendation_id, status, usefulness, timing, impact, overridden",
      )
      .eq("deal_id", dealId)
      .eq("bank_id", bankId),
  ]);

  const recs: RecRow[] = (recsRes.data ?? []) as RecRow[];
  const outcomes: OutcomeRow[] = (outcomesRes.data ?? []) as OutcomeRow[];

  const outcomeByRec = new Map<string, OutcomeRow>();
  for (const o of outcomes) {
    outcomeByRec.set(o.recommendation_id, o);
  }

  return recs.map((rec) => {
    const outcome = outcomeByRec.get(rec.id);
    const accepted = outcome?.status === "accepted";
    const timing = (outcome?.timing as QualityDimension["timing"]) ?? "too_late";

    const dims: QualityDimension = {
      accepted,
      actedOn: accepted || outcome?.status === "completed",
      resolvedBlocker: outcome?.impact === "blocker_resolved",
      improvedQuality: outcome?.impact === "quality_improved",
      timing,
      bankerUseful: (outcome?.usefulness ?? 0) >= 4,
      borrowerUnderstandable: accepted,
    };

    return {
      recommendationId: rec.id,
      category: rec.category,
      qualityScore: computeQualityScore(dims),
      accepted,
      timing,
      impact: outcome?.impact ?? null,
    };
  });
}
