/**
 * Adaptive Auto-Attach Threshold Resolver — Pure Function
 *
 * Pure module. No server-only, no DB, no IO.
 * Same inputs = same output. Always.
 *
 * Algorithm:
 *   1. Look up baseline from BASELINE_THRESHOLDS[tier][band]
 *   2. Hard guards — LOW band, fallback tier, missing data, insufficient samples, high override rate
 *   3. Progressive loosening — the better the override rate, the more loosening
 *   4. Clamp to [floor, ceiling]
 *
 * Banned: randomness, clock access, UUIDs, server-only imports
 */

import type { ConfidenceBand } from "../calibrateConfidence";
import {
  BASELINE_THRESHOLDS,
  DEFAULT_ADAPTIVE_POLICY,
  type SpineTierKey,
  type CalibrationCurve,
  type AdaptivePolicy,
  type ResolvedThreshold,
} from "./autoAttachThresholds";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Resolve the auto-attach threshold for a given (tier, band) pair.
 *
 * @param tier - Spine classification tier
 * @param band - Confidence band (HIGH/MEDIUM/LOW)
 * @param calibration - Calibration curve data (may be empty)
 * @param policy - Adaptive policy params (defaults to DEFAULT_ADAPTIVE_POLICY)
 * @returns ResolvedThreshold with threshold, audit fields, and adaptation status
 */
export function resolveAutoAttachThreshold(
  tier: SpineTierKey,
  band: ConfidenceBand,
  calibration: CalibrationCurve,
  policy: AdaptivePolicy = DEFAULT_ADAPTIVE_POLICY,
): ResolvedThreshold {
  const baseline = BASELINE_THRESHOLDS[tier]?.[band] ?? policy.ceiling;

  // Find calibration cell
  const cell = calibration.find((c) => c.tier === tier && c.band === band);
  const samples = cell?.total ?? 0;
  const overrideRate = cell?.overrideRate ?? null;

  // ── Guard 1: LOW band never loosens ──────────────────────────────────
  if (band === "LOW") {
    return makeResult(baseline, tier, band, false, samples, overrideRate);
  }

  // ── Guard 2: fallback tier never loosens ─────────────────────────────
  if (tier === "fallback") {
    return makeResult(baseline, tier, band, false, samples, overrideRate);
  }

  // ── Guard 3: no calibration cell → baseline ──────────────────────────
  if (!cell) {
    return makeResult(baseline, tier, band, false, samples, overrideRate);
  }

  // ── Guard 4: insufficient samples → baseline ────────────────────────
  if (samples < policy.minSamples) {
    return makeResult(baseline, tier, band, false, samples, overrideRate);
  }

  // ── Guard 5: override rate too high → baseline ──────────────────────
  if (overrideRate !== null && overrideRate > policy.targetOverrideRate) {
    return makeResult(baseline, tier, band, false, samples, overrideRate);
  }

  // ── Progressive loosening ────────────────────────────────────────────
  // The better the override rate, the more steps we loosen.
  const actualRate = overrideRate ?? 0;
  const delta = policy.targetOverrideRate - actualRate;
  const maxSteps = Math.floor(policy.maxLoosen / policy.loosenStep);
  const steps = Math.min(
    Math.floor(delta / policy.loosenStep) + 1,
    maxSteps,
  );

  const loosened = baseline - steps * policy.loosenStep;

  // Clamp to [floor, ceiling]
  const threshold = Math.max(policy.floor, Math.min(policy.ceiling, loosened));

  return makeResult(threshold, tier, band, threshold !== baseline, samples, overrideRate);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeResult(
  threshold: number,
  tier: SpineTierKey,
  band: ConfidenceBand,
  adapted: boolean,
  calibrationSamples: number,
  calibrationOverrideRate: number | null,
): ResolvedThreshold {
  return {
    threshold,
    tier,
    band,
    baseline: BASELINE_THRESHOLDS[tier]?.[band] ?? 0.99,
    adapted,
    calibrationSamples,
    calibrationOverrideRate,
  };
}
