/**
 * Type-specific prompt templates for Gemini Flash structured extraction assist.
 *
 * These prompts instruct Gemini Flash to extract financial line items as
 * structured JSON. The output is ADVISORY ONLY — it feeds into deterministic
 * extractors as an assist layer, never persists facts directly.
 *
 * Output shape matches the entity/formField structure consumed by
 * structuredJsonParser.ts (formerly docAiParser.ts).
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type StructuredAssistPrompt = {
  systemInstruction: string;
  userPrompt: string;
};

// ---------------------------------------------------------------------------
// Shared prefix
// ---------------------------------------------------------------------------

const SYSTEM_PREFIX =
  "You are a financial document extraction engine. " +
  "Extract ONLY the requested fields from the provided document text. " +
  "Return strict JSON only — no commentary, no markdown, no explanation. " +
  "For monetary values use plain numbers (no currency symbols, no commas). " +
  "Use null for any field you cannot confidently extract. " +
  "If a value is negative, use a negative number.";

// ---------------------------------------------------------------------------
// Output schema instruction
// ---------------------------------------------------------------------------

const ENTITY_FORMAT_INSTRUCTION =
  '\nReturn a JSON object with exactly this structure:\n' +
  '{\n' +
  '  "entities": [\n' +
  '    { "type": "<field_name>", "mentionText": "<original text from document>", "confidence": <0.0-1.0>, "normalizedValue": { "moneyValue": { "units": <integer_dollars>, "nanos": <fractional_cents_as_nanos> } } }\n' +
  '  ],\n' +
  '  "formFields": [\n' +
  '    { "name": "<field_label>", "value": "<field_value>", "confidence": <0.0-1.0> }\n' +
  '  ]\n' +
  '}\n' +
  'For monetary entities: units = whole dollar amount (e.g. 150000), nanos = 0 for whole dollars.\n' +
  'For non-monetary fields (EIN, SSN, dates, names): use formFields with string values.\n' +
  'confidence should reflect how clearly the value was stated in the document (0.5 = ambiguous, 0.9+ = clearly stated).';

// ---------------------------------------------------------------------------
// Business Tax Return (1120, 1065, 1120S)
// ---------------------------------------------------------------------------

function buildBusinessTaxReturnPrompt(ocrText: string): StructuredAssistPrompt {
  return {
    systemInstruction: SYSTEM_PREFIX,
    userPrompt:
      "Extract the following fields from this business tax return document.\n\n" +
      "Monetary fields (use entities array):\n" +
      "- gross_receipts (IRS Line: Gross receipts or sales)\n" +
      "- total_income\n" +
      "- net_income (Taxable income or Net income)\n" +
      "- officer_compensation (Compensation of officers)\n" +
      "- salaries_wages (Salaries and wages)\n" +
      "- depreciation\n" +
      "- amortization\n" +
      "- interest_expense (Interest paid or accrued)\n" +
      "- rent_expense (Rents paid)\n" +
      "- taxes_paid\n" +
      "- ordinary_business_income (Ordinary business income/loss)\n" +
      "- net_rental_real_estate_income\n" +
      "- guaranteed_payments\n" +
      "- distributions\n" +
      "- total_assets (from Schedule L if present)\n" +
      "- total_liabilities (from Schedule L if present)\n" +
      "- total_equity (from Schedule L: partners capital / retained earnings)\n\n" +
      "Non-monetary fields (use formFields array):\n" +
      "- ein (Employer Identification Number, format: XX-XXXXXXX)\n" +
      "- business_name (Entity name)\n" +
      "- tax_year (e.g. 2023)\n" +
      "- form_type (e.g. 1120, 1065, 1120S)\n\n" +
      ENTITY_FORMAT_INSTRUCTION +
      "\n\nDocument text:\n" + ocrText,
  };
}

// ---------------------------------------------------------------------------
// Personal Tax Return (1040)
// ---------------------------------------------------------------------------

function buildPersonalTaxReturnPrompt(ocrText: string): StructuredAssistPrompt {
  return {
    systemInstruction: SYSTEM_PREFIX,
    userPrompt:
      "Extract the following fields from this personal tax return (Form 1040) document.\n\n" +
      "Monetary fields (use entities array):\n" +
      "- wages_w2 (Wages, salaries, tips - Line 1)\n" +
      "- interest_income (Taxable interest - Line 2b)\n" +
      "- dividend_income (Ordinary dividends - Line 3b)\n" +
      "- capital_gains (Capital gain or loss - Line 7)\n" +
      "- business_income_schedule_c (Business income/loss - Schedule C net)\n" +
      "- rental_income (Rental real estate, royalties - Schedule E)\n" +
      "- k1_ordinary_income (Partnership/S-Corp income from K-1)\n" +
      "- social_security (Social security benefits - Line 6a/6b)\n" +
      "- ira_distributions (IRA distributions - Line 4a/4b)\n" +
      "- total_income (Total income - Line 9)\n" +
      "- adjusted_gross_income (AGI - Line 11)\n" +
      "- taxable_income (Taxable income - Line 15)\n" +
      "- standard_deduction\n" +
      "- itemized_deductions\n\n" +
      "Non-monetary fields (use formFields array):\n" +
      "- ssn (Social Security Number, format: XXX-XX-XXXX — redact middle digits if visible)\n" +
      "- taxpayer_name (Primary taxpayer name)\n" +
      "- tax_year (e.g. 2023)\n" +
      "- filing_status (e.g. Single, Married Filing Jointly)\n\n" +
      ENTITY_FORMAT_INSTRUCTION +
      "\n\nDocument text:\n" + ocrText,
  };
}

// ---------------------------------------------------------------------------
// Balance Sheet
// ---------------------------------------------------------------------------

function buildBalanceSheetPrompt(ocrText: string): StructuredAssistPrompt {
  return {
    systemInstruction: SYSTEM_PREFIX,
    userPrompt:
      "Extract the following fields from this balance sheet document.\n\n" +
      "Monetary fields (use entities array):\n" +
      "- cash_and_equivalents\n" +
      "- accounts_receivable\n" +
      "- inventory\n" +
      "- prepaid_expenses\n" +
      "- other_current_assets\n" +
      "- total_current_assets\n" +
      "- property_plant_equipment (Gross PP&E)\n" +
      "- accumulated_depreciation\n" +
      "- net_fixed_assets\n" +
      "- intangible_assets\n" +
      "- other_non_current_assets\n" +
      "- total_assets\n" +
      "- accounts_payable\n" +
      "- accrued_expenses\n" +
      "- short_term_debt (Current portion of debt)\n" +
      "- current_portion_ltd\n" +
      "- other_current_liabilities\n" +
      "- total_current_liabilities\n" +
      "- long_term_debt\n" +
      "- mortgage_payable\n" +
      "- other_non_current_liabilities\n" +
      "- total_liabilities\n" +
      "- common_stock\n" +
      "- retained_earnings\n" +
      "- partners_capital\n" +
      "- members_equity\n" +
      "- total_equity\n\n" +
      "Non-monetary fields (use formFields array):\n" +
      "- entity_name (Company/entity name if visible)\n" +
      "- as_of_date (Balance sheet date, e.g. 12/31/2023)\n\n" +
      ENTITY_FORMAT_INSTRUCTION +
      "\n\nDocument text:\n" + ocrText,
  };
}

// ---------------------------------------------------------------------------
// Income Statement
// ---------------------------------------------------------------------------

function buildIncomeStatementPrompt(ocrText: string): StructuredAssistPrompt {
  return {
    systemInstruction: SYSTEM_PREFIX,
    userPrompt:
      "Extract the following fields from this income statement / P&L document.\n\n" +
      "Monetary fields (use entities array):\n" +
      "- total_revenue (or gross revenue / net sales)\n" +
      "- cost_of_goods_sold (COGS / cost of sales)\n" +
      "- gross_profit\n" +
      "- selling_general_admin (SG&A)\n" +
      "- operating_income (Income from operations)\n" +
      "- ebitda\n" +
      "- gross_rental_income (for CRE properties)\n" +
      "- vacancy (Vacancy and concessions)\n" +
      "- other_income\n" +
      "- effective_gross_income (EGI)\n" +
      "- repairs_maintenance (R&M)\n" +
      "- utilities\n" +
      "- property_management (Management fees)\n" +
      "- real_estate_taxes (Property taxes)\n" +
      "- insurance\n" +
      "- payroll\n" +
      "- marketing\n" +
      "- professional_fees\n" +
      "- other_expenses\n" +
      "- depreciation\n" +
      "- amortization\n" +
      "- debt_service (Interest expense / loan payments)\n" +
      "- capital_expenditures (CapEx)\n" +
      "- total_operating_expenses\n" +
      "- net_operating_income (NOI)\n" +
      "- net_income\n\n" +
      "Non-monetary fields (use formFields array):\n" +
      "- entity_name (Company/property name if visible)\n" +
      "- period_start (e.g. 01/01/2023)\n" +
      "- period_end (e.g. 12/31/2023)\n\n" +
      ENTITY_FORMAT_INSTRUCTION +
      "\n\nDocument text:\n" + ocrText,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Build the Gemini Flash prompt for a given canonical document type.
 * Returns null for unsupported types — caller should skip structured assist.
 */
export function buildStructuredAssistPrompt(
  canonicalType: string,
  ocrText: string,
): StructuredAssistPrompt | null {
  switch (canonicalType) {
    case "BUSINESS_TAX_RETURN":
      return buildBusinessTaxReturnPrompt(ocrText);
    case "PERSONAL_TAX_RETURN":
      return buildPersonalTaxReturnPrompt(ocrText);
    case "BALANCE_SHEET":
      return buildBalanceSheetPrompt(ocrText);
    case "INCOME_STATEMENT":
      return buildIncomeStatementPrompt(ocrText);
    default:
      return null;
  }
}
