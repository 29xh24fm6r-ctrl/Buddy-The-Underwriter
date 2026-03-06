import type { ReconciliationCheck } from "./types";

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
  const { k1Allocations } = params;

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
