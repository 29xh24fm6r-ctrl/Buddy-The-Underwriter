/**
 * Phase 53 — Buddy Validation Pass Types
 *
 * Data integrity check, not a second underwriting opinion.
 * Validates that numbers are consistent, not whether the deal is creditworthy.
 */

export type ValidationFamily =
  | "completeness"
  | "mathematical"
  | "cross_period"
  | "cross_document"
  | "plausibility";

export type ValidationCheckStatus = "PASS" | "FLAG" | "BLOCK";
export type ValidationSeverity = "info" | "warning" | "error";

export type ValidationCheck = {
  family: ValidationFamily;
  name: string;
  status: ValidationCheckStatus;
  message: string;
  affectedFields?: string[];
  severity: ValidationSeverity;
};

export type ValidationReport = {
  dealId: string;
  runAt: string;
  overallStatus: "PASS" | "PASS_WITH_FLAGS" | "FAIL";
  gatingDecision: "ALLOW_GENERATION" | "BLOCK_GENERATION";
  checks: ValidationCheck[];
  summary: string;
  flagCount: number;
  blockCount: number;
  snapshotHash: string | null;
};
