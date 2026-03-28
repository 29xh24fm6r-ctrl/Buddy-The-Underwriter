/**
 * Phase 65K — Derive Overlay Recommendation
 *
 * Pure function — no DB, no side effects.
 */

import type { OverlayRecommendation } from "./types";

export type RecommendationInput = {
  hasActiveWatchlist: boolean;
  hasActiveWorkout: boolean;
  watchlistSeverity: string | null;
  openActionItemCount: number;
};

export function deriveOverlayRecommendation(
  input: RecommendationInput,
): OverlayRecommendation {
  // Already in workout — no further escalation needed
  if (input.hasActiveWorkout) {
    return "none";
  }

  // Active watchlist with critical severity → escalate
  if (input.hasActiveWatchlist && input.watchlistSeverity === "critical") {
    return "escalate_to_workout";
  }

  // Active watchlist with no open items → might be closeable
  if (input.hasActiveWatchlist && input.openActionItemCount === 0) {
    return "close_watchlist";
  }

  if (input.hasActiveWatchlist) {
    return "none";
  }

  return "none";
}
