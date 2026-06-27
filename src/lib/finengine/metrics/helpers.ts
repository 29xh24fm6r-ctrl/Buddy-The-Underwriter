/**
 * SPEC-FINENGINE-FULL-SPREAD-1 — shared metric helpers.
 *
 * Extracted verbatim from metrics/ratios.ts so every metric module reuses ONE
 * `div` / `withFloor` (no forked style, no second copy). Pure — no DB.
 */

import type { MetricResult, PolicyContext } from "@/lib/finengine/contracts";
import { resolvePolicy } from "@/lib/finengine/policyRegistry";

/** Null-safe divide; null on missing operand or zero denominator. */
export const div = (a: number | null, b: number | null): number | null =>
  a == null || b == null || b === 0 ? null : a / b;

/**
 * Two-period average balance: mean of beginning + ending when both present;
 * the single available value otherwise; null when neither is present.
 */
export const avgBalance = (beginning: number | null, ending: number | null): number | null => {
  if (beginning != null && ending != null) return (beginning + ending) / 2;
  return ending ?? beginning ?? null;
};

/** Attach the registry-resolved policy + pass/fail to a metric (floor or cap axis). */
export function withFloor(
  base: Omit<MetricResult, "policyApplied" | "passesFloor">,
  axis: string,
  ctx?: PolicyContext,
): MetricResult {
  const policy = resolvePolicy(axis, ctx);
  let passesFloor: boolean | undefined;
  if (base.value != null && policy.effective != null) {
    passesFloor = policy.direction === "floor" ? base.value >= policy.effective : base.value <= policy.effective;
  }
  return { ...base, policyApplied: policy, passesFloor };
}
