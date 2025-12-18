export type NarrativeSection = {
  id: string;
  title: string;
  required: boolean;
};

export const NARRATIVE_SECTIONS: NarrativeSection[] = [
  { id: "EXEC_SUMMARY", title: "Executive Summary", required: true },
  { id: "BUSINESS_OVERVIEW", title: "Business Overview", required: true },
  { id: "LOAN_REQUEST", title: "Loan Request & Structure", required: true },
  { id: "SBA_ELIGIBILITY", title: "SBA Eligibility Analysis", required: true },
  { id: "COLLATERAL", title: "Collateral & Security", required: false },
  { id: "FINANCIAL_ANALYSIS", title: "Financial Analysis", required: true },
  { id: "RISKS", title: "Key Risks & Mitigants", required: true },
  { id: "RECOMMENDATION", title: "Recommendation", required: true },
];
