// src/types/intake.ts
// Phase 85A — Shared types for borrower intake flow
// Phase 85A.2 — Extended from 4-step to 5-step (added Owners as step 3)

export const ENTITY_TYPES = [
  "LLC",
  "Corporation",
  "S-Corporation",
  "Partnership",
  "Sole Proprietorship",
] as const;

export type EntityType = (typeof ENTITY_TYPES)[number];

export const LOAN_TYPES = ["SBA", "CRE", "C&I", "LOC"] as const;
export type LoanType = (typeof LOAN_TYPES)[number];

export const SBA_TYPES = ["SBA", "sba_7a", "sba_504", "sba_express"] as const;

export type IntakeBusinessData = {
  legal_name: string;
  dba: string;
  ein: string;
  entity_type: EntityType | "";
  naics_code: string;
  industry_description: string;
};

export type IntakeAddressData = {
  address_line1: string;
  city: string;
  state: string;
  zip: string;
  state_of_formation: string;
};

export type IntakeOwnerData = {
  id: string;           // client-generated UUID for keying
  full_name: string;
  title: string;
  ownership_pct: string; // stored as string for form input, parsed on save
  ssn_last4: string;
  years_in_industry: string;
};

export type IntakeLoanData = {
  purpose: string;
  amount: string;
  type: LoanType | "";
};

/**
 * SBA-required federal-compliance / character / affiliates disclosures
 * (mirror the questions on SBA Forms 1919 and 912). Stored per-answer as
 * "yes" | "no" | "" (unanswered) client-side; converted to booleans on
 * save. See src/lib/score/eligibility/evaluate.ts for how these feed the
 * eligibility engine.
 */
export type IntakeComplianceAnswer = "yes" | "no" | "";

export type IntakeComplianceData = {
  federal_debt_delinquent: IntakeComplianceAnswer;
  tax_delinquent: IntakeComplianceAnswer;
  sam_debarred: IntakeComplianceAnswer;
  felony_conviction: IntakeComplianceAnswer;
  incarcerated_or_parole: IntakeComplianceAnswer;
  prior_gov_loan_default: IntakeComplianceAnswer;
  has_affiliates: IntakeComplianceAnswer;
};

export type IntakeStep = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

export type IntakeStepKey =
  | "business"
  | "address"
  | "owners"
  | "loan"
  | "compliance"
  | "projections"
  | "submit";

export type IntakeStepContent =
  | "business"
  | "address"
  | "owners"
  | "loan"
  | "compliance"
  | "projections"
  | "documents"
  | "review";

export type IntakeSaveRequest = {
  step: IntakeStepKey;
  data: Record<string, unknown>;
};

export type IntakeSaveResponse =
  | { ok: true; submissionId?: string }
  | { ok: false; error: string };
