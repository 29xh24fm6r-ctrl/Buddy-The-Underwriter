/**
 * Model Engine V2 — Parity Thresholds
 *
 * Phase 2 configuration: exact match required initially.
 * Later phases may relax to de minimis rounding tolerance.
 */

import type { ParityThresholds } from "./types";

/**
 * Default thresholds: exact match (zero tolerance).
 *
 * Phase 2 starts strict. If systematic rounding differences appear
 * in production, relax to RELAXED_THRESHOLDS with explicit justification.
 */
export const DEFAULT_THRESHOLDS: ParityThresholds = {
  lineItemTolerance: 0,       // exact match
  headlineAbsTolerance: 0,    // exact match
  headlinePctTolerance: 0,    // exact match
  missingPeriodFails: true,   // any missing period => fail
};

/**
 * Relaxed thresholds for rounding tolerance.
 * Use only after confirming systematic rounding differences.
 */
export const RELAXED_THRESHOLDS: ParityThresholds = {
  lineItemTolerance: 1,        // $1 rounding
  headlineAbsTolerance: 1,     // $1 rounding
  headlinePctTolerance: 0.001, // 0.1%
  missingPeriodFails: true,
};
