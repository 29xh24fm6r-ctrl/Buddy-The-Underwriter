import type { ReconciliationCheck } from "./types";

/**
 * Verify that K-1 allocations sum to entity OBI.
 * Pure function — no DB.
 */
export function checkK1ToEntity(params: {
  entityObi: number | null;
  k1Allocations: Array<{
    partnerName: string;
    ordinaryIncome: number | null;
    ownershipPct: number | null;
  }>;
}): ReconciliationCheck {
  const { entityObi, k1Allocations } = params;

  if (entityObi === null) {
    return skipped("Entity OBI not available");
  }

  if (k1Allocations.length === 0) {
    return skipped("No K-1 allocations available");
  }

  if (k1Allocations.some((k) => k.ownershipPct === null)) {
    return skipped("One or more K-1 allocations missing ownership percentage");
  }

  const sum = k1Allocations.reduce(
    (acc, k) => acc + (k.ordinaryIncome ?? 0) * (k.ownershipPct ?? 0),
    0,
  );

  const delta = Math.abs(entityObi - sum);
  const passed = delta <= 1;

  return {
    checkId: "K1_TO_ENTITY",
    description: "K-1 allocations sum to entity OBI",
    status: passed ? "PASSED" : "FAILED",
    severity: "HARD",
    lhsLabel: "Entity OBI (Form 1065 Page 1)",
    lhsValue: entityObi,
    rhsLabel: "Sum of K-1 Allocated Income",
    rhsValue: sum,
    delta,
    toleranceAmount: 1,
    notes: passed
      ? ""
      : "K-1 allocations do not sum to entity OBI. Verify ownership percentages and partner count. Missing K-1s or extraction error likely.",
  };
}

function skipped(reason: string): ReconciliationCheck {
  return {
    checkId: "K1_TO_ENTITY",
    description: "K-1 allocations sum to entity OBI",
    status: "SKIPPED",
    severity: "HARD",
    skipReason: reason,
    lhsLabel: "Entity OBI (Form 1065 Page 1)",
    lhsValue: null,
    rhsLabel: "Sum of K-1 Allocated Income",
    rhsValue: null,
    delta: null,
    toleranceAmount: null,
    notes: "",
  };
}
