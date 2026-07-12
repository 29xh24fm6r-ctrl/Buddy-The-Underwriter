export type UccSearchOrderArgs = {
  vendorName: string;
  businessLegalName: string;
  stateOfFormation: string | null;
  dealReferenceId: string;
};

export function buildUccSearchOrderEmail(args: UccSearchOrderArgs): { subject: string; body: string } {
  return {
    subject: `UCC Lien Search Order — ${args.businessLegalName}`,
    body: [
      `${args.vendorName},`,
      ``,
      `We'd like to order a UCC lien search in connection with an SBA loan application.`,
      ``,
      `Borrower: ${args.businessLegalName}`,
      `State of formation: ${args.stateOfFormation ?? "unknown"}`,
      `Reference: ${args.dealReferenceId}`,
      ``,
      `Please confirm receipt and expected turnaround. Reply directly to this email with any questions.`,
    ].join("\n"),
  };
}
