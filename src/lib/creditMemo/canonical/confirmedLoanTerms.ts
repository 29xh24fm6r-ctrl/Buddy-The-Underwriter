/** Confirmed modeling terms supplement, but never silently replace, lender/request terms. */
export function confirmedLoanTerms(args: {
  status?: string; loanImpact?: { termMonths?: unknown; interestRate?: unknown } | null;
  requestedTerm?: number | null; pricedRatePct?: number | null;
}) {
  if (args.status !== "confirmed") return { termMonths: null, ratePct: null };
  const term = args.loanImpact?.termMonths;
  const rate = args.loanImpact?.interestRate;
  const termMonths = typeof term === "number" && Number.isInteger(term) && term > 0 ? term : null;
  const ratePct = typeof rate === "number" && Number.isFinite(rate) && rate >= 0 && rate <= 1 ? rate * 100 : null;
  if (args.requestedTerm != null && termMonths != null && Number(args.requestedTerm) !== termMonths) {
    throw new Error("Loan term conflict: review the request and confirmed projection assumptions before generating the memo.");
  }
  if (args.pricedRatePct != null && ratePct != null && Math.abs(Number(args.pricedRatePct) - ratePct) > 0.005) {
    throw new Error("Loan rate conflict: review lender pricing and confirmed projection assumptions before generating the memo.");
  }
  return { termMonths, ratePct };
}
