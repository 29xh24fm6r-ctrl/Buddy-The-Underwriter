// Pure types. No DB. No side effects.

export type LoanType =
  | "term"
  | "revolver"
  | "line_of_credit"
  | "equipment"
  | "commercial_real_estate"
  | "sba_7a"
  | "sba_504"
  | "bridge"
  | "construction"
  | "other";

export type CollateralType =
  | "real_estate"
  | "accounts_receivable"
  | "inventory"
  | "equipment"
  | "mixed"
  | "unsecured"
  | "other";

export type FacilityPurpose =
  | "acquisition"
  | "refinance"
  | "working_capital"
  | "equipment_purchase"
  | "owner_occupied_real_estate"
  | "investment_real_estate"
  | "partner_buyout"
  | "debt_refinance"
  | "construction"
  | "sba"
  | "other";

export type LoanRequestStatus = "missing" | "draft" | "complete";

export type LoanRequest = {
  id: string;
  dealId: string;
  requestName: string | null;
  loanAmount: number | null;
  loanPurpose: string | null;
  loanType: string | null;
  collateralType: string | null;
  collateralDescription: string | null;
  termMonths: number | null;
  amortizationMonths: number | null;
  interestType: string | null;
  rateIndex: string | null;
  repaymentType: string | null;
  facilityPurpose: string | null;
  occupancyType: string | null;
  recourseType: string | null;
  guarantorRequired: boolean;
  guarantorNotes: string | null;
  requestedCloseDate: string | null;
  useOfProceedsJson: Record<string, unknown> | null;
  covenantNotes: string | null;
  structureNotes: string | null;
  source: string;
  createdBy: string;
  updatedBy: string;
};

export type ReviewItemType =
  | "confirm_match"
  | "reclassify_document"
  | "assign_requirement"
  | "resolve_subject"
  | "resolve_period"
  | "unmatched_document"
  | "rejected_document_review";

export type NextBestActionCode =
  | "add_loan_request"
  | "complete_loan_request"
  | "review_documents"
  | "upload_missing_documents"
  | "open_underwriting";
