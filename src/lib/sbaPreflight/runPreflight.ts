import type { PreflightIssue, PreflightResult } from "@/lib/sbaPreflight/types";

/**
 * This function should produce deterministic, typed issues.
 * The UI and workflow depend on `severity` being present.
 */
export async function runPreflight(input: any): Promise<PreflightResult> {
  // NOTE: Replace this placeholder logic with your actual SBA logic.
  // The key is: every issue MUST include severity.

  const errors: PreflightIssue[] = [];
  const warnings: PreflightIssue[] = [];

  // Example: missing borrower entity name
  if (!input?.borrowerName) {
    errors.push({
      severity: "BLOCK",
      code: "MISSING_BORROWER_NAME",
      message: "Borrower name is required for SBA preflight.",
    });
  }

  // Example: missing NAICS
  if (!input?.naics) {
    warnings.push({
      severity: "WARN",
      code: "MISSING_NAICS",
      message: "NAICS code not provided.",
    });
  }

  const ok = errors.length === 0;

  return {
    score: ok ? 100 : Math.max(0, 100 - errors.length * 25 - warnings.length * 5),
    passed: ok,
    blocking_issues: errors,
    warnings: warnings,
  };
}
