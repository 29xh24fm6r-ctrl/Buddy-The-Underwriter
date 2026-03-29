// Pure function. No DB. No side effects. No network.
import type { DistressRollupInput, RelationshipDistressState } from "./types";

/**
 * Derive relationship-level distress state from all linked deals.
 * Prevents distressed credits from disappearing into isolated deal tabs.
 */
export function deriveRelationshipDistressState(
  input: DistressRollupInput,
): RelationshipDistressState {
  if (input.deals.length === 0) return "healthy";

  const hasWorkout = input.deals.some((d) => d.operatingState === "workout");
  const hasWatchlist = input.deals.some((d) => d.operatingState === "watchlist");
  const hasMonitored = input.deals.some((d) => d.operatingState === "monitored");
  const hasResolved = input.deals.some(
    (d) => d.operatingState === "resolved" || d.operatingState === "resolution_pending",
  );

  // Mixed = both watchlist and workout exposure across deals
  if (hasWorkout && hasWatchlist) return "mixed_distress";
  if (hasWorkout) return "workout_exposure";
  if (hasWatchlist) return "watchlist_exposure";
  if (hasMonitored) return "monitored";
  if (hasResolved && !hasWorkout && !hasWatchlist) return "resolved";

  return "healthy";
}
