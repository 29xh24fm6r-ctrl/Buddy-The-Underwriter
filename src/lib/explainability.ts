export function explainDecision(decision: any) {
  return {
    summary: "Loan is conditionally approvable",
    drivers: [
      "Strong revenue",
      "Missing IRS transcript"
    ],
    sop_citations: decision.sop_citations ?? []
  };
}
