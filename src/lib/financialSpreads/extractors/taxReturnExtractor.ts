import "server-only";

import type { FinancialFactProvenance } from "@/lib/financialFacts/keys";
import {
  normalizePeriod,
  writeFactsBatch,
  type ExtractedLineItem,
  type ExtractionResult,
} from "./shared";

// ---------------------------------------------------------------------------
// Canonical line item keys for tax returns
// ---------------------------------------------------------------------------

const VALID_LINE_KEYS = new Set([
  // Common across forms
  "GROSS_RECEIPTS",
  "COST_OF_GOODS_SOLD",
  "GROSS_PROFIT",
  "TOTAL_INCOME",
  "TOTAL_DEDUCTIONS",
  "TAXABLE_INCOME",
  "NET_INCOME",
  "TAX_LIABILITY",

  // Depreciation / amortization (critical for cash flow add-back)
  "DEPRECIATION",
  "AMORTIZATION",
  "DEPLETION",

  // Officer / owner compensation
  "OFFICER_COMPENSATION",
  "SALARIES_WAGES",

  // Interest
  "INTEREST_EXPENSE",
  "INTEREST_INCOME",

  // Rental
  "RENTAL_INCOME",
  "RENTAL_EXPENSES",

  // 1040-specific
  "WAGES_W2",
  "BUSINESS_INCOME_SCHEDULE_C",
  "CAPITAL_GAINS",
  "IRA_DISTRIBUTIONS",
  "SOCIAL_SECURITY",
  "ADJUSTED_GROSS_INCOME",
  "STANDARD_DEDUCTION",
  "ITEMIZED_DEDUCTIONS",
  "QUALIFIED_BUSINESS_INCOME_DEDUCTION",

  // Partnership / S-Corp (K-1 items)
  "ORDINARY_BUSINESS_INCOME",
  "NET_RENTAL_REAL_ESTATE_INCOME",
  "GUARANTEED_PAYMENTS",
  "DISTRIBUTIONS",

  // Misc
  "OTHER_INCOME",
  "OTHER_DEDUCTIONS",
  "MEALS_ENTERTAINMENT",
  "RENT_EXPENSE",
  "TAXES_LICENSES",
  "INSURANCE_EXPENSE",
  "REPAIRS_MAINTENANCE",
  "ADVERTISING",
  "PENSION_PROFIT_SHARING",
]);

// ---------------------------------------------------------------------------
// Extraction prompt
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `You are a tax return extraction expert for commercial lending underwriting.

Given a tax return document (Form 1040, 1120, 1120S, 1065, Schedule C, Schedule E, K-1), extract key financial line items.

For EACH line item, provide:
- "line_key": One of these canonical keys:
  Common: GROSS_RECEIPTS, COST_OF_GOODS_SOLD, GROSS_PROFIT, TOTAL_INCOME, TOTAL_DEDUCTIONS, TAXABLE_INCOME, NET_INCOME, TAX_LIABILITY
  Add-backs: DEPRECIATION, AMORTIZATION, DEPLETION, OFFICER_COMPENSATION, INTEREST_EXPENSE
  1040: WAGES_W2, BUSINESS_INCOME_SCHEDULE_C, CAPITAL_GAINS, ADJUSTED_GROSS_INCOME, STANDARD_DEDUCTION, ITEMIZED_DEDUCTIONS, RENTAL_INCOME
  Partnership/S-Corp: ORDINARY_BUSINESS_INCOME, NET_RENTAL_REAL_ESTATE_INCOME, GUARANTEED_PAYMENTS, DISTRIBUTIONS
  Expenses: SALARIES_WAGES, RENT_EXPENSE, TAXES_LICENSES, INSURANCE_EXPENSE, REPAIRS_MAINTENANCE, ADVERTISING, MEALS_ENTERTAINMENT, PENSION_PROFIT_SHARING, OTHER_DEDUCTIONS
- "period": The tax year (e.g. "FY2023", "2023")
- "value": The dollar amount as a number. Income/revenue = positive. Losses = negative.
- "confidence": 0.0-1.0
- "snippet": The relevant text snippet from the form
- "form_type": Which form this came from (e.g. "1120S", "1040", "1065", "Schedule_C", "K1")

Respond with JSON:
{
  "tax_year": 2023,
  "form_type": "1120S",
  "entity_name": "ABC Holdings LLC" or null,
  "entity_type": "s_corp" | "c_corp" | "partnership" | "individual" | "schedule_c",
  "line_items": [
    {
      "line_key": "GROSS_RECEIPTS",
      "period": "FY2023",
      "value": 1500000,
      "confidence": 0.95,
      "snippet": "Line 1a Gross receipts $1,500,000",
      "form_type": "1120S"
    }
  ]
}

CRITICAL extraction targets for underwriting (always extract if present):
1. Gross receipts / gross income
2. Net income / taxable income
3. Depreciation & amortization (these are added back for cash flow)
4. Officer compensation (added back for owner-occupied businesses)
5. Interest expense
6. Distributions (K-1 line items)

Rules:
- Always try to extract depreciation — it's the single most important add-back
- For multi-year returns, extract each year separately
- Use "FY" prefix for annual tax year periods (e.g. "FY2023")
- Revenue/income = positive, expenses/deductions = positive (system applies sign logic)`;

// ---------------------------------------------------------------------------
// Extractor
// ---------------------------------------------------------------------------

export async function extractTaxReturn(_args: {
  dealId: string;
  bankId: string;
  documentId: string;
  ocrText: string;
}): Promise<ExtractionResult> {
  return { ok: false, factsWritten: 0, skipped: true, skipReason: "legacy_llm_extractor_disabled" };
}
