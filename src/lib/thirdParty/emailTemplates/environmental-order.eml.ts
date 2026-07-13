export type EnvironmentalOrderArgs = {
  vendorName: string;
  businessLegalName: string;
  propertyAddress: string;
  naicsCode: string | null;
  dealReferenceId: string;
};

export function buildEnvironmentalOrderEmail(args: EnvironmentalOrderArgs): { subject: string; body: string } {
  return {
    subject: `Phase I Environmental Assessment Order — ${args.businessLegalName}`,
    body: [
      `${args.vendorName},`,
      ``,
      `We'd like to order a Phase I Environmental Site Assessment for the property below in connection with an SBA loan application (NAICS code ${args.naicsCode ?? "unknown"} triggers this requirement per SOP 50 10 8 Appendix 6).`,
      ``,
      `Borrower: ${args.businessLegalName}`,
      `Property address: ${args.propertyAddress}`,
      `Reference: ${args.dealReferenceId}`,
      ``,
      `Please confirm receipt and expected turnaround. Reply directly to this email with any questions.`,
    ].join("\n"),
  };
}
