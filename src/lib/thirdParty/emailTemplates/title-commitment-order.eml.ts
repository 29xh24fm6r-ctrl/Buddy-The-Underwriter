export type TitleCommitmentOrderArgs = {
  vendorName: string;
  businessLegalName: string;
  propertyAddress: string;
  dealReferenceId: string;
};

export function buildTitleCommitmentOrderEmail(args: TitleCommitmentOrderArgs): { subject: string; body: string } {
  return {
    subject: `Title Commitment Order — ${args.businessLegalName}`,
    body: [
      `${args.vendorName},`,
      ``,
      `We'd like to order a title commitment for the property below in connection with an SBA loan application.`,
      ``,
      `Borrower: ${args.businessLegalName}`,
      `Property address: ${args.propertyAddress}`,
      `Reference: ${args.dealReferenceId}`,
      ``,
      `Please confirm receipt and expected turnaround. Reply directly to this email with any questions.`,
    ].join("\n"),
  };
}
