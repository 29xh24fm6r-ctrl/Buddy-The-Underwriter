// src/types/intake.ts
// Phase 85A — Shared types for borrower intake flow

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

export type IntakeLoanData = {
  purpose: string;
  amount: string;
  type: LoanType | "";
};

export type IntakeStep = 1 | 2 | 3 | 4;

export type IntakeStepKey = "business" | "address" | "loan" | "submit";

export type IntakeSaveRequest = {
  step: IntakeStepKey;
  data: Record<string, unknown>;
};

export type IntakeSaveResponse =
  | { ok: true; submissionId?: string }
  | { ok: false; error: string };
