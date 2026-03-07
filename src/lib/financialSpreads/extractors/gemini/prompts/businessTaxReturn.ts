/**
 * Gemini-Primary Prompt — Business Tax Return (1120 / 1065 / 1120S)
 *
 * Returns canonical fact keys directly. Version must increment on any text change.
 */

import type { GeminiExtractionPrompt } from "../types";
import { SYSTEM_PREFIX, RESPONSE_FORMAT_INSTRUCTION } from "./shared";

const PROMPT_VERSION = "gemini_primary_btr_v1";

const EXPECTED_KEYS = [
  "GROSS_RECEIPTS",
  "COST_OF_GOODS_SOLD",
  "GROSS_PROFIT",
  "TOTAL_INCOME",
  "OFFICER_COMPENSATION",
  "SALARIES_WAGES",
  "DEPRECIATION",
  "AMORTIZATION",
  "INTEREST_EXPENSE",
  "RENT_EXPENSE",
  "TAXES_PAID",
  "ORDINARY_BUSINESS_INCOME",
  "NET_INCOME",
  "NET_RENTAL_RE_INCOME",
  "GUARANTEED_PAYMENTS",
  "DISTRIBUTIONS",
  "SL_TOTAL_ASSETS",
  "SL_TOTAL_LIABILITIES",
  "SL_TOTAL_EQUITY",
  "SL_RETAINED_EARNINGS",
  "SL_CASH",
  "SL_AR_GROSS",
  "SL_INVENTORY",
  "SL_ACCOUNTS_PAYABLE",
  "SL_MORTGAGES_NOTES_BONDS",
  "M1_BOOK_INCOME",
  "M1_TAXABLE_INCOME",
];

export function buildBusinessTaxReturnPrompt(
  ocrText: string,
): GeminiExtractionPrompt {
  return {
    systemInstruction: SYSTEM_PREFIX,
    promptVersion: PROMPT_VERSION,
    docType: "BUSINESS_TAX_RETURN",
    expectedKeys: EXPECTED_KEYS,
    userPrompt:
      "Extract the following financial data from this business tax return (Form 1120, 1065, or 1120S).\n\n" +
      "Monetary facts (use the exact keys shown):\n" +
      "- GROSS_RECEIPTS: Gross receipts or sales (Line 1a/1c)\n" +
      "- COST_OF_GOODS_SOLD: Cost of goods sold (Line 2)\n" +
      "- GROSS_PROFIT: Gross profit (Line 3)\n" +
      "- TOTAL_INCOME: Total income (Line 6 or 11)\n" +
      "- OFFICER_COMPENSATION: Compensation of officers (Line 12)\n" +
      "- SALARIES_WAGES: Salaries and wages (Line 13)\n" +
      "- DEPRECIATION: Depreciation (Line 20)\n" +
      "- AMORTIZATION: Amortization (Line 22, if present)\n" +
      "- INTEREST_EXPENSE: Interest paid or accrued (Line 18)\n" +
      "- RENT_EXPENSE: Rents (Line 16)\n" +
      "- TAXES_PAID: Taxes and licenses (Line 17)\n" +
      "- ORDINARY_BUSINESS_INCOME: Ordinary business income/loss (Line 21 or 22)\n" +
      "- NET_INCOME: Net income (taxable income before NOL, Line 30 on 1120)\n" +
      "- NET_RENTAL_RE_INCOME: Net rental real estate income (from Schedule K)\n" +
      "- GUARANTEED_PAYMENTS: Guaranteed payments to partners (1065 only, Schedule K)\n" +
      "- DISTRIBUTIONS: Distributions paid (Schedule K or M-2)\n" +
      "- SL_TOTAL_ASSETS: Total assets from Schedule L (end of year)\n" +
      "- SL_TOTAL_LIABILITIES: Total liabilities from Schedule L (end of year)\n" +
      "- SL_TOTAL_EQUITY: Total equity / partners capital from Schedule L (end of year)\n" +
      "- SL_RETAINED_EARNINGS: Retained earnings from Schedule L (end of year)\n" +
      "- SL_CASH: Cash from Schedule L (end of year)\n" +
      "- SL_AR_GROSS: Trade notes and accounts receivable from Schedule L\n" +
      "- SL_INVENTORY: Inventories from Schedule L\n" +
      "- SL_ACCOUNTS_PAYABLE: Accounts payable from Schedule L\n" +
      "- SL_MORTGAGES_NOTES_BONDS: Mortgages, notes, bonds payable from Schedule L\n" +
      "- M1_BOOK_INCOME: Net income per books from Schedule M-1 (Line 1)\n" +
      "- M1_TAXABLE_INCOME: Income on return from Schedule M-1 (Line 10)\n\n" +
      "Metadata:\n" +
      "- tax_year: The tax year (e.g. 2023)\n" +
      "- ein: Employer Identification Number (XX-XXXXXXX)\n" +
      "- entity_name: Business name\n" +
      "- form_type: IRS form number (1120, 1065, or 1120S)\n\n" +
      RESPONSE_FORMAT_INSTRUCTION +
      "\n\nDocument text:\n" +
      ocrText,
  };
}
