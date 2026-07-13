export type AppraisalOrderArgs = {
  vendorName: string;
  businessLegalName: string;
  propertyAddress: string;
  loanAmount: number;
  dealReferenceId: string;
};

export function buildAppraisalOrderEmail(args: AppraisalOrderArgs): { subject: string; body: string } {
  return {
    subject: `Real Estate Appraisal Order — ${args.businessLegalName}`,
    body: [
      `${args.vendorName},`,
      ``,
      `We'd like to order a real estate appraisal for the property below in connection with an SBA loan application.`,
      ``,
      `Borrower: ${args.businessLegalName}`,
      `Property address: ${args.propertyAddress}`,
      `Loan amount: $${args.loanAmount.toLocaleString()}`,
      `Reference: ${args.dealReferenceId}`,
      ``,
      `Please confirm receipt and expected turnaround. Reply directly to this email with any questions.`,
    ].join("\n"),
  };
}
