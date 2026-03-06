import type { ReconciliationCheck } from "./types";

/**
 * Verify that K-1 income on personal return matches entity allocation.
 * Pure function — no DB.
 */
export function checkK1ToPersonal(params: {
  entityK1Income: number | null;
  personalK1Income: number | null;
  ownershipPct: number | null;
  entityName: string;
}): ReconciliationCheck {
  const { entityK1Income, personalK1Income, ownershipPct, entityName } = params;

  if (entityK1Income === null || personalK1Income === null || ownershipPct === null) {
    const missing: string[] = [];
    if (entityK1Income === null) missing.push("entity K-1 income");
    if (personalK1Income === null) missing.push("personal K-1 income");
    if (ownershipPct === null) missing.push("ownership percentage");
    return {
      checkId: "K1_TO_PERSONAL",
      description: `K-1 personal return matches entity allocation for ${entityName}`,
      status: "SKIPPED",
      severity: "HARD",
      skipReason: `Missing: ${missing.join(", ")}`,
      lhsLabel: "Personal Return K-1 Income (Schedule E)",
      lhsValue: null,
      rhsLabel: `Entity K-1 Allocated Income (${entityName})`,
      rhsValue: null,
      delta: null,
      toleranceAmount: null,
      notes: "",
    };
  }

  const expected = entityK1Income * ownershipPct;
  const tolerance = Math.max(100, expected * 0.01);
  const delta = Math.abs(personalK1Income - expected);
  const passed = delta <= tolerance;

  return {
    checkId: "K1_TO_PERSONAL",
    description: `K-1 personal return matches entity allocation for ${entityName}`,
    status: passed ? "PASSED" : "FAILED",
    severity: "HARD",
    lhsLabel: "Personal Return K-1 Income (Schedule E)",
    lhsValue: personalK1Income,
    rhsLabel: `Entity K-1 Allocated Income (${entityName})`,
    rhsValue: expected,
    delta,
    toleranceAmount: tolerance,
    notes: passed
      ? ""
      : "K-1 income on personal return does not match entity allocation. May indicate unreported income, mismatched ownership %, or extraction error.",
  };
}
