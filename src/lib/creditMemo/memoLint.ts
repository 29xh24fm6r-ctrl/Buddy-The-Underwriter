/**
 * Phase 81: Memo Lint Pass
 *
 * Validates a canonical memo for committee readiness.
 * Committee memos must pass all lint rules before export.
 * Diagnostic memos are exempt.
 */

import type { CanonicalCreditMemoV1 } from "./canonical/types";

export type LintSeverity = "error" | "warning";

export type LintIssue = {
  section: string;
  rule: string;
  severity: LintSeverity;
  message: string;
};

export type MemoLintResult = {
  passed: boolean;
  issues: LintIssue[];
  errorCount: number;
  warningCount: number;
};

/**
 * Lint a canonical memo for committee readiness.
 * Returns passed=true only if zero errors (warnings allowed).
 */
export function lintCanonicalMemo(memo: CanonicalCreditMemoV1): MemoLintResult {
  const issues: LintIssue[] = [];

  // Rule 1: No raw "Pending" in committee-visible text fields
  const pendingPattern = /^Pending\b/i;
  const textFields: Array<{ section: string; value: string | null | undefined }> = [
    { section: "business_summary.business_description", value: memo.business_summary?.business_description },
    { section: "business_summary.geography", value: memo.business_summary?.geography },
    { section: "business_summary.revenue_mix", value: memo.business_summary?.revenue_mix },
    { section: "financial_analysis.income_analysis", value: memo.financial_analysis?.income_analysis },
    { section: "financial_analysis.projection_feasibility", value: memo.financial_analysis?.projection_feasibility },
    { section: "executive_summary.narrative", value: memo.executive_summary?.narrative },
    { section: "borrower_sponsor.background", value: memo.borrower_sponsor?.background },
    { section: "borrower_sponsor.experience", value: memo.borrower_sponsor?.experience },
    { section: "borrower_sponsor.guarantor_strength", value: memo.borrower_sponsor?.guarantor_strength },
  ];

  for (const { section, value } of textFields) {
    if (value && pendingPattern.test(value)) {
      issues.push({
        section,
        rule: "no_pending",
        severity: "error",
        message: `"Pending" placeholder in ${section} — must be resolved for committee`,
      });
    }
  }

  // Rule 2: No empty recommendation in committee mode
  if (memo.recommendation?.verdict === "pending") {
    issues.push({
      section: "recommendation",
      rule: "no_pending_verdict",
      severity: "error",
      message: "Recommendation verdict is 'pending' — underwriting must complete",
    });
  }

  // Rule 3: No empty strengths with approve recommendation
  if (
    memo.recommendation?.verdict === "approve" &&
    (!memo.strengths_weaknesses?.strengths || memo.strengths_weaknesses.strengths.length === 0)
  ) {
    issues.push({
      section: "strengths_weaknesses",
      rule: "approve_needs_strengths",
      severity: "error",
      message: "Approval recommendation requires at least one strength",
    });
  }

  // Rule 4: Borrower name must not be empty
  if (!memo.header?.borrower_name || memo.header.borrower_name.trim().length < 2) {
    issues.push({
      section: "header",
      rule: "borrower_name_required",
      severity: "error",
      message: "Borrower name is missing or malformed",
    });
  }

  // Rule 5: Certification must be present for committee
  if (!memo.certification) {
    issues.push({
      section: "certification",
      rule: "certification_required",
      severity: "warning",
      message: "Committee certification status not computed",
    });
  } else if (!memo.certification.isCommitteeEligible) {
    issues.push({
      section: "certification",
      rule: "not_committee_eligible",
      severity: "warning",
      message: `Memo not committee-eligible: ${memo.certification.blockers.join("; ")}`,
    });
  }

  // Rule 6: Key metrics must have values (not null)
  if (memo.key_metrics?.loan_amount?.value === null) {
    issues.push({
      section: "key_metrics",
      rule: "loan_amount_required",
      severity: "error",
      message: "Loan amount is missing",
    });
  }

  const errorCount = issues.filter((i) => i.severity === "error").length;
  const warningCount = issues.filter((i) => i.severity === "warning").length;

  return {
    passed: errorCount === 0,
    issues,
    errorCount,
    warningCount,
  };
}
