import type { CanonicalCreditMemoV1 } from "./types";

/** Review needs from structured evidence, not guesses about generated prose. */
export function memoEvidenceReview(memo: CanonicalCreditMemoV1) {
  const findings: string[] = [];
  if (!memo.transaction_overview.loan_request.term_months) findings.push("Loan term is missing.");
  if (!memo.key_metrics.rate_summary || memo.key_metrics.rate_summary === "—") findings.push("Loan rate or modeled rate assumption is missing.");
  else if (memo.key_metrics.rate_summary.includes("lender pricing pending")) findings.push("Borrower-confirmed rate is a projection assumption; lender pricing remains pending.");
  const principals = memo.management_qualifications?.principals ?? [];
  if (!principals.length || principals.some(p => !p.bio || p.bio.startsWith("Pending"))) findings.push("Management qualifications need completion or verification.");
  const cashFlow = memo.financial_analysis.cash_flow_available.value;
  const historical = memo.financial_analysis.debt_coverage_table;
  if (typeof cashFlow === "number" && historical.some(row => typeof row.cash_flow_available === "number" && Math.abs(row.cash_flow_available - cashFlow) > 1)) {
    findings.push("Historical and underwriting cash-flow bases differ. Underwriter must verify the adjustment bridge before relying on underwriting repayment capacity.");
  }
  if (memo.financial_analysis.dscr?.preliminary) findings.push("Coverage is preliminary; resolve its stated caveat before lender reliance.");
  return { version: 1, findings };
}
