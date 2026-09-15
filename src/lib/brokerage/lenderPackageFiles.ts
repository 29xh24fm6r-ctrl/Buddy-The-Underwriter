/** The documents delivered from one completed run of the existing factory. */
export const LENDER_PACKAGE_FILES = [
  {
    kind: "business_plan",
    column: "business_plan_pdf_path",
    label: "Business plan",
    filename: "01-business-plan.pdf",
  },
  {
    kind: "projections_xlsx",
    column: "projections_xlsx_path",
    label: "Projections and assumptions",
    filename: "02-projections-and-assumptions.xlsx",
  },
  {
    kind: "feasibility",
    column: "feasibility_pdf_path",
    label: "Feasibility study",
    filename: "03-feasibility-study.pdf",
  },
  {
    kind: "spreads",
    column: "spreads_pdf_path",
    label: "Financial spreads",
    filename: "04-financial-spreads.pdf",
  },
  {
    kind: "credit_memo",
    column: "credit_memo_pdf_path",
    label: "Credit memo for lender review",
    filename: "05-credit-memo.pdf",
  },
  {
    kind: "sba_forms",
    column: "sba_forms_pdf_path",
    label: "Applicable SBA forms",
    filename: "06-sba-forms.pdf",
  },
] as const;
