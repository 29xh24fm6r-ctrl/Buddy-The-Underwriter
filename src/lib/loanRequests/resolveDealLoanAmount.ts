/**
 * SPEC-JOURNEY-RAIL-UNDERWRITING-FLOW-PRIORITY-1 — resolve the deal's headline "Loan" amount.
 *
 * The top deal header shows `deals.amount`. When that column is null (common before a banker fills it
 * in), fall back to the active submitted loan request amount so the header reflects what the borrower
 * actually asked for. Pure: no IO. Never writes anything, never touches legacy loan_requests.
 */

export type LoanRequestAmountRow = {
  status?: string | null;
  requested_amount?: number | null;
  request_number?: number | null;
};

/**
 * Resolve the headline loan amount: the deal amount when present, otherwise the latest active submitted
 * loan request's requested_amount (status != draft, amount > 0; highest request_number wins). Returns
 * null when neither is available.
 */
export function resolveDealLoanAmount(
  dealAmount: number | null | undefined,
  loanRequests: LoanRequestAmountRow[] | null | undefined,
): number | null {
  if (dealAmount != null && Number.isFinite(Number(dealAmount))) {
    return Number(dealAmount);
  }

  const candidates = (loanRequests ?? []).filter(
    (r) =>
      r != null &&
      r.status !== "draft" &&
      r.requested_amount != null &&
      Number.isFinite(Number(r.requested_amount)) &&
      Number(r.requested_amount) > 0,
  );
  if (candidates.length === 0) return null;

  // Prefer the latest submitted request (highest request_number) — the borrower's current ask.
  candidates.sort((a, b) => Number(b.request_number ?? 0) - Number(a.request_number ?? 0));
  return Number(candidates[0].requested_amount);
}
