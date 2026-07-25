import {
  LOAN_AUTHORIZATION_FIELDS,
  missingRequiredFields,
  STANDARD_CONDITIONS_PRECEDENT,
  STANDARD_AFFIRMATIVE_COVENANTS,
  STANDARD_NEGATIVE_COVENANTS,
  STANDARD_CONDITIONS_SUBSEQUENT,
} from "@/lib/sba/forms/loanAuthorization/fields";

export type DealCovenant = { metric: string; threshold: string; testing_frequency: string };

export type LoanAuthorizationInput = {
  borrower_legal_name: string | null;
  lender_name: string | null;
  principal_amount: number | null;
  interest_rate_pct: number | null;
  rate_type: "fixed" | "variable" | null;
  term_months: number | null;
  use_of_proceeds_summary: string | null;
  collateral_summary: string[];
  guarantors: Array<{ name: string; type: string | null }>;
  deal_covenants: DealCovenant[];
  conditions_precedent: string[];
  affirmative_covenants: string[];
  negative_covenants: string[];
  conditions_subsequent: string[];
};

export type LoanAuthorizationSignatureStatus = {
  has_valid_signature: boolean;
  signed_at: string | null;
  expires_at: string | null;
  needs_resignature: boolean;
};

export type LoanAuthorizationLegalReviewStatus = {
  approved: boolean;
  reviewed_by: string | null;
  reviewed_at: string | null;
};

export type LoanAuthorizationBuildResult = {
  form: "loan_authorization";
  input: LoanAuthorizationInput;
  missing: string[];
  is_complete: boolean;
  borrower_ownership_entity_id: string | null;
  signature: LoanAuthorizationSignatureStatus;
  legal_review: LoanAuthorizationLegalReviewStatus;
};

export function buildLoanAuthorization(input: {
  fields: Omit<LoanAuthorizationInput, "conditions_precedent" | "affirmative_covenants" | "negative_covenants" | "conditions_subsequent">;
  borrowerOwnershipEntityId: string | null;
}): LoanAuthorizationBuildResult {
  const authInput: LoanAuthorizationInput = {
    ...input.fields,
    conditions_precedent: STANDARD_CONDITIONS_PRECEDENT,
    affirmative_covenants: STANDARD_AFFIRMATIVE_COVENANTS,
    negative_covenants: STANDARD_NEGATIVE_COVENANTS,
    conditions_subsequent: STANDARD_CONDITIONS_SUBSEQUENT,
  };

  const missing = missingRequiredFields(LOAN_AUTHORIZATION_FIELDS, authInput as unknown as Record<string, unknown>);

  return {
    form: "loan_authorization",
    input: authInput,
    missing,
    is_complete: missing.length === 0 && input.borrowerOwnershipEntityId != null,
    borrower_ownership_entity_id: input.borrowerOwnershipEntityId,
    signature: { has_valid_signature: false, signed_at: null, expires_at: null, needs_resignature: false },
    legal_review: { approved: false, reviewed_by: null, reviewed_at: null },
  };
}
