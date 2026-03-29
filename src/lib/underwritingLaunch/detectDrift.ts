// Pure function. No DB. No side effects. No network.
import type { DriftSummary, DriftItem } from "./types";

type DriftInput = {
  // Snapshot-time values
  snapshotLoanAmount: number | null;
  snapshotLoanType: string | null;
  snapshotCollateralType: string | null;
  snapshotConfirmedDocIds: string[];
  snapshotRequirementSatisfiedCount: number;

  // Current live values
  currentLoanAmount: number | null;
  currentLoanType: string | null;
  currentCollateralType: string | null;
  currentConfirmedDocIds: string[];
  currentRequirementSatisfiedCount: number;
  currentBlockerCount: number;
};

/**
 * Detect material drift between launch snapshot and current live intake state.
 * Returns structured drift summary.
 */
export function detectUnderwritingDrift(input: DriftInput): DriftSummary {
  const items: DriftItem[] = [];

  // Loan amount changed materially (>10% or from/to null)
  if (input.snapshotLoanAmount !== input.currentLoanAmount) {
    if (!input.snapshotLoanAmount || !input.currentLoanAmount) {
      items.push({
        code: "loan_amount_changed",
        summary: "Loan amount changed since launch",
        impact: "all_underwriting",
      });
    } else {
      const pctChange = Math.abs(input.currentLoanAmount - input.snapshotLoanAmount) / input.snapshotLoanAmount;
      if (pctChange > 0.1) {
        items.push({
          code: "loan_amount_changed",
          summary: `Loan amount changed by ${(pctChange * 100).toFixed(0)}% since launch`,
          impact: "all_underwriting",
        });
      }
    }
  }

  // Loan type changed
  if (input.snapshotLoanType !== input.currentLoanType) {
    items.push({
      code: "loan_type_changed",
      summary: `Loan type changed from ${input.snapshotLoanType ?? "none"} to ${input.currentLoanType ?? "none"}`,
      impact: "all_underwriting",
    });
  }

  // Collateral type changed
  if (input.snapshotCollateralType !== input.currentCollateralType) {
    items.push({
      code: "collateral_type_changed",
      summary: `Collateral type changed from ${input.snapshotCollateralType ?? "none"} to ${input.currentCollateralType ?? "none"}`,
      impact: "all_underwriting",
    });
  }

  // Confirmed document removed
  const removedDocs = input.snapshotConfirmedDocIds.filter(
    (id) => !input.currentConfirmedDocIds.includes(id),
  );
  if (removedDocs.length > 0) {
    items.push({
      code: "confirmed_doc_removed",
      summary: `${removedDocs.length} previously confirmed document${removedDocs.length > 1 ? "s" : ""} removed or rejected`,
      impact: "spreads",
    });
  }

  // New blockers appeared
  if (input.currentBlockerCount > 0) {
    items.push({
      code: "new_blockers_appeared",
      summary: `${input.currentBlockerCount} new blocker${input.currentBlockerCount > 1 ? "s" : ""} appeared in live intake`,
      impact: "all_underwriting",
    });
  }

  // Requirement satisfaction decreased
  if (input.currentRequirementSatisfiedCount < input.snapshotRequirementSatisfiedCount) {
    items.push({
      code: "requirement_satisfaction_decreased",
      summary: "Requirement satisfaction decreased since launch",
      impact: "all_underwriting",
    });
  }

  const hasMaterial = items.some(
    (i) => i.impact === "all_underwriting" || i.code === "confirmed_doc_removed",
  );

  return {
    hasDrift: items.length > 0,
    severity: items.length === 0 ? null : hasMaterial ? "material" : "warning",
    items,
  };
}
