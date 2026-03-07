/**
 * Gemini-Primary Prompt — Personal Financial Statement (SBA 413 / Bank PFS)
 *
 * Returns canonical fact keys directly. Version must increment on any text change.
 * v1: Initial — covers SBA 413 format and common bank PFS formats. 44 expected keys.
 */

import type { GeminiExtractionPrompt } from "../types";
import { SYSTEM_PREFIX, RESPONSE_FORMAT_INSTRUCTION } from "./shared";

const PROMPT_VERSION = "gemini_primary_pfs_v1";

const EXPECTED_KEYS = [
  // ── Assets ──────────────────────────────────────────────────────────
  "PFS_CASH_CHECKING",
  "PFS_CASH_SAVINGS",
  "PFS_CASH_OTHER",
  "PFS_CASH_TOTAL",
  "PFS_IRA_401K",
  "PFS_LIFE_INS_CSV",
  "PFS_ACCOUNTS_NOTES_REC",
  "PFS_REAL_ESTATE_MV",
  "PFS_STOCKS_BONDS",
  "PFS_AUTOMOBILES",
  "PFS_BUSINESS_INTERESTS",
  "PFS_OTHER_ASSETS",
  "PFS_TOTAL_ASSETS",

  // ── Liabilities ──────────────────────────────────────────────────────
  "PFS_MORTGAGE_BALANCE",
  "PFS_MORTGAGE_PAYMENT_MO",
  "PFS_NOTES_PAYABLE_BANKS",
  "PFS_NOTES_PAYABLE_PAYMENT",
  "PFS_INSTALLMENT_AUTO_BAL",
  "PFS_INSTALLMENT_AUTO_PMT",
  "PFS_INSTALLMENT_OTHER_BAL",
  "PFS_INSTALLMENT_OTHER_PMT",
  "PFS_LIFE_INS_LOAN",
  "PFS_UNPAID_TAXES",
  "PFS_CONTINGENT_LIABILITIES",
  "PFS_OTHER_LIABILITIES",
  "PFS_TOTAL_LIABILITIES",

  // ── Net Worth ────────────────────────────────────────────────────────
  "PFS_NET_WORTH",

  // ── Income ───────────────────────────────────────────────────────────
  "PFS_SALARY_WAGES",
  "PFS_NET_INVESTMENT_INCOME",
  "PFS_REAL_ESTATE_INCOME",
  "PFS_OTHER_INCOME",
  "PFS_TOTAL_ANNUAL_INCOME",

  // ── Real Estate Schedule (first/primary property) ────────────────────
  "PFS_RE1_PURCHASE_PRICE",
  "PFS_RE1_PRESENT_MV",
  "PFS_RE1_MORTGAGE_BALANCE",
  "PFS_RE1_MONTHLY_PAYMENT",

  // ── Schedule of Notes Payable (first note) ───────────────────────────
  "PFS_NOTE1_ORIGINAL",
  "PFS_NOTE1_BALANCE",
  "PFS_NOTE1_PAYMENT_MO",

  // ── Liquidity Computed ───────────────────────────────────────────────
  "PFS_LIQUID_ASSETS",
  "PFS_LIQUID_RATIO",
];

const PFS_INSTRUCTIONS =
  "Extract the following financial data from this Personal Financial Statement (SBA Form 413 or bank PFS form).\n\n" +

  "── ASSETS ──\n" +
  "- PFS_CASH_CHECKING: Cash in checking accounts\n" +
  "- PFS_CASH_SAVINGS: Cash in savings accounts\n" +
  "- PFS_CASH_OTHER: Other cash or cash equivalents\n" +
  "- PFS_CASH_TOTAL: Total cash and equivalents (sum of above if not stated)\n" +
  "- PFS_IRA_401K: IRA / 401(k) / retirement account value\n" +
  "- PFS_LIFE_INS_CSV: Life insurance — cash surrender value\n" +
  "- PFS_ACCOUNTS_NOTES_REC: Accounts and notes receivable\n" +
  "- PFS_REAL_ESTATE_MV: Real estate — present market value (total all properties)\n" +
  "- PFS_STOCKS_BONDS: Stocks, bonds, and other securities (market value)\n" +
  "- PFS_AUTOMOBILES: Automobiles (market value)\n" +
  "- PFS_BUSINESS_INTERESTS: Business interests (estimated market value)\n" +
  "- PFS_OTHER_ASSETS: Other assets\n" +
  "- PFS_TOTAL_ASSETS: Total assets\n\n" +

  "── LIABILITIES ──\n" +
  "- PFS_MORTGAGE_BALANCE: Total outstanding mortgage balances (all real estate)\n" +
  "- PFS_MORTGAGE_PAYMENT_MO: Total monthly mortgage payments\n" +
  "- PFS_NOTES_PAYABLE_BANKS: Notes payable to banks and others — total balance\n" +
  "- PFS_NOTES_PAYABLE_PAYMENT: Monthly payment on notes payable to banks\n" +
  "- PFS_INSTALLMENT_AUTO_BAL: Installment auto loan — balance\n" +
  "- PFS_INSTALLMENT_AUTO_PMT: Installment auto loan — monthly payment\n" +
  "- PFS_INSTALLMENT_OTHER_BAL: Other installment loans — balance\n" +
  "- PFS_INSTALLMENT_OTHER_PMT: Other installment loans — monthly payment\n" +
  "- PFS_LIFE_INS_LOAN: Loan on life insurance policy\n" +
  "- PFS_UNPAID_TAXES: Unpaid taxes (any amounts owed but not yet paid)\n" +
  "- PFS_CONTINGENT_LIABILITIES: Contingent liabilities (endorsements, guarantees, lawsuits)\n" +
  "- PFS_OTHER_LIABILITIES: Other liabilities\n" +
  "- PFS_TOTAL_LIABILITIES: Total liabilities\n\n" +

  "── NET WORTH ──\n" +
  "- PFS_NET_WORTH: Net worth (Total Assets minus Total Liabilities). If stated on the form, use that. If not, compute it.\n\n" +

  "── INCOME ──\n" +
  "- PFS_SALARY_WAGES: Annual salary and wages\n" +
  "- PFS_NET_INVESTMENT_INCOME: Net investment income\n" +
  "- PFS_REAL_ESTATE_INCOME: Net real estate income\n" +
  "- PFS_OTHER_INCOME: Other income\n" +
  "- PFS_TOTAL_ANNUAL_INCOME: Total annual income (sum if not stated)\n\n" +

  "── REAL ESTATE SCHEDULE (first/primary property listed) ──\n" +
  "- PFS_RE1_PURCHASE_PRICE: Original purchase price\n" +
  "- PFS_RE1_PRESENT_MV: Present market value\n" +
  "- PFS_RE1_MORTGAGE_BALANCE: Outstanding mortgage balance\n" +
  "- PFS_RE1_MONTHLY_PAYMENT: Monthly payment\n\n" +

  "── NOTES PAYABLE SCHEDULE (first note listed) ──\n" +
  "- PFS_NOTE1_ORIGINAL: Original amount of loan\n" +
  "- PFS_NOTE1_BALANCE: Current balance\n" +
  "- PFS_NOTE1_PAYMENT_MO: Monthly payment\n\n" +

  "── COMPUTED LIQUIDITY (compute these if not stated) ──\n" +
  "- PFS_LIQUID_ASSETS: Liquid assets = PFS_CASH_TOTAL + PFS_STOCKS_BONDS (if easily marketable)\n" +
  "- PFS_LIQUID_RATIO: Liquid assets / Total liabilities (as decimal, e.g. 0.45). Use null if total liabilities is zero.\n\n" +

  "Metadata:\n" +
  "- taxpayer_name: Name of the individual completing the PFS\n" +
  "- period_end: Date of the PFS (e.g. 2024-06-30)\n" +
  "- form_type: Form type (e.g. SBA 413, or 'Bank PFS')\n\n" +
  RESPONSE_FORMAT_INSTRUCTION;

export function buildPfsPrompt(
  ocrText: string,
): GeminiExtractionPrompt {
  return {
    systemInstruction: SYSTEM_PREFIX,
    promptVersion: PROMPT_VERSION,
    docType: "PFS",
    expectedKeys: EXPECTED_KEYS,
    userPrompt: PFS_INSTRUCTIONS + "\n\nDocument text:\n" + ocrText,
  };
}

export function buildPfsPromptForPdf(): GeminiExtractionPrompt {
  return {
    systemInstruction: SYSTEM_PREFIX,
    promptVersion: PROMPT_VERSION,
    docType: "PFS",
    expectedKeys: EXPECTED_KEYS,
    userPrompt: PFS_INSTRUCTIONS,
  };
}
