/**
 * Gemini-Primary Prompt — Balance Sheet
 *
 * Returns canonical fact keys directly. Version must increment on any text change.
 */

import type { GeminiExtractionPrompt } from "../types";
import {
  SYSTEM_PREFIX,
  RESPONSE_FORMAT_INSTRUCTION,
  EVIDENCE_INSTRUCTION,
} from "./shared";

// v2 (SPEC-SPREAD-SYSTEM-PERFECTION-HARDENING-1 Phase 1): +4 QuickBooks-style
// current-asset / current-liability detail keys + per-fact source-evidence.
const PROMPT_VERSION = "gemini_primary_bs_v2";

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
  // QuickBooks-style current-asset / current-liability detail (Phase 1)
  "SL_OTHER_CURRENT_ASSETS",
  "SL_WAGES_PAYABLE",
  "SL_OPERATING_CURRENT_LIABILITIES",
  "SL_LOANS_FROM_SHAREHOLDERS",
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
  "- TOTAL_CURRENT_LIABILITIES: Total current liabilities\n" +
  "- SL_OTHER_CURRENT_ASSETS: Other current assets (e.g. prepaid expenses, employee advances, undeposited funds — any current asset not cash/AR/inventory)\n" +
  "- SL_WAGES_PAYABLE: Wages / payroll liabilities payable (accrued payroll, payroll taxes payable)\n" +
  "- SL_OPERATING_CURRENT_LIABILITIES: Other current liabilities (current liabilities other than accounts payable — e.g. accrued expenses, credit cards, sales tax payable). NOT long-term debt.\n" +
  "- SL_LOANS_FROM_SHAREHOLDERS: Loans / notes payable to shareholders, owners, or members\n\n" +
  "Metadata:\n" +
  "- entity_name: Company or entity name\n" +
  "- period_start: Balance sheet date (e.g. 2023-12-31)\n" +
  "- period_end: Same as period_start for balance sheets\n\n" +
  RESPONSE_FORMAT_INSTRUCTION +
  EVIDENCE_INSTRUCTION;

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
