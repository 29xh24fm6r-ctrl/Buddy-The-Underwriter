// Florida Armory Memo Snapshot — banker-submitted institutional memo.
//
// 20-section schema aligned with the existing Florida Armory canonical
// memo standard. The snapshot is the frozen, system-of-record artifact
// that the underwriter sees — built once at banker submission, never
// mutated thereafter.

import type { CanonicalCreditMemoV1 } from "@/lib/creditMemo/canonical/types";
import type { MemoReadinessContract } from "@/lib/creditMemo/submission/evaluateMemoReadinessContract";

export type FloridaArmorySectionKey =
  | "readiness"
  | "header"
  | "financing_request"
  | "deal_summary"
  | "sources_and_uses"
  | "collateral"
  | "eligibility"
  | "business_industry_analysis"
  | "management_qualifications"
  | "debt_coverage"
  | "new_debt"
  | "global_cash_flow"
  | "income_statement"
  | "repayment_breakeven"
  | "personal_financial_statements"
  | "strengths_weaknesses"
  | "policy_exceptions"
  | "proposed_terms"
  | "conditions"
  | "recommendation_approval";

export const FLORIDA_ARMORY_SECTION_KEYS: readonly FloridaArmorySectionKey[] = [
  "readiness",
  "header",
  "financing_request",
  "deal_summary",
  "sources_and_uses",
  "collateral",
  "eligibility",
  "business_industry_analysis",
  "management_qualifications",
  "debt_coverage",
  "new_debt",
  "global_cash_flow",
  "income_statement",
  "repayment_breakeven",
  "personal_financial_statements",
  "strengths_weaknesses",
  "policy_exceptions",
  "proposed_terms",
  "conditions",
  "recommendation_approval",
] as const;

export type FloridaArmorySource = {
  source_type: "document" | "financial_fact" | "research" | "override" | "system";
  source_id: string | null;
  label: string;
  section_keys: FloridaArmorySectionKey[];
  confidence: number | null;
  metadata?: Record<string, unknown>;
};

export type FloridaArmorySection = {
  key: FloridaArmorySectionKey;
  title: string;
  narrative: string;
  data: Record<string, unknown>;
  tables: Array<{
    key: string;
    title: string;
    columns: string[];
    rows: Array<Record<string, unknown>>;
  }>;
  citations: FloridaArmorySource[];
  warnings: string[];
};

export type FloridaArmoryMemoSnapshot = {
  schema_version: "florida_armory_v1";
  meta: {
    deal_id: string;
    bank_id: string;
    snapshot_id?: string;
    generated_at: string;
    generated_by: "buddy";
    submitted_by: string;
    submitted_at: string;
    submission_role: "banker";
    memo_version: number;
    input_hash: string;
    render_mode: "committee";
  };
  banker_submission: {
    certification: true;
    submitted_by: string;
    submitted_at: string;
    reviewed_sections: FloridaArmorySectionKey[];
    notes: string | null;
    qualitative_overrides: Record<string, unknown>;
    covenant_decisions: unknown[];
    acknowledged_exceptions: unknown[];
  };
  sections: Record<FloridaArmorySectionKey, FloridaArmorySection>;
  sources: FloridaArmorySource[];
  diagnostics: {
    readiness_contract: MemoReadinessContract;
    source_coverage: {
      document_sources: number;
      financial_fact_sources: number;
      research_sources: number;
      override_sources: number;
    };
    warnings: string[];
  };
  canonical_memo: CanonicalCreditMemoV1;
};

// Build error preserved for callers that still reference it.
export class FloridaArmoryBuildError extends Error {
  code: string;
  missingFields: string[];
  constructor(code: string, missingFields: string[], message?: string) {
    super(
      message ??
        `Memo cannot be generated: ${code}${
          missingFields.length > 0 ? ` (missing: ${missingFields.join(", ")})` : ""
        }`,
    );
    this.name = "FloridaArmoryBuildError";
    this.code = code;
    this.missingFields = missingFields;
  }
}
