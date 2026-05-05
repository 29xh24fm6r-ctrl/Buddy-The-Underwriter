// Florida Armory section builders.
//
// Each builder returns a FloridaArmorySection populated from the canonical
// credit memo. Missing values produce warnings rather than throws — the
// readiness contract is the gate, not these builders.

import type { CanonicalCreditMemoV1 } from "@/lib/creditMemo/canonical/types";
import type {
  FloridaArmorySection,
  FloridaArmorySectionKey,
  FloridaArmorySource,
} from "./types";

type SectionInput = {
  memo: CanonicalCreditMemoV1;
  sources: FloridaArmorySource[];
};

const pickSources = (
  sources: FloridaArmorySource[],
  key: FloridaArmorySectionKey,
): FloridaArmorySource[] => sources.filter((source) => source.section_keys.includes(key));

const section = (
  key: FloridaArmorySectionKey,
  title: string,
  narrative: string,
  data: Record<string, unknown>,
  tables: FloridaArmorySection["tables"],
  sources: FloridaArmorySource[],
  warnings: string[] = [],
): FloridaArmorySection => ({
  key,
  title,
  narrative,
  data,
  tables,
  citations: pickSources(sources, key),
  warnings,
});

const requireValue = (value: unknown, label: string, warnings: string[]) => {
  if (value === null || value === undefined || value === "") warnings.push(`${label} missing`);
  return value;
};

export function buildReadinessSection(input: SectionInput): FloridaArmorySection {
  // memo.meta.readiness in the canonical type; older callers may pass
  // a memo with a top-level readiness slot.
  const readiness =
    (input.memo as any).readiness ??
    (input.memo as any).meta?.readiness ??
    null;
  return section(
    "readiness",
    "Readiness & Data Coverage",
    "Buddy validated the memo submission package against the banker submission readiness contract.",
    { readiness },
    [],
    input.sources,
  );
}

export function buildHeaderSection(input: SectionInput): FloridaArmorySection {
  const warnings: string[] = [];
  const header = input.memo.header ?? {};
  requireValue((header as any).borrower_name, "Borrower name", warnings);

  return section(
    "header",
    "Header",
    "Credit memorandum header and borrower identification.",
    { header },
    [],
    input.sources,
    warnings,
  );
}

export function buildFinancingRequestSection(input: SectionInput): FloridaArmorySection {
  const warnings: string[] = [];
  const keyMetrics = input.memo.key_metrics ?? {};
  requireValue((keyMetrics as any).loan_amount, "Loan amount", warnings);

  return section(
    "financing_request",
    "Financing Request",
    "Requested credit facility, rate, term, payment, SBA program, and guaranty details.",
    { key_metrics: keyMetrics },
    [],
    input.sources,
    warnings,
  );
}

export function buildDealSummarySection(input: SectionInput): FloridaArmorySection {
  return section(
    "deal_summary",
    "Deal Summary / Purpose",
    "Summary of borrower request, transaction purpose, and credit action.",
    {
      deal_summary: (input.memo as any).deal_summary ?? null,
      purpose: (input.memo as any).purpose ?? null,
      transaction_overview: (input.memo as any).transaction_overview ?? null,
    },
    [],
    input.sources,
  );
}

export function buildSourcesAndUsesSection(input: SectionInput): FloridaArmorySection {
  // Canonical memo uses "sources_uses" (no "and"); spec uses "sources_and_uses".
  const su = (input.memo as any).sources_and_uses ?? (input.memo as any).sources_uses ?? null;
  const rows = ((su as any)?.rows ?? []) as Array<Record<string, unknown>>;

  return section(
    "sources_and_uses",
    "Sources & Uses",
    "Sources and uses of funds for the proposed transaction.",
    { sources_and_uses: su },
    [{
      key: "sources_and_uses",
      title: "Sources & Uses",
      columns: ["use", "bank_loan", "equity", "total"],
      rows,
    }],
    input.sources,
  );
}

export function buildCollateralSection(input: SectionInput): FloridaArmorySection {
  const collateral = input.memo.collateral ?? {};
  const rows = ((collateral as any).line_items ?? []) as Array<Record<string, unknown>>;

  return section(
    "collateral",
    "Collateral Analysis",
    "Collateral support, lien position, advance rates, and discounted collateral coverage.",
    { collateral },
    [{
      key: "collateral_line_items",
      title: "Collateral Analysis",
      columns: ["description", "market_value", "advance_rate", "discounted_value", "lien_position"],
      rows,
    }],
    input.sources,
  );
}

export function buildEligibilitySection(input: SectionInput): FloridaArmorySection {
  return section(
    "eligibility",
    "Eligibility",
    "SBA eligibility, NAICS, size standard, and related eligibility observations.",
    { eligibility: input.memo.eligibility ?? null },
    [],
    input.sources,
  );
}

export function buildBusinessIndustrySection(input: SectionInput): FloridaArmorySection {
  return section(
    "business_industry_analysis",
    "Business & Industry Analysis",
    "Business model, market context, industry risks, and research-grounded support.",
    {
      business_summary: input.memo.business_summary ?? null,
      industry: (input.memo as any).industry_analysis ?? input.memo.business_industry_analysis ?? null,
    },
    [],
    input.sources,
  );
}

export function buildManagementSection(input: SectionInput): FloridaArmorySection {
  const rows = ((input.memo.management_qualifications as any)?.principals ?? []) as Array<Record<string, unknown>>;

  return section(
    "management_qualifications",
    "Management Qualifications",
    "Principal experience, management capabilities, and sponsor support.",
    { management_qualifications: input.memo.management_qualifications ?? null },
    [{
      key: "principals",
      title: "Principals / Guarantors",
      columns: ["name", "title", "ownership_pct", "experience_summary"],
      rows,
    }],
    input.sources,
  );
}

export function buildDebtCoverageSection(input: SectionInput): FloridaArmorySection {
  const financial = input.memo.financial_analysis ?? {};
  const rows = ((financial as any).debt_coverage_table ?? []) as Array<Record<string, unknown>>;

  return section(
    "debt_coverage",
    "Financial Analysis — Debt Coverage",
    "Repayment capacity, historical and projected DSCR, annual debt service, and stressed coverage.",
    { financial_analysis: financial },
    [{
      key: "debt_coverage",
      title: "Debt Coverage",
      columns: ["period", "revenue", "ebitda", "cash_flow_available", "annual_debt_service", "dscr", "stressed_dscr"],
      rows,
    }],
    input.sources,
  );
}

export function buildNewDebtSection(input: SectionInput): FloridaArmorySection {
  const rows = ((input.memo as any).new_debt?.rows ?? []) as Array<Record<string, unknown>>;

  return section(
    "new_debt",
    "New Debt",
    "Proposed new debt structure and estimated repayment obligation.",
    { new_debt: (input.memo as any).new_debt ?? null },
    [{
      key: "new_debt",
      title: "New Debt",
      columns: ["lender", "amount", "rate", "term_months", "monthly_payment", "annual_debt_service"],
      rows,
    }],
    input.sources,
  );
}

export function buildGlobalCashFlowSection(input: SectionInput): FloridaArmorySection {
  const global = input.memo.global_cash_flow ?? {};
  const rows = ((global as any).global_cf_table ?? []) as Array<Record<string, unknown>>;

  return section(
    "global_cash_flow",
    "Global Cash Flow",
    "Combined business and personal cash flow available for repayment.",
    { global_cash_flow: global },
    [{
      key: "global_cash_flow",
      title: "Global Cash Flow",
      columns: ["period", "business_cash_flow", "personal_cash_flow", "global_cash_flow", "global_dscr"],
      rows,
    }],
    input.sources,
  );
}

export function buildIncomeStatementSection(input: SectionInput): FloridaArmorySection {
  const financial = input.memo.financial_analysis ?? {};
  const rows = ((financial as any).income_statement_table ?? []) as Array<Record<string, unknown>>;

  return section(
    "income_statement",
    "Income Statement",
    "Multi-period revenue, expenses, profitability, margins, and benchmark context.",
    { income_statement: rows },
    [{
      key: "income_statement",
      title: "Income Statement",
      columns: ["period", "revenue", "gross_profit", "operating_expenses", "ebitda", "net_income", "margin_pct"],
      rows,
    }],
    input.sources,
  );
}

export function buildRepaymentBreakevenSection(input: SectionInput): FloridaArmorySection {
  return section(
    "repayment_breakeven",
    "Repayment Ability / Breakeven",
    "Projection feasibility, repayment sensitivity, and breakeven analysis.",
    { breakeven: (input.memo.financial_analysis as any)?.breakeven ?? null },
    [],
    input.sources,
  );
}

export function buildPfsSection(input: SectionInput): FloridaArmorySection {
  // Canonical type is GuarantorBudget[]; spec assumes { guarantors: [...] }.
  // Accept either.
  const pfs = input.memo.personal_financial_statements;
  const rows = (
    Array.isArray(pfs)
      ? pfs
      : ((pfs as any)?.guarantors ?? [])
  ) as Array<Record<string, unknown>>;

  return section(
    "personal_financial_statements",
    "Personal Financial Statements",
    "Guarantor net worth, liquidity, contingent obligations, and monthly budget support.",
    { personal_financial_statements: pfs ?? null },
    [{
      key: "guarantor_pfs",
      title: "Guarantor PFS",
      columns: ["name", "assets", "liabilities", "net_worth", "liquidity", "monthly_surplus"],
      rows,
    }],
    input.sources,
  );
}

export function buildStrengthsWeaknessesSection(input: SectionInput): FloridaArmorySection {
  return section(
    "strengths_weaknesses",
    "Strengths & Weaknesses",
    "Primary credit strengths, weaknesses, mitigants, and underwriting concerns.",
    { strengths_weaknesses: input.memo.strengths_weaknesses ?? null },
    [],
    input.sources,
  );
}

export function buildPolicyExceptionsSection(input: SectionInput): FloridaArmorySection {
  // Canonical memo has a top-level policy_exceptions array; recommendation
  // also has an exceptions array. Combine.
  const exceptions = [
    ...((input.memo as any).policy_exceptions ?? []),
    ...((input.memo.recommendation as any)?.exceptions ?? []),
  ] as unknown[];

  return section(
    "policy_exceptions",
    "Policy Exceptions",
    "Identified policy exceptions and banker acknowledgement.",
    { exceptions },
    [],
    input.sources,
  );
}

export function buildProposedTermsSection(input: SectionInput): FloridaArmorySection {
  return section(
    "proposed_terms",
    "Proposed Terms",
    "Recommended structure, repayment terms, pricing, guarantees, and credit support.",
    { proposed_terms: (input.memo as any).proposed_terms ?? input.memo.recommendation ?? null },
    [],
    input.sources,
  );
}

export function buildConditionsSection(input: SectionInput): FloridaArmorySection {
  const conditions = input.memo.conditions ?? {};

  return section(
    "conditions",
    "Conditions",
    "Conditions precedent, ongoing conditions, covenants, and insurance requirements.",
    { conditions },
    [],
    input.sources,
  );
}

export function buildRecommendationApprovalSection(input: SectionInput): FloridaArmorySection {
  return section(
    "recommendation_approval",
    "Recommendation & Approval",
    "Banker recommendation and approval signature block for underwriting decision workflow.",
    { recommendation: input.memo.recommendation ?? null },
    [],
    input.sources,
  );
}

export function buildAllFloridaArmorySections(input: SectionInput) {
  return {
    readiness: buildReadinessSection(input),
    header: buildHeaderSection(input),
    financing_request: buildFinancingRequestSection(input),
    deal_summary: buildDealSummarySection(input),
    sources_and_uses: buildSourcesAndUsesSection(input),
    collateral: buildCollateralSection(input),
    eligibility: buildEligibilitySection(input),
    business_industry_analysis: buildBusinessIndustrySection(input),
    management_qualifications: buildManagementSection(input),
    debt_coverage: buildDebtCoverageSection(input),
    new_debt: buildNewDebtSection(input),
    global_cash_flow: buildGlobalCashFlowSection(input),
    income_statement: buildIncomeStatementSection(input),
    repayment_breakeven: buildRepaymentBreakevenSection(input),
    personal_financial_statements: buildPfsSection(input),
    strengths_weaknesses: buildStrengthsWeaknessesSection(input),
    policy_exceptions: buildPolicyExceptionsSection(input),
    proposed_terms: buildProposedTermsSection(input),
    conditions: buildConditionsSection(input),
    recommendation_approval: buildRecommendationApprovalSection(input),
  } as const;
}
