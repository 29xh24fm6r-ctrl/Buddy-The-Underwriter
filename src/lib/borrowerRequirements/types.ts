export type RequirementStatus = "SATISFIED" | "MISSING" | "PARTIAL" | "OPTIONAL";

export type BorrowerRequirement = {
  id: string;                 // stable id
  title: string;              // borrower-friendly
  description?: string;
  status: RequirementStatus;
  required: boolean;

  // "what satisfies it" (kept simple and deterministic)
  doc_types?: string[];       // expected doc types
  year?: number;              // if year-specific

  evidence?: {
    file_key: string;
    stored_name?: string;
    doc_type?: string;
    tax_year?: number | null;
    confidence?: number | null;
  }[];

  notes?: string[];
};

export type BorrowerRequirementsSummary = {
  required_total: number;
  required_satisfied: number;
  required_missing: number;
  required_partial: number;
  optional_total: number;
  optional_satisfied: number;
};

export type BorrowerRequirementsResult = {
  track: "SBA_7A" | "CONVENTIONAL";
  requirements: BorrowerRequirement[];
  summary: BorrowerRequirementsSummary;
  derived_tax_years: number[];
};
