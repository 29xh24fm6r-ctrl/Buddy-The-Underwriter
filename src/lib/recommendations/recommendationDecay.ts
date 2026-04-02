/**
 * Phase 66C — Recommendation Decay: Decays recommendation priority based on age and inaction.
 * Pure module — no server-only, no DB access.
 */

/**
 * Computes a decay factor (0-1) based on recommendation age and status.
 *
 * - dismissed → immediate full decay (0.0)
 * - accepted/completed → no decay (1.0)
 * - open + age > 336h (14d) → 0.2
 * - open + age > 168h (7d) → 0.4
 * - open + age > 72h (3d) → 0.7
 * - otherwise → 1.0
 */
export function computeDecay(ageHours: number, status: string): number {
  if (status === "dismissed") return 0.0;
  if (status === "accepted" || status === "completed") return 1.0;

  if (ageHours > 336) return 0.2;
  if (ageHours > 168) return 0.4;
  if (ageHours > 72) return 0.7;

  return 1.0;
}

/**
 * Applies a decay factor to a priority score.
 */
export function applyDecay(priorityScore: number, decayFactor: number): number {
  return priorityScore * decayFactor;
}
