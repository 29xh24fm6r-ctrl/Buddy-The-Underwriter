// src/lib/packs/requirements/types.ts

export type RequirementStatus = "SATISFIED" | "MISSING" | "PARTIAL" | "OPTIONAL";

export type RequirementEvidence = {
  doc_id: string;
  doc_type: string;
  title?: string;
  tax_year?: number | null;
  confidence?: number | null;
};

export type RequirementRule =
  | { rule: "DOC_TYPE_MIN_COUNT"; docType: string; minCount: number }
  | { rule: "DOC_TYPE_PER_YEAR"; docType: string; years: number[]; minPerYear?: number }
  | { rule: "ANY_OF"; anyOf: RequirementRule[] }
  | { rule: "ALL_OF"; allOf: RequirementRule[] };

export type PackRequirement = {
  id: string;
  label: string;
  category: "BORROWER" | "BUSINESS" | "TAX" | "COLLATERAL" | "BANKING" | "OTHER";
  required: boolean; // if false => OPTIONAL bucket
  rule: RequirementRule;
  notes?: string;
};

export type RequirementResult = {
  requirement: PackRequirement;
  status: RequirementStatus;
  satisfiedCount: number;
  missingCount: number;
  evidence: RequirementEvidence[];
  message: string;
};

export type CoverageSummary = {
  satisfied: number;
  missing: number;
  partial: number;
  optional: number;
  totalRequired: number;
};