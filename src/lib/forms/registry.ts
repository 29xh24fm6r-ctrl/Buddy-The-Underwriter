export type PdfField = {
  pdf: string;
  path: string;
  transform?: "YES_NO" | "CURRENCY";
};

export const SBA_INTAKE_FORM = {
  name: "OGB_SBA_INTAKE_V1",
  version: "v1",
  fields: [
    { pdf: "BusinessLegalName", path: "business.legal_name" },
    { pdf: "EIN", path: "business.ein" },
    { pdf: "NAICS", path: "business.naics" },
    { pdf: "Industry", path: "business.industry" },
    { pdf: "LoanAmount", path: "loan.amount", transform: "CURRENCY" },
    { pdf: "UseOfProceeds", path: "loan.use_of_proceeds_primary" },
    { pdf: "WantSBA", path: "sba_gate.want_sba", transform: "YES_NO" },
    { pdf: "IneligibleBusiness", path: "sba_gate.ineligible_business", transform: "YES_NO" },
    { pdf: "FederalDebt", path: "sba_gate.federal_debt_delinquent", transform: "YES_NO" },
    { pdf: "OwnersUSEligible", path: "sba_gate.owners_us_eligible", transform: "YES_NO" },
    { pdf: "CriminalHistory", path: "sba_gate.criminal_history", transform: "YES_NO" },
    { pdf: "ProhibitedProceeds", path: "sba_gate.proceeds_prohibited", transform: "YES_NO" },
    { pdf: "ExceedsSizeStandard", path: "sba_gate.exceeds_size_standard", transform: "YES_NO" },
  ]
};

// Legacy registry for backwards compatibility
export type PdfFieldMap = {
  pdf_field: string;
  path: string;
  transform?: "YES_NO" | "CURRENCY" | "DATE";
};

export type FormDefinition = {
  form_name: string;
  display_name?: string;
  source?: "SBA" | "BANK";
  version: string;
  fields: PdfFieldMap[];
};

export const FORM_REGISTRY: FormDefinition[] = [
  {
    form_name: "OGB_SBA_INTAKE_V1",
    display_name: "SBA Intake (Internal)",
    source: "BANK",
    version: "v1",
    fields: SBA_INTAKE_FORM.fields.map(f => ({
      pdf_field: f.pdf,
      path: f.path,
      transform: f.transform as any,
    })),
  },
];
