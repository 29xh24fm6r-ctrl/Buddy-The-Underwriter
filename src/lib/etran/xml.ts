// Canonical E-Tran XML Builder
// Spec: SBA E-Tran XML v5.0 format

export function buildEtranXml(input: any) {
  const business = input.business || {};
  const loan = input.loan || {};
  const sbaGate = input.sba_gate || {};

  // Clean EIN to digits only
  const ein = (business.ein || "").replace(/[^0-9]/g, "");

  return `<?xml version="1.0" encoding="UTF-8"?>
<ETranSubmission xmlns="http://www.sba.gov/etran/v5">
  <ApplicationHeader>
    <SubmissionDate>${new Date().toISOString()}</SubmissionDate>
    <LenderID>${process.env.SBA_LENDER_ID || "UNKNOWN"}</LenderID>
    <Program>7A</Program>
  </ApplicationHeader>
  
  <BusinessInformation>
    <LegalName>${escapeXml(business.legal_name || "")}</LegalName>
    <EIN>${ein}</EIN>
    <NAICS>${business.naics || ""}</NAICS>
    <Industry>${escapeXml(business.industry || "")}</Industry>
  </BusinessInformation>
  
  <LoanRequest>
    <Amount>${loan.amount || 0}</Amount>
    <UseOfProceeds>${escapeXml(loan.use_of_proceeds_primary || "")}</UseOfProceeds>
    <Program>7A</Program>
  </LoanRequest>
  
  <EligibilityAttestation>
    <WantSBA>${sbaGate.want_sba === true ? "true" : "false"}</WantSBA>
    <NotIneligibleBusiness>${sbaGate.ineligible_business === false ? "true" : "false"}</NotIneligibleBusiness>
    <NoFederalDebt>${sbaGate.federal_debt_delinquent === false ? "true" : "false"}</NoFederalDebt>
    <OwnersUSEligible>${sbaGate.owners_us_eligible === true ? "true" : "false"}</OwnersUSEligible>
    <NoCriminalHistory>${sbaGate.criminal_history === false ? "true" : "false"}</NoCriminalHistory>
    <ProhibitedProceeds>${sbaGate.proceeds_prohibited === false ? "true" : "false"}</ProhibitedProceeds>
    <WithinSizeStandard>${sbaGate.exceeds_size_standard === false ? "true" : "false"}</WithinSizeStandard>
  </EligibilityAttestation>
</ETranSubmission>`;
}

function escapeXml(str: string): string {
  if (!str) return "";
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
