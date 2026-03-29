// Pure function. No DB. No side effects. No network.
// Phase 56R: Drift detection based on canonical references, not duplicate models.

import type { DriftSummary, DriftItem } from "./types";

type CanonicalDriftInput = {
  // Snapshot canonical references
  snapshotCanonicalLoanRequestId: string | null;
  snapshotFinancialSnapshotId: string | null;
  snapshotLifecycleStage: string;
  snapshotDocumentsReadinessPct: number | null;

  // Current canonical state
  currentCanonicalLoanRequestId: string | null;
  currentCanonicalLoanRequestUpdatedAt: string | null;
  currentFinancialSnapshotId: string | null;
  currentLifecycleStage: string;
  currentDocumentsReadinessPct: number | null;
  currentBlockerCount: number;

  // Key canonical loan request field diffs
  snapshotLoanAmount: number | null;
  currentLoanAmount: number | null;
  snapshotProductType: string | null;
  currentProductType: string | null;
  snapshotCollateralType: string | null;
  currentCollateralType: string | null;
};

/**
 * Detect drift by comparing canonical artifact references and key fields.
 * Phase 56R: uses canonical IDs, not duplicated model comparison.
 */
export function detectCanonicalDrift(input: CanonicalDriftInput): DriftSummary {
  const items: DriftItem[] = [];

  // Canonical loan request changed (different ID or version)
  if (
    input.snapshotCanonicalLoanRequestId &&
    input.currentCanonicalLoanRequestId &&
    input.snapshotCanonicalLoanRequestId !== input.currentCanonicalLoanRequestId
  ) {
    items.push({
      code: "canonical_loan_request_replaced",
      summary: "Canonical loan request was replaced since launch",
      impact: "all_underwriting",
    });
  }

  // Loan amount changed materially
  if (input.snapshotLoanAmount != null && input.currentLoanAmount != null) {
    const pctChange = Math.abs(input.currentLoanAmount - input.snapshotLoanAmount) / input.snapshotLoanAmount;
    if (pctChange > 0.1) {
      items.push({
        code: "loan_amount_changed",
        summary: `Loan amount changed by ${(pctChange * 100).toFixed(0)}% since launch`,
        impact: "all_underwriting",
      });
    }
  }

  // Product type changed
  if (input.snapshotProductType !== input.currentProductType && input.snapshotProductType && input.currentProductType) {
    items.push({
      code: "product_type_changed",
      summary: `Product type changed from ${input.snapshotProductType} to ${input.currentProductType}`,
      impact: "all_underwriting",
    });
  }

  // Collateral type changed
  if (input.snapshotCollateralType !== input.currentCollateralType && input.snapshotCollateralType && input.currentCollateralType) {
    items.push({
      code: "collateral_type_changed",
      summary: `Collateral type changed from ${input.snapshotCollateralType} to ${input.currentCollateralType}`,
      impact: "all_underwriting",
    });
  }

  // Financial snapshot changed
  if (
    input.snapshotFinancialSnapshotId &&
    input.currentFinancialSnapshotId &&
    input.snapshotFinancialSnapshotId !== input.currentFinancialSnapshotId
  ) {
    items.push({
      code: "financial_snapshot_changed",
      summary: "Financial snapshot changed since launch",
      impact: "spreads",
    });
  }

  // Document readiness regressed
  if (
    input.snapshotDocumentsReadinessPct != null &&
    input.currentDocumentsReadinessPct != null &&
    input.currentDocumentsReadinessPct < input.snapshotDocumentsReadinessPct
  ) {
    items.push({
      code: "readiness_regressed",
      summary: `Document readiness decreased from ${input.snapshotDocumentsReadinessPct}% to ${input.currentDocumentsReadinessPct}%`,
      impact: "all_underwriting",
    });
  }

  // New blockers appeared
  if (input.currentBlockerCount > 0) {
    items.push({
      code: "new_blockers_appeared",
      summary: `${input.currentBlockerCount} blocker${input.currentBlockerCount > 1 ? "s" : ""} appeared in live intake`,
      impact: "all_underwriting",
    });
  }

  const hasMaterial = items.some((i) => i.impact === "all_underwriting");

  return {
    hasDrift: items.length > 0,
    severity: items.length === 0 ? null : hasMaterial ? "material" : "warning",
    items,
  };
}
