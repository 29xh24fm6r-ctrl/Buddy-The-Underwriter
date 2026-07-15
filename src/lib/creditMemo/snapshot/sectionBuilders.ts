// Florida Armory section builders.
//
// Each builder returns a FloridaArmorySection populated from the canonical
// credit memo. Missing values produce warnings rather than throws directly —
// but these warnings DO gate certification: assertCommitteeMemoSafe requires
// diagnostics.warnings.length === 0 with NO override mechanism, so every
// warning pushed here makes the memo un-certifiable until fixed. Only add a
// requireValue()/warning check to a field when its absence is a genuine
// problem for EVERY deal/product type this system supports — a field that's
// legitimately optional for some product types (e.g. new_debt, PFS for a
// corporate-only guarantee, income_statement-style financials for a
// CRE/NOI-based deal) must NOT get an unconditional warning here, or that
// entire class of legitimate deals becomes permanently unsubmittable with no
// escape hatch.
//
// Some of these were later given DEAL-TYPE-AWARE checks using
// memo.meta.deal_classification, all computed in buildCanonicalCreditMemo.ts
// and all fail-closed (default to false / not-gated on missing or ambiguous
// data, never a hard blocker source):
//   - income_statement, collateral: is_cre_deal/is_loc_deal
//   - global_cash_flow, personal_financial_statements:
//     has_individual_guarantor_at_threshold (see isLikelyIndividualOwner in
//     src/lib/ownership/entityClassification.ts — combines entity_type with
//     a name-suffix heuristic and the 20% SBA guaranty threshold, firing
//     only on positive evidence)
//   - repayment_breakeven: is_new_business (SBA SOP 50 10 8, < 24 months,
//     via src/lib/sba/newBusinessProtocol.ts — the same detector
//     feasibilityEngine.ts/sbaRiskProfile.ts already use)
//
// new_debt still intentionally has no completeness check: it's now wired to
// real deal_existing_debt_schedule data, but zero rows is ambiguous between
// "no other debt" and "debt schedule not yet entered" — no intake-completeness
// signal exists to disambiguate, so it's left ungated (see buildNewDebtSection).
//
// policy_exceptions and conditions also remain ungated — no per-deal
// applicability signal for either has been derived yet.

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
  const warnings: string[] = [];
  const transactionOverview = (input.memo as any).transaction_overview ?? null;
  requireValue(transactionOverview, "Transaction overview", warnings);

  return section(
    "deal_summary",
    "Deal Summary / Purpose",
    "Summary of borrower request, transaction purpose, and credit action.",
    {
      deal_summary: (input.memo as any).deal_summary ?? null,
      purpose: (input.memo as any).purpose ?? null,
      transaction_overview: transactionOverview,
    },
    [],
    input.sources,
    warnings,
  );
}

export function buildSourcesAndUsesSection(input: SectionInput): FloridaArmorySection {
  // Canonical memo uses "sources_uses" (no "and"); spec uses "sources_and_uses".
  const warnings: string[] = [];
  const su = (input.memo as any).sources_and_uses ?? (input.memo as any).sources_uses ?? null;
  requireValue(su, "Sources & uses", warnings);
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
    warnings,
  );
}

export function buildCollateralSection(input: SectionInput): FloridaArmorySection {
  const warnings: string[] = [];
  const collateral = input.memo.collateral ?? {};
  const rows = ((collateral as any).line_items ?? []) as Array<Record<string, unknown>>;
  const arBb = (collateral as any).ar_borrowing_base;

  // CRE deals are collateral-secured by definition — a CRE memo with no
  // collateral value, no line items, and no AR borrowing base means the
  // collateral data pipeline never ran, not a legitimate "no collateral" CRE
  // deal. Checking gross_value (not just line_items) avoids false-positiving
  // on a deal that has an aggregate valuation but no itemized line items.
  const isCreDeal = input.memo.meta?.deal_classification?.is_cre_deal ?? false;
  const grossValue = (collateral as any).gross_value?.value ?? null;
  if (isCreDeal && rows.length === 0 && !arBb && grossValue === null) {
    warnings.push("Collateral analysis missing for a CRE deal");
  }

  const tables: Array<{ key: string; title: string; columns: string[]; rows: Array<Record<string, unknown>> }> = [
    {
      key: "collateral_line_items",
      title: "Collateral Analysis",
      columns: ["description", "market_value", "advance_rate", "discounted_value", "lien_position"],
      rows,
    },
  ];

  // Add AR aging table when borrowing base data exists
  if (arBb && Array.isArray(arBb.aging_buckets) && arBb.aging_buckets.length > 0) {
    tables.push({
      key: "ar_aging_buckets",
      title: "AR Aging Analysis",
      columns: ["bucket", "amount", "pct_of_total"],
      rows: arBb.aging_buckets as Array<Record<string, unknown>>,
    });
  }

  return section(
    "collateral",
    "Collateral Analysis",
    arBb
      ? `Collateral support with AR borrowing base analysis. ${arBb.collateral_coverage_narrative ?? ""}`
      : "Collateral support, lien position, advance rates, and discounted collateral coverage.",
    { collateral },
    tables,
    input.sources,
    warnings,
  );
}

export function buildEligibilitySection(input: SectionInput): FloridaArmorySection {
  const warnings: string[] = [];
  const eligibility = input.memo.eligibility ?? null;
  requireValue(eligibility, "Eligibility", warnings);

  return section(
    "eligibility",
    "Eligibility",
    "SBA eligibility, NAICS, size standard, and related eligibility observations.",
    { eligibility },
    [],
    input.sources,
    warnings,
  );
}

export function buildBusinessIndustrySection(input: SectionInput): FloridaArmorySection {
  const warnings: string[] = [];
  const businessSummary = input.memo.business_summary ?? null;
  requireValue(businessSummary, "Business summary", warnings);

  return section(
    "business_industry_analysis",
    "Business & Industry Analysis",
    "Business model, market context, industry risks, and research-grounded support.",
    {
      business_summary: businessSummary,
      industry: (input.memo as any).industry_analysis ?? input.memo.business_industry_analysis ?? null,
    },
    [],
    input.sources,
    warnings,
  );
}

export function buildManagementSection(input: SectionInput): FloridaArmorySection {
  const warnings: string[] = [];
  const rows = ((input.memo.management_qualifications as any)?.principals ?? []) as Array<Record<string, unknown>>;
  // Every borrowing entity has at least one owner/principal on file — unlike
  // several other sections, this is true regardless of deal/product type, so
  // it's safe to require unconditionally (zero principals means the
  // ownership/management data pipeline never ran, not a legitimate business case).
  if (rows.length === 0) warnings.push("No management principals on file");

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
    warnings,
  );
}

export function buildDebtCoverageSection(input: SectionInput): FloridaArmorySection {
  const warnings: string[] = [];
  const financial = input.memo.financial_analysis ?? {};
  const rows = ((financial as any).debt_coverage_table ?? []) as Array<Record<string, unknown>>;

  // No product type legitimately has BOTH a zero-row debt coverage table AND
  // no computed DSCR value — that combination means repayment capacity was
  // never analyzed at all, regardless of deal type. (A deal with a populated
  // table but no single "dscr" scalar, or vice versa, is not flagged here —
  // only the double-absence, which needs no deal-type detection to be safe.)
  const dscrValue = (financial as any).dscr?.value ?? null;
  if (rows.length === 0 && dscrValue === null) {
    warnings.push("Debt coverage analysis missing — no debt coverage table and no computed DSCR");
  }

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
    warnings,
  );
}

export function buildNewDebtSection(input: SectionInput): FloridaArmorySection {
  const rows = (input.memo.new_debt?.rows ?? []) as unknown as Array<Record<string, unknown>>;

  // Intentionally NOT gated (no requireValue/warning): deal_existing_debt_schedule
  // is optional manual entry with no intake-completeness signal — zero rows is
  // ambiguous between "this borrower genuinely has no other debt" and "nobody
  // has entered the existing-debt schedule yet." A hard blocker here would risk
  // permanently un-submittable memos for the common (clean, no-other-debt) case.
  // See sectionBuilders.ts's top docblock.
  return section(
    "new_debt",
    "New Debt",
    "Proposed new debt structure and estimated repayment obligation.",
    { new_debt: input.memo.new_debt ?? null },
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
  const warnings: string[] = [];
  const global = input.memo.global_cash_flow ?? {};
  const rows = ((global as any).global_cf_table ?? []) as Array<Record<string, unknown>>;

  // Global cash flow only matters when an individual is guaranteeing the
  // loan (it blends business + personal cash flow). Gate only fires on
  // positive evidence from meta.deal_classification — see
  // isLikelyIndividualOwner in entityClassification.ts. Missing/ambiguous
  // ownership data leaves the flag false, so this never blocks a deal we
  // can't positively classify.
  const hasIndividualGuarantor = input.memo.meta?.deal_classification?.has_individual_guarantor_at_threshold ?? false;
  if (hasIndividualGuarantor && rows.length === 0) {
    warnings.push("Global cash flow missing for a deal with an individual guarantor");
  }

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
    warnings,
  );
}

export function buildIncomeStatementSection(input: SectionInput): FloridaArmorySection {
  const warnings: string[] = [];
  const financial = input.memo.financial_analysis ?? {};
  const rows = ((financial as any).income_statement_table ?? []) as Array<Record<string, unknown>>;

  // CRE/NOI-based deals are legitimately exempt (repayment is analyzed via
  // debt_coverage/NOI, not a multi-period operating income statement). For
  // every other deal type, an empty income statement means the tax-return/
  // financial-statement extraction pipeline never ran.
  const isCreDeal = input.memo.meta?.deal_classification?.is_cre_deal ?? false;
  if (!isCreDeal && rows.length === 0) {
    warnings.push("Income statement missing for a non-CRE deal");
  }

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
    warnings,
  );
}

export function buildRepaymentBreakevenSection(input: SectionInput): FloridaArmorySection {
  const warnings: string[] = [];
  const breakeven = (input.memo.financial_analysis as any)?.breakeven ?? null;

  // SBA SOP 50 10 8 requires projected DSCR/breakeven analysis for new
  // businesses (< 24 months). buildStressTestTable always returns a non-null
  // object (all-null fields on missing input), so "populated" is judged by
  // baseline_dscr, not object presence. Gate fires only on positive
  // new-business evidence — see meta.deal_classification.is_new_business.
  const isNewBusiness = input.memo.meta?.deal_classification?.is_new_business ?? false;
  if (isNewBusiness && (breakeven?.baseline_dscr ?? null) === null) {
    warnings.push("Repayment breakeven analysis missing for a new business (< 2 years)");
  }

  return section(
    "repayment_breakeven",
    "Repayment Ability / Breakeven",
    "Projection feasibility, repayment sensitivity, and breakeven analysis.",
    { breakeven },
    [],
    input.sources,
    warnings,
  );
}

export function buildPfsSection(input: SectionInput): FloridaArmorySection {
  const warnings: string[] = [];
  // Canonical type is GuarantorBudget[]; spec assumes { guarantors: [...] }.
  // Accept either.
  const pfs = input.memo.personal_financial_statements;
  const rows = (
    Array.isArray(pfs)
      ? pfs
      : ((pfs as any)?.guarantors ?? [])
  ) as Array<Record<string, unknown>>;

  // Same guarantor signal as global_cash_flow — a PFS is only required when
  // there's positive evidence of an individual guarantor at/above the SBA
  // threshold. See isLikelyIndividualOwner in entityClassification.ts.
  const hasIndividualGuarantor = input.memo.meta?.deal_classification?.has_individual_guarantor_at_threshold ?? false;
  if (hasIndividualGuarantor && rows.length === 0) {
    warnings.push("Personal financial statement missing for an individual guarantor");
  }

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
    warnings,
  );
}

export function buildStrengthsWeaknessesSection(input: SectionInput): FloridaArmorySection {
  const warnings: string[] = [];
  const strengthsWeaknesses = input.memo.strengths_weaknesses ?? null;
  requireValue(strengthsWeaknesses, "Strengths & weaknesses", warnings);

  return section(
    "strengths_weaknesses",
    "Strengths & Weaknesses",
    "Primary credit strengths, weaknesses, mitigants, and underwriting concerns.",
    { strengths_weaknesses: strengthsWeaknesses },
    [],
    input.sources,
    warnings,
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
  const warnings: string[] = [];
  const proposedTerms = (input.memo as any).proposed_terms ?? input.memo.recommendation ?? null;
  requireValue(proposedTerms, "Proposed terms", warnings);

  return section(
    "proposed_terms",
    "Proposed Terms",
    "Recommended structure, repayment terms, pricing, guarantees, and credit support.",
    { proposed_terms: proposedTerms },
    [],
    input.sources,
    warnings,
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
  const warnings: string[] = [];
  const recommendation = input.memo.recommendation ?? null;
  // Every memo must carry SOME recommendation/verdict before it can reach
  // committee — unlike most of the other sections left unvalidated below,
  // there is no legitimate deal type or product where "no recommendation at
  // all" is an acceptable end state.
  requireValue(recommendation, "Recommendation", warnings);

  return section(
    "recommendation_approval",
    "Recommendation & Approval",
    "Banker recommendation and approval signature block for underwriting decision workflow.",
    { recommendation },
    [],
    input.sources,
    warnings,
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
