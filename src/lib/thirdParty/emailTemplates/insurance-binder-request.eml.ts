export type InsuranceBinderRequestArgs = {
  vendorName: string;
  businessLegalName: string;
  insuranceType: "hazard_insurance" | "life_insurance";
  loanAmount: number;
  dealReferenceId: string;
};

export function buildInsuranceBinderRequestEmail(args: InsuranceBinderRequestArgs): { subject: string; body: string } {
  const label = args.insuranceType === "hazard_insurance" ? "hazard insurance" : "life insurance";
  return {
    subject: `${label === "hazard insurance" ? "Hazard" : "Life"} Insurance Binder Request — ${args.businessLegalName}`,
    body: [
      `${args.vendorName},`,
      ``,
      `We'd like to request a ${label} binder in connection with an SBA loan application.`,
      ``,
      `Borrower: ${args.businessLegalName}`,
      `Loan amount: $${args.loanAmount.toLocaleString()}`,
      `Reference: ${args.dealReferenceId}`,
      ``,
      `Please confirm receipt and expected turnaround. Reply directly to this email with any questions.`,
    ].join("\n"),
  };
}
