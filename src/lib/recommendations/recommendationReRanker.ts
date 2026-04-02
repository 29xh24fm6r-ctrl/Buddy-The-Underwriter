import "server-only";

/**
 * Phase 66C — Recommendation Re-Ranker: Re-ranks recommendations using live outcome data.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { computeDecay, applyDecay } from "./recommendationDecay";

interface OpenRec {
  id: string;
  category: string;
  priority_score: number;
  created_at: string;
  status: string;
}

interface HistoricalOutcome {
  category: string;
  status: string;
}

/**
 * Re-ranks open recommendations for a deal by:
 * 1. Applying age-based decay
 * 2. Boosting/penalizing based on historical acceptance rate for same category
 *
 * Updates priority_score on buddy_action_recommendations in-place.
 */
export async function reRankRecommendations(
  sb: SupabaseClient,
  dealId: string,
  bankId: string,
): Promise<void> {
  // Load open recommendations for this deal
  const { data: openRecs, error: recsError } = await sb
    .from("buddy_action_recommendations")
    .select("id, category, priority_score, created_at, status")
    .eq("deal_id", dealId)
    .eq("bank_id", bankId)
    .in("status", ["open", "pending"]);

  if (recsError)
    throw new Error(`reRankRecommendations load failed: ${recsError.message}`);

  const recs: OpenRec[] = (openRecs ?? []) as OpenRec[];
  if (recs.length === 0) return;

  // Load historical outcomes for this bank to compute category acceptance rates
  const { data: historicalData, error: histError } = await sb
    .from("buddy_recommendation_outcomes")
    .select("category, status")
    .eq("bank_id", bankId);

  if (histError)
    throw new Error(
      `reRankRecommendations historical load failed: ${histError.message}`,
    );

  const historical: HistoricalOutcome[] =
    (historicalData ?? []) as HistoricalOutcome[];

  // Build category acceptance rates
  const categoryStats = new Map<
    string,
    { total: number; accepted: number }
  >();
  for (const h of historical) {
    const stats = categoryStats.get(h.category) ?? { total: 0, accepted: 0 };
    stats.total++;
    if (h.status === "accepted") stats.accepted++;
    categoryStats.set(h.category, stats);
  }

  const now = Date.now();

  // Update each recommendation
  const updates = recs.map((rec) => {
    const ageMs = now - new Date(rec.created_at).getTime();
    const ageHours = ageMs / (1000 * 60 * 60);

    // Age decay
    const decayFactor = computeDecay(ageHours, rec.status);
    let adjustedScore = applyDecay(rec.priority_score, decayFactor);

    // Historical category acceptance boost/penalty
    const stats = categoryStats.get(rec.category);
    if (stats && stats.total >= 5) {
      const acceptanceRate = stats.accepted / stats.total;
      // Boost high-acceptance categories, penalize low-acceptance
      if (acceptanceRate >= 0.7) {
        adjustedScore *= 1.15;
      } else if (acceptanceRate < 0.3) {
        adjustedScore *= 0.85;
      }
    }

    return sb
      .from("buddy_action_recommendations")
      .update({ priority_score: Math.round(adjustedScore * 100) / 100 })
      .eq("id", rec.id);
  });

  await Promise.all(updates);
}
