export type ValuationOrderArgs = {
  vendorName: string;
  businessLegalName: string;
  loanAmount: number;
  dealReferenceId: string;
};

export function buildValuationOrderEmail(args: ValuationOrderArgs): { subject: string; body: string } {
  return {
    subject: `Business Valuation Order — ${args.businessLegalName}`,
    body: [
      `${args.vendorName},`,
      ``,
      `We'd like to order a business valuation in connection with an SBA acquisition loan application.`,
      ``,
      `Business being acquired: ${args.businessLegalName}`,
      `Loan amount: $${args.loanAmount.toLocaleString()}`,
      `Reference: ${args.dealReferenceId}`,
      ``,
      `Please confirm receipt and expected turnaround. Reply directly to this email with any questions.`,
    ].join("\n"),
  };
}
