import type { ReconciliationCheck } from "./types";

/**
 * Normalize an ownership percentage to a FRACTION (0–1).
 *
 * K-1 extraction emits K1_OWNERSHIP_PCT on the percent scale ("percentage
 * 100.000000 %" → 100), while the reconciliation checks reason in fractions.
 * Feeding 100 into the fraction math produced "Ownership exceeds 100%
 * (10000.0%)" HARD failures on every single-owner S-corp/partnership.
 *
 * Rule: values > 1 are percents (divide by 100); values in [0, 1] are already
 * fractions. Exactly 1 is ambiguous (1% vs 100%) — treat it as 100% since a
 * partner holding exactly 1% is far rarer than a sole owner holding 100%
 * expressed as 1.0.
 */
export function normalizeOwnershipFraction(pct: number | null | undefined): number | null {
  if (pct === null || pct === undefined || !Number.isFinite(pct)) return null;
  if (pct < 0) return null;
  const fraction = pct > 1 ? pct / 100 : pct;
  return Math.round(fraction * 1e6) / 1e6;
}

/**
 * Verify K-1 ownership percentages sum to ~100%.
 * Pure function — no DB.
 */
export function checkOwnershipIntegrity(params: {
  k1Allocations: Array<{
    partnerName: string;
    ownershipPct: number | null;
  }>;
}): ReconciliationCheck {
  const k1Allocations = params.k1Allocations.map((k) => ({
    ...k,
    ownershipPct: normalizeOwnershipFraction(k.ownershipPct),
  }));

  if (k1Allocations.length === 0) {
    return {
      checkId: "OWNERSHIP_INTEGRITY",
      description: "K-1 ownership percentages sum to 100%",
      status: "SKIPPED",
      severity: "HARD",
      skipReason: "No K-1 allocations available",
      lhsLabel: "Sum of Partner Ownership Percentages",
      lhsValue: null,
      rhsLabel: "100%",
      rhsValue: null,
      delta: null,
      toleranceAmount: null,
      notes: "",
    };
  }

  const withPct = k1Allocations.filter((k) => k.ownershipPct !== null);
  const withoutPct = k1Allocations.filter((k) => k.ownershipPct === null);

  if (withPct.length === 0) {
    return {
      checkId: "OWNERSHIP_INTEGRITY",
      description: "K-1 ownership percentages sum to 100%",
      status: "SKIPPED",
      severity: "HARD",
      skipReason: "All K-1 allocations missing ownership percentage",
      lhsLabel: "Sum of Partner Ownership Percentages",
      lhsValue: null,
      rhsLabel: "100%",
      rhsValue: null,
      delta: null,
      toleranceAmount: null,
      notes: "",
    };
  }

  const sum = withPct.reduce((acc, k) => acc + (k.ownershipPct ?? 0), 0);
  const delta = Math.abs(sum - 1.0);

  const missingNote =
    withoutPct.length > 0
      ? ` ${withoutPct.length} partner(s) missing ownership percentage.`
      : "";
  const partnerNote = `${withPct.length} partner(s) with ownership data.${missingNote}`;

  // Passes if sum is within 99%-101%
  if (sum >= 0.99 && sum <= 1.01) {
    return {
      checkId: "OWNERSHIP_INTEGRITY",
      description: "K-1 ownership percentages sum to 100%",
      status: "PASSED",
      severity: "HARD",
      lhsLabel: "Sum of Partner Ownership Percentages",
      lhsValue: sum,
      rhsLabel: "100%",
      rhsValue: 1.0,
      delta,
      toleranceAmount: 0.01,
      notes: partnerNote,
    };
  }

  // HARD failure if sum > 101% (impossible)
  if (sum > 1.01) {
    return {
      checkId: "OWNERSHIP_INTEGRITY",
      description: "K-1 ownership percentages sum to 100%",
      status: "FAILED",
      severity: "HARD",
      lhsLabel: "Sum of Partner Ownership Percentages",
      lhsValue: sum,
      rhsLabel: "100%",
      rhsValue: 1.0,
      delta,
      toleranceAmount: 0.01,
      notes: `Ownership exceeds 100% (${(sum * 100).toFixed(1)}%). This is impossible — verify K-1 extraction. ${partnerNote}`,
    };
  }

  // SOFT failure if sum < 95% (missing K-1s likely)
  if (sum < 0.95) {
    return {
      checkId: "OWNERSHIP_INTEGRITY",
      description: "K-1 ownership percentages sum to 100%",
      status: "FAILED",
      severity: "SOFT",
      lhsLabel: "Sum of Partner Ownership Percentages",
      lhsValue: sum,
      rhsLabel: "100%",
      rhsValue: 1.0,
      delta,
      toleranceAmount: 0.05,
      notes: `Ownership sums to only ${(sum * 100).toFixed(1)}%. Missing K-1s likely. ${partnerNote}`,
    };
  }

  // Between 95%-99%: SOFT flag
  return {
    checkId: "OWNERSHIP_INTEGRITY",
    description: "K-1 ownership percentages sum to 100%",
    status: "FAILED",
    severity: "SOFT",
    lhsLabel: "Sum of Partner Ownership Percentages",
    lhsValue: sum,
    rhsLabel: "100%",
    rhsValue: 1.0,
    delta,
    toleranceAmount: 0.01,
    notes: `Ownership sums to ${(sum * 100).toFixed(1)}% — minor discrepancy. ${partnerNote}`,
  };
}
