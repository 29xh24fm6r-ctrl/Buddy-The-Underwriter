/**
 * Tuning Safety Checks — Phase 66C, System 6 (pure)
 *
 * Validates that proposed tuning changes are within the bounds
 * defined by the tuning registry constraints.
 */

import type { TunableDomain } from "./tuningRegistry";
import { getDomainConstraints } from "./tuningRegistry";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export type SafetyCheckResult = {
  safe: boolean;
  violations: string[];
  changePercent: number;
};

/* ------------------------------------------------------------------ */
/*  validateTuningChange                                               */
/* ------------------------------------------------------------------ */

export function validateTuningChange(
  domain: TunableDomain,
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): SafetyCheckResult {
  const constraints = getDomainConstraints(domain);
  const violations: string[] = [];
  let maxObservedChangePercent = 0;

  /* Check each key present in `after` */
  for (const key of Object.keys(after)) {
    const beforeVal = typeof before[key] === "number" ? (before[key] as number) : undefined;
    const afterVal = typeof after[key] === "number" ? (after[key] as number) : undefined;

    if (afterVal === undefined) continue;

    /* Bounds check */
    if (constraints.minValue !== undefined && afterVal < constraints.minValue) {
      violations.push(
        `${key}: value ${afterVal} is below minimum ${constraints.minValue}`,
      );
    }
    if (constraints.maxValue !== undefined && afterVal > constraints.maxValue) {
      violations.push(
        `${key}: value ${afterVal} exceeds maximum ${constraints.maxValue}`,
      );
    }

    /* Change percent check (only if we have a before value) */
    if (beforeVal !== undefined && beforeVal !== 0) {
      const changePct = Math.abs((afterVal - beforeVal) / beforeVal) * 100;
      if (changePct > maxObservedChangePercent) {
        maxObservedChangePercent = changePct;
      }
      if (changePct > constraints.maxChangePercent) {
        violations.push(
          `${key}: change of ${changePct.toFixed(1)}% exceeds max allowed ${constraints.maxChangePercent}%`,
        );
      }
    }
  }

  return {
    safe: violations.length === 0,
    violations,
    changePercent: maxObservedChangePercent,
  };
}
