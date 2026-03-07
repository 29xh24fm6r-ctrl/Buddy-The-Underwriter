/**
 * Gemini-Primary Prompt — Personal Tax Return (Form 1040)
 *
 * Returns canonical fact keys directly. Version must increment on any text change.
 */

import type { GeminiExtractionPrompt } from "../types";
import { SYSTEM_PREFIX, RESPONSE_FORMAT_INSTRUCTION } from "./shared";

const PROMPT_VERSION = "gemini_primary_ptr_v2";

const EXPECTED_KEYS = [
  // Page 1 (1040)
  "WAGES_W2",
  "INTEREST_INCOME",
  "DIVIDEND_INCOME",
  "CAPITAL_GAINS",
  "SCHEDULE_C_NET_PROFIT",
  "RENTAL_INCOME_SCHED_E",
  "K1_ORDINARY_INCOME",
  "SOCIAL_SECURITY_INCOME",
  "IRA_DISTRIBUTIONS",
  "TOTAL_INCOME",
  "ADJUSTED_GROSS_INCOME",
  "TAXABLE_INCOME",
  // Schedule C detail
  "SCHEDULE_C_GROSS_RECEIPTS",
  "SCHEDULE_C_COGS",
  "SCHEDULE_C_GROSS_PROFIT",
  "SCHEDULE_C_TOTAL_EXPENSES",
  "SCHEDULE_C_DEPRECIATION",
  "SCHEDULE_C_BUSINESS_NAME",
  // Schedule E detail
  "SCHEDULE_E_GROSS_RENTS",
  "SCHEDULE_E_TOTAL_EXPENSES",
  "SCHEDULE_E_DEPRECIATION",
  "SCHEDULE_E_NET_INCOME",
  // Schedule F
  "SCHEDULE_F_GROSS_INCOME",
  "SCHEDULE_F_NET_PROFIT",
  // K-1 detail
  "K1_ENTITY_NAME",
  "K1_GUARANTEED_PAYMENTS",
  "K1_RENTAL_INCOME",
];

const PTR_INSTRUCTIONS =
  "Extract the following financial data from this personal tax return (Form 1040).\n\n" +
  "Page 1 facts (use the exact keys shown):\n" +
  "- WAGES_W2: Wages, salaries, tips (Line 1)\n" +
  "- INTEREST_INCOME: Taxable interest (Line 2b)\n" +
  "- DIVIDEND_INCOME: Ordinary dividends (Line 3b)\n" +
  "- CAPITAL_GAINS: Capital gain or loss (Line 7)\n" +
  "- SCHEDULE_C_NET_PROFIT: Business income/loss from Schedule C (Line 8)\n" +
  "- RENTAL_INCOME_SCHED_E: Rental real estate, royalties from Schedule E (Line 5 of Schedule E)\n" +
  "- K1_ORDINARY_INCOME: Partnership/S-Corp income from Schedule K-1\n" +
  "- SOCIAL_SECURITY_INCOME: Social security benefits, taxable amount (Line 6b)\n" +
  "- IRA_DISTRIBUTIONS: IRA distributions, taxable amount (Line 4b)\n" +
  "- TOTAL_INCOME: Total income (Line 9)\n" +
  "- ADJUSTED_GROSS_INCOME: Adjusted gross income (Line 11)\n" +
  "- TAXABLE_INCOME: Taxable income (Line 15)\n\n" +
  "Schedule C detail (if present):\n" +
  "- SCHEDULE_C_GROSS_RECEIPTS: Gross receipts or sales (Schedule C, Line 1)\n" +
  "- SCHEDULE_C_COGS: Cost of goods sold (Schedule C, Line 4)\n" +
  "- SCHEDULE_C_GROSS_PROFIT: Gross profit (Schedule C, Line 7)\n" +
  "- SCHEDULE_C_TOTAL_EXPENSES: Total expenses (Schedule C, Line 28)\n" +
  "- SCHEDULE_C_DEPRECIATION: Depreciation (Schedule C, Line 13)\n" +
  "- SCHEDULE_C_BUSINESS_NAME: Business name from Schedule C (as text, not a number)\n\n" +
  "Schedule E detail (if present):\n" +
  "- SCHEDULE_E_GROSS_RENTS: Gross rents received (Schedule E, Line 3)\n" +
  "- SCHEDULE_E_TOTAL_EXPENSES: Total expenses (Schedule E, Line 20)\n" +
  "- SCHEDULE_E_DEPRECIATION: Depreciation (Schedule E, Line 18)\n" +
  "- SCHEDULE_E_NET_INCOME: Net rental income/loss (Schedule E, Line 21)\n\n" +
  "Schedule F detail (if present):\n" +
  "- SCHEDULE_F_GROSS_INCOME: Gross farm income (Schedule F, Line 9)\n" +
  "- SCHEDULE_F_NET_PROFIT: Net farm profit/loss (Schedule F, Line 34)\n\n" +
  "K-1 detail (if present):\n" +
  "- K1_ENTITY_NAME: Entity name from Schedule K-1 (as text, not a number)\n" +
  "- K1_GUARANTEED_PAYMENTS: Guaranteed payments (K-1, Box 4)\n" +
  "- K1_RENTAL_INCOME: Net rental real estate income from K-1 (Box 2)\n\n" +
  "Metadata:\n" +
  "- tax_year: The tax year (e.g. 2023)\n" +
  "- taxpayer_name: Primary taxpayer name\n" +
  "- filing_status: Filing status (e.g. Single, Married Filing Jointly)\n" +
  "- schedule_c_present: true if Schedule C is included, false otherwise\n" +
  "- schedule_e_present: true if Schedule E is included, false otherwise\n" +
  "- schedule_f_present: true if Schedule F is included, false otherwise\n" +
  "- k1_present: true if Schedule K-1 is included, false otherwise\n\n" +
  RESPONSE_FORMAT_INSTRUCTION;

export function buildPersonalTaxReturnPrompt(
  ocrText: string,
): GeminiExtractionPrompt {
  return {
    systemInstruction: SYSTEM_PREFIX,
    promptVersion: PROMPT_VERSION,
    docType: "PERSONAL_TAX_RETURN",
    expectedKeys: EXPECTED_KEYS,
    userPrompt: PTR_INSTRUCTIONS + "\n\nDocument text:\n" + ocrText,
  };
}

export function buildPersonalTaxReturnPromptForPdf(): GeminiExtractionPrompt {
  return {
    systemInstruction: SYSTEM_PREFIX,
    promptVersion: PROMPT_VERSION,
    docType: "PERSONAL_TAX_RETURN",
    expectedKeys: EXPECTED_KEYS,
    userPrompt: PTR_INSTRUCTIONS,
  };
}
