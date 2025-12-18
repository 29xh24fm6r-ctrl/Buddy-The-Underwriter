export type SopReference = {
  code: string;
  title: string;
  citation: string;
  url?: string;
};

export const SOP_REFS: Record<string, SopReference> = {
  FEDERAL_DEBT_DELINQUENT: {
    code: "FEDERAL_DEBT_DELINQUENT",
    title: "Federal debt delinquency",
    citation: "SOP 50 10 7.1, Subpart B, Chapter 2",
    url: "https://www.sba.gov/document/sop-50-10"
  },

  INELIGIBLE_BUSINESS: {
    code: "INELIGIBLE_BUSINESS",
    title: "Ineligible business types",
    citation: "SOP 50 10 7.1, Subpart A, Chapter 3"
  },

  CRIMINAL_HISTORY_FLAG: {
    code: "CRIMINAL_HISTORY_FLAG",
    title: "Criminal history review",
    citation: "SOP 50 10 7.1, Subpart B, Chapter 2"
  },

  MISSING_REQUIRED_DOCS: {
    code: "MISSING_REQUIRED_DOCS",
    title: "Required SBA documentation",
    citation: "SOP 50 10 7.1, Subpart B, Chapter 4"
  },

  BUSINESS_NAME_MISMATCH: {
    code: "BUSINESS_NAME_MISMATCH",
    title: "Consistency of borrower information",
    citation: "SOP 50 10 7.1, Subpart B, Chapter 5"
  }
};
