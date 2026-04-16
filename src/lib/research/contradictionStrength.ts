/**
 * Phase 82: Proof of Truth — Contradiction Strength Scoring
 *
 * Gate 7 (Phase 79) enforces that required contradiction checks are *addressed*
 * in the synthesis, but says nothing about *quality*. A contradiction that
 * merely repeats a narrative claim without authoritative sourcing is weak.
 *
 * This module grades each covered check as "strong" | "weak" | "none" based
 * on whether the research has primary-source backing (court records or
 * regulatory filings). Source→check linkage is not available in the schema,
 * so we use the mission-wide source pool as the best available signal. This
 * is pragmatic: the alternative (full thread_sources linkage) is the
 * overengineered path Phase 82 explicitly rejects.
 *
 * Pure function. No DB, no server-only.
 */

import {
  REQUIRED_CONTRADICTION_CHECKS,
  type ContradictionCheckKey,
} from "./completionGate";
import { classifySourceUrl, type SourceType } from "./sourcePolicy";

export type ContradictionStrength = "strong" | "weak" | "none";

const PRIMARY_SOURCE_TYPES: readonly SourceType[] = [
  "court_record",
  "regulatory_filing",
];

export type ContradictionStrengthSummary = {
  perCheck: Record<ContradictionCheckKey, ContradictionStrength>;
  strongCount: number;
  weakCount: number;
  noneCount: number;
  /** Count of required checks (REQUIRED_CONTRADICTION_CHECKS.length) */
  requiredCount: number;
  /** strongCount / requiredCount — null when requiredCount === 0 */
  strongRatio: number | null;
  hasPrimarySources: boolean;
};

/**
 * Grade a single covered check given the mission source pool.
 * - not covered → "none"
 * - covered & ≥1 primary source in pool → "strong"
 * - covered & no primary source → "weak"
 */
export function computeContradictionStrength(
  checkCovered: boolean,
  sourceUrls: readonly string[],
): ContradictionStrength {
  if (!checkCovered) return "none";

  const hasPrimary = sourceUrls.some((url) =>
    PRIMARY_SOURCE_TYPES.includes(classifySourceUrl(url)),
  );

  return hasPrimary ? "strong" : "weak";
}

/**
 * Summarize strength across all REQUIRED_CONTRADICTION_CHECKS.
 *
 * @param coveredChecks checks addressed in synthesis (from evaluateContradictionCoverage)
 * @param sourceUrls the mission's bieResult.sources_used
 */
export function computeContradictionStrengthSummary(
  coveredChecks: readonly ContradictionCheckKey[],
  sourceUrls: readonly string[],
): ContradictionStrengthSummary {
  const coveredSet = new Set(coveredChecks);
  const hasPrimarySources = sourceUrls.some((url) =>
    PRIMARY_SOURCE_TYPES.includes(classifySourceUrl(url)),
  );

  const perCheck = {} as Record<ContradictionCheckKey, ContradictionStrength>;
  let strongCount = 0;
  let weakCount = 0;
  let noneCount = 0;

  for (const key of REQUIRED_CONTRADICTION_CHECKS) {
    const covered = coveredSet.has(key);
    const strength: ContradictionStrength = !covered
      ? "none"
      : hasPrimarySources
        ? "strong"
        : "weak";
    perCheck[key] = strength;
    if (strength === "strong") strongCount++;
    else if (strength === "weak") weakCount++;
    else noneCount++;
  }

  const requiredCount: number = REQUIRED_CONTRADICTION_CHECKS.length;
  const strongRatio = requiredCount === 0 ? null : strongCount / requiredCount;

  return {
    perCheck,
    strongCount,
    weakCount,
    noneCount,
    requiredCount,
    strongRatio,
    hasPrimarySources,
  };
}
