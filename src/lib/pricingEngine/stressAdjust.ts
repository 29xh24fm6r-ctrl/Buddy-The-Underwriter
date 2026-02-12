/**
 * Pricing Engine — Stress Adjustment
 *
 * Computes additional basis points when stress testing degrades the risk tier.
 *
 * Rules:
 * - 1 tier degradation → +25bps
 * - 2 tier degradation → +50bps
 * - 3 tier degradation → +75bps
 * - Same or better → +0bps
 *
 * PHASE 5C: Pure computation — no DB, no side effects.
 */

import type { RiskTier } from "@/lib/policyEngine/types";

// ---------------------------------------------------------------------------
// Tier ordering
// ---------------------------------------------------------------------------

const TIER_ORDER: Record<RiskTier, number> = { A: 0, B: 1, C: 2, D: 3 };

const BPS_PER_TIER_DEGRADATION = 25;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Compute stress adjustment in basis points based on tier degradation.
 *
 * Returns 0 if stressedTier is same or better than baseTier.
 */
export function getStressAdjustmentBps(
  baseTier: RiskTier,
  stressedTier: RiskTier | undefined,
): number {
  if (stressedTier === undefined) return 0;

  const degradation = TIER_ORDER[stressedTier] - TIER_ORDER[baseTier];

  if (degradation <= 0) return 0;

  return degradation * BPS_PER_TIER_DEGRADATION;
}
