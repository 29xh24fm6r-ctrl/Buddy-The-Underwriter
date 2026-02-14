// ---------------------------------------------------------------------------
// Phase 15B — SBA 7(a) Slot Policy
// ---------------------------------------------------------------------------
// Three branches: EXISTING | STARTUP | ACQUISITION
// Deterministic: same scenario inputs → same slots every time.

import type { IntakeScenario, SlotDefinition, SlotPolicy } from "../types";
import { computeTaxYears } from "../taxYears";

// ---------------------------------------------------------------------------
// Shared SBA form slots (common to all stages)
// ---------------------------------------------------------------------------

function sbaFormSlots(startOrder: number): SlotDefinition[] {
  let s = startOrder;
  return [
    {
      slot_key: "SBA_1919",
      slot_group: "SBA_FORMS",
      required_doc_type: "SBA_1919",
      required_tax_year: null,
      required: true,
      sort_order: s++,
      slot_mode: "UPLOAD",
      interactive_kind: null,
      help_title: "SBA Form 1919 (Borrower Information)",
      help_reason:
        "Required for all SBA 7(a) loans. Collects borrower identity, ownership, and eligibility information.",
      help_examples: ["SBA Form 1919 PDF from sba.gov"],
    },
    {
      slot_key: "SBA_413",
      slot_group: "SBA_FORMS",
      required_doc_type: "SBA_413",
      required_tax_year: null,
      required: true,
      sort_order: s++,
      slot_mode: "UPLOAD",
      interactive_kind: null,
      help_title: "SBA Form 413 (Personal Financial Statement)",
      help_reason:
        "Required for all owners with 20%+ ownership. This is the SBA's version of a personal financial statement.",
      help_alternatives: [
        "A current personal financial statement (PFS) in any format is also accepted.",
      ],
    },
    {
      slot_key: "SBA_DEBT_SCHEDULE",
      slot_group: "SBA_FORMS",
      required_doc_type: "DEBT_SCHEDULE",
      required_tax_year: null,
      required: true,
      sort_order: s++,
      slot_mode: "UPLOAD",
      interactive_kind: null,
      help_title: "Business Debt Schedule",
      help_reason:
        "SBA requires a complete schedule of all existing business debts, including creditor, balance, payment, rate, and maturity.",
    },
  ];
}

// ---------------------------------------------------------------------------
// EXISTING business (has history, tax returns exist)
// ---------------------------------------------------------------------------

function sba7aExistingSlots(
  _scenario: IntakeScenario,
  now?: Date,
): SlotDefinition[] {
  const taxYears = computeTaxYears(now);
  const slots: SlotDefinition[] = [];
  let s = 0;

  // 3 Business Tax Returns
  for (const year of taxYears) {
    slots.push({
      slot_key: `BUSINESS_TAX_RETURN_${year}`,
      slot_group: "BUSINESS_TAX_RETURN",
      required_doc_type: "BUSINESS_TAX_RETURN",
      required_tax_year: year,
      required: true,
      sort_order: s++,
      slot_mode: "UPLOAD",
      interactive_kind: null,
      help_title: `Business Tax Return (${year})`,
      help_reason:
        "SBA requires 3 years of business tax returns for established businesses to evaluate historical cash flow.",
    });
  }

  // 3 Personal Tax Returns
  for (const year of taxYears) {
    slots.push({
      slot_key: `PERSONAL_TAX_RETURN_${year}`,
      slot_group: "PERSONAL_TAX_RETURN",
      required_doc_type: "PERSONAL_TAX_RETURN",
      required_tax_year: year,
      required: true,
      sort_order: s++,
      slot_mode: "UPLOAD",
      interactive_kind: null,
      help_title: `Personal Tax Return (${year})`,
      help_reason:
        "Required for all owners with 20%+ ownership to assess personal income and global cash flow.",
    });
  }

  // PFS
  slots.push({
    slot_key: "PFS_CURRENT",
    slot_group: "PFS",
    required_doc_type: "PERSONAL_FINANCIAL_STATEMENT",
    required_tax_year: null,
    required: true,
    sort_order: s++,
    slot_mode: "UPLOAD",
    interactive_kind: null,
    help_title: "Personal Financial Statement",
    help_reason:
      "Required for all owners with 20%+ ownership. Shows current assets, liabilities, and net worth.",
    help_alternatives: [
      "SBA Form 413 is also accepted as a personal financial statement.",
    ],
  });

  // YTD Income Statement
  slots.push({
    slot_key: "INCOME_STATEMENT_YTD",
    slot_group: "INCOME_STATEMENT",
    required_doc_type: "INCOME_STATEMENT",
    required_tax_year: null,
    required: true,
    sort_order: s++,
    slot_mode: "UPLOAD",
    interactive_kind: null,
    help_title: "YTD Income Statement (Profit & Loss)",
    help_reason:
      "Shows current-year business performance. SBA uses this alongside tax returns for cash flow analysis.",
  });

  // Current Balance Sheet
  slots.push({
    slot_key: "BALANCE_SHEET_CURRENT",
    slot_group: "BALANCE_SHEET",
    required_doc_type: "BALANCE_SHEET",
    required_tax_year: null,
    required: true,
    sort_order: s++,
    slot_mode: "UPLOAD",
    interactive_kind: null,
    help_title: "Current Balance Sheet",
    help_reason:
      "Shows the business's current financial position — assets, liabilities, and equity.",
  });

  // SBA Forms
  slots.push(...sbaFormSlots(s));

  return slots;
}

// ---------------------------------------------------------------------------
// STARTUP (no business tax returns; projections + plan required)
// ---------------------------------------------------------------------------

function sba7aStartupSlots(
  _scenario: IntakeScenario,
  now?: Date,
): SlotDefinition[] {
  const taxYears = computeTaxYears(now);
  const slots: SlotDefinition[] = [];
  let s = 0;

  // NO business tax returns for startups

  // 3 Personal Tax Returns (still required for owners)
  for (const year of taxYears) {
    slots.push({
      slot_key: `PERSONAL_TAX_RETURN_${year}`,
      slot_group: "PERSONAL_TAX_RETURN",
      required_doc_type: "PERSONAL_TAX_RETURN",
      required_tax_year: year,
      required: true,
      sort_order: s++,
      slot_mode: "UPLOAD",
      interactive_kind: null,
      help_title: `Personal Tax Return (${year})`,
      help_reason:
        "Even for startups, SBA requires personal tax returns for all owners with 20%+ ownership.",
    });
  }

  // PFS
  slots.push({
    slot_key: "PFS_CURRENT",
    slot_group: "PFS",
    required_doc_type: "PERSONAL_FINANCIAL_STATEMENT",
    required_tax_year: null,
    required: true,
    sort_order: s++,
    slot_mode: "UPLOAD",
    interactive_kind: null,
    help_title: "Personal Financial Statement",
    help_reason:
      "Required for all owners with 20%+ ownership. Critical for startups to demonstrate personal financial capacity.",
    help_alternatives: [
      "SBA Form 413 is also accepted as a personal financial statement.",
    ],
  });

  // ── Startup Package (replaces business tax returns) ──

  // Business Plan
  slots.push({
    slot_key: "BUSINESS_PLAN",
    slot_group: "STARTUP_PACKAGE",
    required_doc_type: "BUSINESS_PLAN",
    required_tax_year: null,
    required: true,
    sort_order: s++,
    slot_mode: "UPLOAD",
    interactive_kind: null,
    help_title: "Business Plan",
    help_reason:
      "Startups without operating history must provide a comprehensive business plan demonstrating viability.",
    help_examples: [
      "Executive summary with mission and value proposition",
      "Market analysis and competitive landscape",
      "Management team bios and relevant experience",
      "Marketing and sales strategy",
      "Financial projections (can be separate document)",
    ],
  });

  // 3-Year Financial Projections
  slots.push({
    slot_key: "PROJECTIONS_3YR",
    slot_group: "STARTUP_PACKAGE",
    required_doc_type: "FINANCIAL_PROJECTIONS",
    required_tax_year: null,
    required: true,
    sort_order: s++,
    slot_mode: "UPLOAD",
    interactive_kind: null,
    help_title: "3-Year Financial Projections",
    help_reason:
      "SBA requires projected income statement, balance sheet, and cash flow for startup businesses.",
    help_examples: [
      "Monthly projections for Year 1",
      "Quarterly or annual for Years 2-3",
      "Include revenue assumptions, COGS, operating expenses",
      "Cash flow statement showing loan repayment capacity",
    ],
    help_alternatives: [
      "Buddy can help you build projections interactively (coming soon).",
    ],
  });

  // Owner Resume
  slots.push({
    slot_key: "OWNER_RESUME",
    slot_group: "STARTUP_PACKAGE",
    required_doc_type: "RESUME",
    required_tax_year: null,
    required: true,
    sort_order: s++,
    slot_mode: "UPLOAD",
    interactive_kind: null,
    help_title: "Owner Resume / Management Experience",
    help_reason:
      "SBA evaluates management capability for startups. Resume should demonstrate relevant industry experience.",
    help_examples: [
      "Professional resume highlighting industry experience",
      "Relevant certifications or licenses",
      "Prior business ownership experience",
    ],
  });

  // SBA Forms
  slots.push(...sbaFormSlots(s));

  return slots;
}

// ---------------------------------------------------------------------------
// ACQUISITION (seller docs + purchase agreement + pro forma)
// ---------------------------------------------------------------------------

function sba7aAcquisitionSlots(
  _scenario: IntakeScenario,
  now?: Date,
): SlotDefinition[] {
  const taxYears = computeTaxYears(now);
  const slots: SlotDefinition[] = [];
  let s = 0;

  // 3 Personal Tax Returns (buyer)
  for (const year of taxYears) {
    slots.push({
      slot_key: `PERSONAL_TAX_RETURN_${year}`,
      slot_group: "PERSONAL_TAX_RETURN",
      required_doc_type: "PERSONAL_TAX_RETURN",
      required_tax_year: year,
      required: true,
      sort_order: s++,
      slot_mode: "UPLOAD",
      interactive_kind: null,
      help_title: `Personal Tax Return (${year})`,
      help_reason:
        "Required for all buyers with 20%+ ownership to assess personal income and repayment capacity.",
    });
  }

  // PFS
  slots.push({
    slot_key: "PFS_CURRENT",
    slot_group: "PFS",
    required_doc_type: "PERSONAL_FINANCIAL_STATEMENT",
    required_tax_year: null,
    required: true,
    sort_order: s++,
    slot_mode: "UPLOAD",
    interactive_kind: null,
    help_title: "Personal Financial Statement",
    help_reason: "Required for all buyers with 20%+ ownership.",
    help_alternatives: [
      "SBA Form 413 is also accepted as a personal financial statement.",
    ],
  });

  // ── Seller / Target Financials ──

  // 3 years of seller business tax returns
  for (const year of taxYears) {
    slots.push({
      slot_key: `SELLER_TAX_RETURN_${year}`,
      slot_group: "SELLER_FINANCIALS",
      required_doc_type: "BUSINESS_TAX_RETURN",
      required_tax_year: year,
      required: true,
      sort_order: s++,
      slot_mode: "UPLOAD",
      interactive_kind: null,
      help_title: `Seller Business Tax Return (${year})`,
      help_reason:
        "SBA requires 3 years of the target business's tax returns to evaluate historical cash flow for the acquisition.",
    });
  }

  // Seller YTD Income Statement
  slots.push({
    slot_key: "SELLER_INCOME_STATEMENT_YTD",
    slot_group: "SELLER_FINANCIALS",
    required_doc_type: "INCOME_STATEMENT",
    required_tax_year: null,
    required: true,
    sort_order: s++,
    slot_mode: "UPLOAD",
    interactive_kind: null,
    help_title: "Seller YTD Income Statement",
    help_reason:
      "Current-year performance of the business being acquired.",
  });

  // Seller Balance Sheet
  slots.push({
    slot_key: "SELLER_BALANCE_SHEET",
    slot_group: "SELLER_FINANCIALS",
    required_doc_type: "BALANCE_SHEET",
    required_tax_year: null,
    required: true,
    sort_order: s++,
    slot_mode: "UPLOAD",
    interactive_kind: null,
    help_title: "Seller Current Balance Sheet",
    help_reason:
      "Current financial position of the business being acquired.",
  });

  // ── Acquisition-Specific Docs ──

  // Purchase Agreement
  slots.push({
    slot_key: "PURCHASE_AGREEMENT",
    slot_group: "ACQUISITION_PACKAGE",
    required_doc_type: "PURCHASE_AGREEMENT",
    required_tax_year: null,
    required: true,
    sort_order: s++,
    slot_mode: "UPLOAD",
    interactive_kind: null,
    help_title: "Purchase Agreement / Letter of Intent",
    help_reason:
      "SBA requires the executed purchase agreement or LOI showing purchase price, terms, and asset allocation.",
    help_examples: [
      "Asset Purchase Agreement (APA)",
      "Stock Purchase Agreement",
      "Letter of Intent (LOI) if agreement not yet signed",
    ],
  });

  // Pro Forma Projections
  slots.push({
    slot_key: "PRO_FORMA",
    slot_group: "ACQUISITION_PACKAGE",
    required_doc_type: "FINANCIAL_PROJECTIONS",
    required_tax_year: null,
    required: true,
    sort_order: s++,
    slot_mode: "UPLOAD",
    interactive_kind: null,
    help_title: "Pro Forma Financial Projections",
    help_reason:
      "Post-acquisition projections showing how the business will perform under new ownership with SBA debt service.",
    help_examples: [
      "12-month pro forma income statement",
      "Pro forma cash flow showing debt service coverage",
    ],
  });

  // Buyer Entity Docs
  slots.push({
    slot_key: "BUYER_ENTITY_DOCS",
    slot_group: "ACQUISITION_PACKAGE",
    required_doc_type: "ENTITY_DOCS",
    required_tax_year: null,
    required: false,
    sort_order: s++,
    slot_mode: "UPLOAD",
    interactive_kind: null,
    help_title: "Buyer Entity Documents",
    help_reason:
      "Operating agreement, articles of organization, or certificate of formation for the acquiring entity.",
    help_alternatives: [
      "If the buyer entity hasn't been formed yet, this can be provided later.",
    ],
  });

  // SBA Forms
  slots.push(...sbaFormSlots(s));

  return slots;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function generateSba7aSlots(
  scenario: IntakeScenario,
  now?: Date,
): SlotDefinition[] {
  switch (scenario.borrower_business_stage) {
    case "STARTUP":
      return sba7aStartupSlots(scenario, now);
    case "ACQUISITION":
      return sba7aAcquisitionSlots(scenario, now);
    case "EXISTING":
    default:
      return sba7aExistingSlots(scenario, now);
  }
}

export const SBA_7A_POLICY: SlotPolicy = {
  product: "SBA_7A",
  generateSlots: generateSba7aSlots,
};
