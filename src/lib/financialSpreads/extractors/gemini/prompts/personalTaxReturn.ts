/**
 * Gemini-Primary Prompt — Personal Tax Return (Form 1040)
 *
 * Returns canonical fact keys directly. Version must increment on any text change.
 */

import type { GeminiExtractionPrompt } from "../types";
import { SYSTEM_PREFIX, RESPONSE_FORMAT_INSTRUCTION } from "./shared";

const PROMPT_VERSION = "gemini_primary_ptr_v1";

const EXPECTED_KEYS = [
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
];

const PTR_INSTRUCTIONS =
  "Extract the following financial data from this personal tax return (Form 1040).\n\n" +
  "Monetary facts (use the exact keys shown):\n" +
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
  "Metadata:\n" +
  "- tax_year: The tax year (e.g. 2023)\n" +
  "- taxpayer_name: Primary taxpayer name\n" +
  "- filing_status: Filing status (e.g. Single, Married Filing Jointly)\n\n" +
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
