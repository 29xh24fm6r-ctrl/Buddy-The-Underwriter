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

/** Borrowers review their application documents; internal underwriting stays with authorized lenders. */
export const BORROWER_PACKAGE_FILES = LENDER_PACKAGE_FILES.filter(
  (file) => file.kind !== "credit_memo",
);
export function canBorrowerDownload(kind: string) {
  return kind !== "credit_memo";
}
export function packageFilesForActor(actor: "borrower" | "lender") {
  return actor === "borrower" ? BORROWER_PACKAGE_FILES : LENDER_PACKAGE_FILES;
}

/** The public status contract contains booleans, never private storage paths. */
export function hasCompletePackageFiles(files: unknown): boolean {
  return Array.isArray(files) && LENDER_PACKAGE_FILES.every(file =>
    files.some(item => item?.key === file.column && item.ready === true));
}
