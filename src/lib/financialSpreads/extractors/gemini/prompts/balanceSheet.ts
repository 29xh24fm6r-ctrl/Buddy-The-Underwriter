/**
 * Gemini-Primary Prompt — Balance Sheet
 *
 * Returns canonical fact keys directly. Version must increment on any text change.
 */

import type { GeminiExtractionPrompt } from "../types";
import { SYSTEM_PREFIX, RESPONSE_FORMAT_INSTRUCTION } from "./shared";

const PROMPT_VERSION = "gemini_primary_bs_v1";

const EXPECTED_KEYS = [
  "SL_CASH",
  "SL_AR_GROSS",
  "SL_INVENTORY",
  "SL_PPE_GROSS",
  "SL_ACCUMULATED_DEPRECIATION",
  "SL_LAND",
  "SL_TOTAL_ASSETS",
  "SL_ACCOUNTS_PAYABLE",
  "SL_MORTGAGES_NOTES_BONDS",
  "SL_TOTAL_LIABILITIES",
  "SL_RETAINED_EARNINGS",
  "SL_TOTAL_EQUITY",
  "TOTAL_CURRENT_ASSETS",
  "TOTAL_CURRENT_LIABILITIES",
];

const BS_INSTRUCTIONS =
  "Extract the following financial data from this balance sheet.\n\n" +
  "Monetary facts (use the exact keys shown):\n" +
  "- SL_CASH: Cash and cash equivalents\n" +
  "- SL_AR_GROSS: Accounts receivable (trade notes and accounts receivable)\n" +
  "- SL_INVENTORY: Inventory\n" +
  "- SL_PPE_GROSS: Property, plant and equipment (gross / before depreciation)\n" +
  "- SL_ACCUMULATED_DEPRECIATION: Accumulated depreciation (as a positive number)\n" +
  "- SL_LAND: Land\n" +
  "- SL_TOTAL_ASSETS: Total assets\n" +
  "- SL_ACCOUNTS_PAYABLE: Accounts payable\n" +
  "- SL_MORTGAGES_NOTES_BONDS: Mortgages, notes payable, bonds payable (long-term debt)\n" +
  "- SL_TOTAL_LIABILITIES: Total liabilities\n" +
  "- SL_RETAINED_EARNINGS: Retained earnings (or partners capital / members equity)\n" +
  "- SL_TOTAL_EQUITY: Total stockholders equity (or total partners capital)\n" +
  "- TOTAL_CURRENT_ASSETS: Total current assets\n" +
  "- TOTAL_CURRENT_LIABILITIES: Total current liabilities\n\n" +
  "Metadata:\n" +
  "- entity_name: Company or entity name\n" +
  "- period_start: Balance sheet date (e.g. 2023-12-31)\n" +
  "- period_end: Same as period_start for balance sheets\n\n" +
  RESPONSE_FORMAT_INSTRUCTION;

export function buildBalanceSheetPrompt(
  ocrText: string,
): GeminiExtractionPrompt {
  return {
    systemInstruction: SYSTEM_PREFIX,
    promptVersion: PROMPT_VERSION,
    docType: "BALANCE_SHEET",
    expectedKeys: EXPECTED_KEYS,
    userPrompt: BS_INSTRUCTIONS + "\n\nDocument text:\n" + ocrText,
  };
}

export function buildBalanceSheetPromptForPdf(): GeminiExtractionPrompt {
  return {
    systemInstruction: SYSTEM_PREFIX,
    promptVersion: PROMPT_VERSION,
    docType: "BALANCE_SHEET",
    expectedKeys: EXPECTED_KEYS,
    userPrompt: BS_INSTRUCTIONS,
  };
}
