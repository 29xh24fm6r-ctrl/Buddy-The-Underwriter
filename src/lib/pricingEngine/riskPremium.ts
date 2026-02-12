/**
 * Pricing Engine — Risk Premium
 *
 * Maps risk tier to basis point premium.
 *
 * PHASE 5C: Pure constants — no DB, no side effects.
 */

import type { RiskTier } from "@/lib/policyEngine/types";

// ---------------------------------------------------------------------------
// Tier → Premium (bps)
// ---------------------------------------------------------------------------

const TIER_PREMIUM_BPS: Record<RiskTier, number> = {
  A: 0,
  B: 50,
  C: 125,
  D: 300,
};

/**
 * Get the risk premium in basis points for a given risk tier.
 */
export function getRiskPremiumBps(tier: RiskTier): number {
  return TIER_PREMIUM_BPS[tier];
}
