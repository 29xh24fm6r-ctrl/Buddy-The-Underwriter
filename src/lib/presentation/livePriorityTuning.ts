/**
 * Live Priority Tuning — Phase 66C
 *
 * Adjusts display priority based on live outcome data.
 * Items that historically perform well get boosted;
 * stale items decay over time.
 * Pure function, no DB or server deps.
 */

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

/**
 * Boosts items that historically perform well.
 *
 * Formula: base * (1 + (acceptance - 0.5) * 0.4 + (impact - 0.5) * 0.4)
 * Result clamped to 1-100.
 */
export function adjustPriority(
  basePriority: number,
  historicalAcceptanceRate: number,
  historicalImpactScore: number,
): number {
  const boost =
    1 +
    (historicalAcceptanceRate - 0.5) * 0.4 +
    (historicalImpactScore - 0.5) * 0.4;
  return clamp(Math.round(basePriority * boost), 1, 100);
}

/**
 * Reduces priority for old items using linear decay.
 *
 * Once ageHours exceeds decayThresholdHours, priority decays linearly
 * toward 1 over double the threshold window.
 */
export function deprioritizeStale(
  priority: number,
  ageHours: number,
  decayThresholdHours: number,
): number {
  if (ageHours <= decayThresholdHours) return priority;

  const overage = ageHours - decayThresholdHours;
  const decayFactor = clamp(1 - overage / decayThresholdHours, 0, 1);
  return clamp(Math.round(priority * decayFactor), 1, 100);
}
