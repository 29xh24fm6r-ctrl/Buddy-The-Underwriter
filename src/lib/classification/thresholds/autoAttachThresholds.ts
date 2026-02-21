/**
 * Adaptive Auto-Attach Thresholds — Baseline Map, Types, Constants
 *
 * Pure module. No server-only, no DB, no IO, no randomness, no clock access.
 *
 * The 12-cell baseline map (4 tiers x 3 bands) defines starting thresholds.
 * LOW band is NEVER loosened (CI-locked). Fallback tier is NEVER loosened.
 *
 * Banned: randomness, clock access, UUIDs, server-only imports
 */

import type { ConfidenceBand } from "../calibrateConfidence";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SpineTierKey =
  | "tier1_anchor"
  | "tier2_structural"
  | "tier3_llm"
  | "fallback";

/** One cell of the calibration curve from the DB view. */
export type CalibrationCell = {
  tier: SpineTierKey;
  band: ConfidenceBand;
  total: number;
  overrides: number;
  overrideRate: number;
};

/** Full calibration curve (up to 12 cells). */
export type CalibrationCurve = CalibrationCell[];

/** Policy parameters for the adaptive algorithm. */
export type AdaptivePolicy = {
  /** Minimum sample count per cell before adaptation is allowed. */
  minSamples: number;
  /** Target override rate — loosen only when at or below this. */
  targetOverrideRate: number;
  /** Step size for loosening (per calibration round). */
  loosenStep: number;
  /** Maximum cumulative loosening from baseline. */
  maxLoosen: number;
  /** Absolute floor — never go below this threshold. */
  floor: number;
  /** Absolute ceiling — never exceed this threshold. */
  ceiling: number;
};

/** Result from the pure resolver. */
export type ResolvedThreshold = {
  threshold: number;
  tier: SpineTierKey;
  band: ConfidenceBand;
  baseline: number;
  adapted: boolean;
  calibrationSamples: number;
  calibrationOverrideRate: number | null;
};

// ---------------------------------------------------------------------------
// Constants (CI-locked in adaptiveThresholdGuard.test.ts)
// ---------------------------------------------------------------------------

/** Version stamp for all adaptive threshold events. */
export const ADAPTIVE_THRESHOLD_VERSION = "adaptive_v1";

/**
 * Baseline threshold map: tier x band → threshold.
 *
 * Design principles:
 *   - tier1_anchor:HIGH is the loosest (0.90, same as current static)
 *   - tier3_llm and fallback are stricter — must prove themselves
 *   - LOW band is always 0.99 — near-impossible to auto-attach
 *   - fallback is always 0.99 — filename-only never auto-attaches
 *
 * Intentional: tier2+ baselines are TIGHTER than current static thresholds.
 * System must earn loosened thresholds with empirical evidence.
 */
export const BASELINE_THRESHOLDS: Record<SpineTierKey, Record<ConfidenceBand, number>> = {
  tier1_anchor:     { HIGH: 0.90, MEDIUM: 0.93, LOW: 0.99 },
  tier2_structural: { HIGH: 0.92, MEDIUM: 0.95, LOW: 0.99 },
  tier3_llm:        { HIGH: 0.95, MEDIUM: 0.97, LOW: 0.99 },
  fallback:         { HIGH: 0.99, MEDIUM: 0.99, LOW: 0.99 },
};

/** Default adaptive policy. */
export const DEFAULT_ADAPTIVE_POLICY: AdaptivePolicy = {
  minSamples: 50,
  targetOverrideRate: 0.05,
  loosenStep: 0.02,
  maxLoosen: 0.06,
  floor: 0.85,
  ceiling: 0.99,
};
