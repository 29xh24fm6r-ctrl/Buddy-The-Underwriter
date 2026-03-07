/**
 * Gemini-Primary Prompt — Business Tax Return (1120 / 1065 / 1120S)
 *
 * Returns canonical fact keys directly. Version must increment on any text change.
 * v2: +3 SL_* (Gap A), +13 SK_* (Gap B), +8 S_AAA/S_TAX (Gap C), +8 M2_* (Gap D)
 * 59 total expected keys. Shadow-mode smoke-test threshold: >= 55 keys extracted.
 */

import type { GeminiExtractionPrompt } from "../types";
import { SYSTEM_PREFIX, RESPONSE_FORMAT_INSTRUCTION } from "./shared";

const PROMPT_VERSION = "gemini_primary_btr_v2";

const EXPECTED_KEYS = [
  // ── Main Body (16) ──────────────────────────────────────────────────
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

  // ── Schedule L — Balance Sheet (12) ─────────────────────────────────
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

  // ── Schedule M-1 — Book/Tax Reconciliation (2) ─────────────────────
  "M1_BOOK_INCOME",
  "M1_TAXABLE_INCOME",

  // ── Schedule K — Entity-Level Summary (13) ──────────────────────────
  "SK_ORDINARY_INCOME",
  "SK_NET_RENTAL_RE",
  "SK_GUARANTEED_PAYMENTS",
  "SK_INTEREST_INCOME",
  "SK_DIVIDENDS",
  "SK_ROYALTIES",
  "SK_NET_ST_CAPITAL_GAIN",
  "SK_NET_LT_CAPITAL_GAIN",
  "SK_NET_SECTION_1231_GAIN",
  "SK_OTHER_INCOME",
  "SK_CHARITABLE_CONTRIBUTIONS",
  "SK_SECTION_179_DEDUCTION",
  "SK_TOTAL_DISTRIBUTIONS",

  // ── Schedule M-2 — Capital Account Reconciliation (8) ──────────────
  "M2_BALANCE_BOY",
  "M2_NET_INCOME",
  "M2_OTHER_INCREASES",
  "M2_TOTAL_INCREASES",
  "M2_DISTRIBUTIONS",
  "M2_OTHER_DECREASES",
  "M2_TOTAL_DECREASES",
  "M2_BALANCE_EOY",

  // ── 1120S — Accumulated Adjustments Account (6) ────────────────────
  "S_AAA_BOY",
  "S_AAA_ORDINARY_INCOME",
  "S_AAA_OTHER_ADDITIONS",
  "S_AAA_DISTRIBUTIONS",
  "S_AAA_OTHER_REDUCTIONS",
  "S_AAA_EOY",

  // ── 1120S — Entity-Level Taxes (2) ─────────────────────────────────
  "S_TAX_BUILT_IN_GAINS",
  "S_TAX_EXCESS_NET_PASSIVE",
];

const BTR_INSTRUCTIONS =
  "Extract the following financial data from this business tax return (Form 1120, 1065, or 1120S).\n\n" +

  "── MAIN BODY ──\n" +
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
  "- DISTRIBUTIONS: Distributions paid (Schedule K or M-2)\n\n" +

  "── SCHEDULE L — Balance Sheet (end-of-year column) ──\n" +
  "- SL_CASH: Cash from Schedule L\n" +
  "- SL_AR_GROSS: Trade notes and accounts receivable from Schedule L\n" +
  "- SL_INVENTORY: Inventories from Schedule L\n" +
  "- SL_PPE_GROSS: Buildings and other depreciable assets (gross, before depreciation) from Schedule L\n" +
  "- SL_ACCUMULATED_DEPRECIATION: Less accumulated depreciation from Schedule L (as a positive number)\n" +
  "- SL_LAND: Land (net of any amortization) from Schedule L\n" +
  "- SL_TOTAL_ASSETS: Total assets from Schedule L\n" +
  "- SL_ACCOUNTS_PAYABLE: Accounts payable from Schedule L\n" +
  "- SL_MORTGAGES_NOTES_BONDS: Mortgages, notes, bonds payable (>1 yr) from Schedule L\n" +
  "- SL_TOTAL_LIABILITIES: Total liabilities from Schedule L\n" +
  "- SL_RETAINED_EARNINGS: Retained earnings (or partners capital) from Schedule L\n" +
  "- SL_TOTAL_EQUITY: Total equity / partners capital from Schedule L\n\n" +

  "── SCHEDULE M-1 — Book/Tax Reconciliation ──\n" +
  "- M1_BOOK_INCOME: Net income per books (Line 1)\n" +
  "- M1_TAXABLE_INCOME: Income on return (Line 10)\n\n" +

  "── SCHEDULE K — Entity-Level Summary (1065/1120S) ──\n" +
  "- SK_ORDINARY_INCOME: Ordinary business income/loss (Schedule K Line 1)\n" +
  "- SK_NET_RENTAL_RE: Net rental real estate income/loss (Schedule K Line 2)\n" +
  "- SK_GUARANTEED_PAYMENTS: Guaranteed payments (Schedule K Line 4)\n" +
  "- SK_INTEREST_INCOME: Interest income (Schedule K Line 5)\n" +
  "- SK_DIVIDENDS: Ordinary dividends (Schedule K Line 6a)\n" +
  "- SK_ROYALTIES: Royalties (Schedule K Line 7)\n" +
  "- SK_NET_ST_CAPITAL_GAIN: Net short-term capital gain/loss (Schedule K Line 8)\n" +
  "- SK_NET_LT_CAPITAL_GAIN: Net long-term capital gain/loss (Schedule K Line 9a)\n" +
  "- SK_NET_SECTION_1231_GAIN: Net section 1231 gain/loss (Schedule K Line 10)\n" +
  "- SK_OTHER_INCOME: Other income/loss (Schedule K Line 11)\n" +
  "- SK_CHARITABLE_CONTRIBUTIONS: Charitable contributions (Schedule K Line 12)\n" +
  "- SK_SECTION_179_DEDUCTION: Section 179 deduction (Schedule K Line 11/12)\n" +
  "- SK_TOTAL_DISTRIBUTIONS: Total distributions (Schedule K Line 19a for 1065, or Line 16d for 1120S)\n\n" +

  "── SCHEDULE M-2 — Capital Account Reconciliation (1065/1120S) ──\n" +
  "- M2_BALANCE_BOY: Balance at beginning of year\n" +
  "- M2_NET_INCOME: Net income per books\n" +
  "- M2_OTHER_INCREASES: Other increases\n" +
  "- M2_TOTAL_INCREASES: Total of increases (M2 sum line)\n" +
  "- M2_DISTRIBUTIONS: Distributions (cash + property)\n" +
  "- M2_OTHER_DECREASES: Other decreases\n" +
  "- M2_TOTAL_DECREASES: Total of decreases\n" +
  "- M2_BALANCE_EOY: Balance at end of year\n\n" +

  "── 1120S ONLY — Accumulated Adjustments Account (AAA) ──\n" +
  "If the return is Form 1120S and an AAA schedule is present:\n" +
  "- S_AAA_BOY: AAA balance at beginning of year\n" +
  "- S_AAA_ORDINARY_INCOME: Ordinary income added to AAA\n" +
  "- S_AAA_OTHER_ADDITIONS: Other additions to AAA\n" +
  "- S_AAA_DISTRIBUTIONS: Distributions reducing AAA\n" +
  "- S_AAA_OTHER_REDUCTIONS: Other reductions to AAA\n" +
  "- S_AAA_EOY: AAA balance at end of year\n" +
  "If not an 1120S or no AAA schedule present, use null for all S_AAA_* keys.\n\n" +

  "── 1120S ONLY — Entity-Level Taxes ──\n" +
  "- S_TAX_BUILT_IN_GAINS: Built-in gains tax (Form 1120S, Schedule D / Line 22b)\n" +
  "- S_TAX_EXCESS_NET_PASSIVE: Excess net passive income tax (Form 1120S, Line 22a)\n" +
  "If not an 1120S, use null for all S_TAX_* keys.\n\n" +

  "Metadata:\n" +
  "- tax_year: The tax year (e.g. 2023)\n" +
  "- ein: Employer Identification Number (XX-XXXXXXX)\n" +
  "- entity_name: Business name\n" +
  "- form_type: IRS form number (1120, 1065, or 1120S)\n\n" +
  RESPONSE_FORMAT_INSTRUCTION;

export function buildBusinessTaxReturnPrompt(
  ocrText: string,
): GeminiExtractionPrompt {
  return {
    systemInstruction: SYSTEM_PREFIX,
    promptVersion: PROMPT_VERSION,
    docType: "BUSINESS_TAX_RETURN",
    expectedKeys: EXPECTED_KEYS,
    userPrompt: BTR_INSTRUCTIONS + "\n\nDocument text:\n" + ocrText,
  };
}

export function buildBusinessTaxReturnPromptForPdf(): GeminiExtractionPrompt {
  return {
    systemInstruction: SYSTEM_PREFIX,
    promptVersion: PROMPT_VERSION,
    docType: "BUSINESS_TAX_RETURN",
    expectedKeys: EXPECTED_KEYS,
    userPrompt: BTR_INSTRUCTIONS,
  };
}
