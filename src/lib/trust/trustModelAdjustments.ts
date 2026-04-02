/**
 * Trust Model Adjustments — Phase 66C, System 4 (pure)
 *
 * Computes trust model adjustments from observed override, drilldown,
 * and acceptance rates. Pure function — no DB, no server-only.
 */

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export type TrustAdjustment = {
  /** Range: -0.3 to +0.1 */
  confidenceShift: number;
  shouldDowngrade: boolean;
  shouldUpgrade: boolean;
  rationale: string;
};

/* ------------------------------------------------------------------ */
/*  computeTrustAdjustment                                             */
/* ------------------------------------------------------------------ */

export function computeTrustAdjustment(
  overrideRate: number,
  drilldownRate: number,
  acceptanceRate: number,
): TrustAdjustment {
  /* High override rate — bankers are frequently correcting Buddy */
  if (overrideRate > 0.3) {
    return {
      confidenceShift: -0.2,
      shouldDowngrade: true,
      shouldUpgrade: false,
      rationale:
        `Override rate ${(overrideRate * 100).toFixed(1)}% exceeds 30% threshold. ` +
        `Confidence should be reduced for affected conclusions.`,
    };
  }

  /* Very high override rate — severe trust erosion */
  if (overrideRate > 0.5) {
    return {
      confidenceShift: -0.3,
      shouldDowngrade: true,
      shouldUpgrade: false,
      rationale:
        `Override rate ${(overrideRate * 100).toFixed(1)}% exceeds 50% threshold. ` +
        `Significant confidence reduction recommended.`,
    };
  }

  /* Low override + high acceptance — banker trusts Buddy */
  if (overrideRate < 0.1 && acceptanceRate > 0.8) {
    return {
      confidenceShift: 0.1,
      shouldDowngrade: false,
      shouldUpgrade: true,
      rationale:
        `Low override rate (${(overrideRate * 100).toFixed(1)}%) with high acceptance ` +
        `(${(acceptanceRate * 100).toFixed(1)}%). Trust is well-calibrated — minor upgrade warranted.`,
    };
  }

  /* High drilldown + low override = healthy engagement, no change */
  if (drilldownRate > 0.3 && overrideRate < 0.15) {
    return {
      confidenceShift: 0,
      shouldDowngrade: false,
      shouldUpgrade: false,
      rationale:
        `High drilldown rate (${(drilldownRate * 100).toFixed(1)}%) with low overrides ` +
        `(${(overrideRate * 100).toFixed(1)}%). Bankers are engaged and generally agree — no adjustment needed.`,
    };
  }

  /* Default — no significant signal */
  return {
    confidenceShift: 0,
    shouldDowngrade: false,
    shouldUpgrade: false,
    rationale: "Insufficient signal to warrant trust adjustment.",
  };
}
