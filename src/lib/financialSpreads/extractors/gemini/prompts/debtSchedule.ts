/**
 * Gemini-Primary Prompt — Debt Schedule / Schedule of Existing Obligations
 *
 * Returns canonical fact keys directly. Version must increment on any text change.
 * v1: Initial — covers SBA debt schedules, bank obligation summaries. 10 expected keys.
 */

import type { GeminiExtractionPrompt } from "../types";
import { SYSTEM_PREFIX, RESPONSE_FORMAT_INSTRUCTION } from "./shared";

const PROMPT_VERSION = "gemini_primary_debt_sched_v1";

const EXPECTED_KEYS = [
  "DEBT_CREDITOR_COUNT",
  "DEBT_TOTAL_ORIGINAL_AMOUNT",
  "DEBT_TOTAL_CURRENT_BALANCE",
  "DEBT_TOTAL_MONTHLY_PAYMENT",
  "DEBT_TOTAL_ANNUAL_PAYMENT",
  "DEBT_HIGHEST_RATE",
  "DEBT_LOWEST_RATE",
  "DEBT_WEIGHTED_AVG_RATE",
  "DEBT_SECURED_BALANCE",
  "DEBT_UNSECURED_BALANCE",
];

const DEBT_SCHED_INSTRUCTIONS =
  "Extract the following financial data from this debt schedule, schedule of existing obligations, " +
  "or schedule of liabilities.\n\n" +

  "This document typically lists all outstanding loans/debts with creditor name, original amount, " +
  "current balance, monthly payment, interest rate, maturity date, and collateral.\n\n" +

  "── AGGREGATE TOTALS ──\n" +
  "- DEBT_CREDITOR_COUNT: Total number of creditors/loans listed\n" +
  "- DEBT_TOTAL_ORIGINAL_AMOUNT: Sum of all original loan amounts\n" +
  "- DEBT_TOTAL_CURRENT_BALANCE: Sum of all current balances. If a 'Total' row exists, use that.\n" +
  "- DEBT_TOTAL_MONTHLY_PAYMENT: Sum of all monthly payments. If a 'Total' row exists, use that.\n" +
  "- DEBT_TOTAL_ANNUAL_PAYMENT: Total annual debt service (monthly × 12 if not stated)\n\n" +

  "── RATE ANALYSIS ──\n" +
  "- DEBT_HIGHEST_RATE: Highest interest rate among all loans (as decimal, e.g. 0.075 for 7.5%)\n" +
  "- DEBT_LOWEST_RATE: Lowest interest rate among all loans (as decimal)\n" +
  "- DEBT_WEIGHTED_AVG_RATE: Weighted average interest rate across all loans by balance. " +
  "If not stated, compute: sum(balance_i × rate_i) / total_balance. Use null if rates not available.\n\n" +

  "── COLLATERAL BREAKDOWN ──\n" +
  "- DEBT_SECURED_BALANCE: Total balance of secured obligations (those listing collateral)\n" +
  "- DEBT_UNSECURED_BALANCE: Total balance of unsecured obligations (no collateral listed)\n\n" +

  "Metadata:\n" +
  "- entity_name: Borrower or business name\n" +
  "- period_end: Date of the schedule (e.g. 2024-12-31)\n" +
  "- form_type: 'Debt Schedule' or 'Schedule of Existing Obligations'\n\n" +
  RESPONSE_FORMAT_INSTRUCTION;

export function buildDebtSchedulePrompt(
  ocrText: string,
): GeminiExtractionPrompt {
  return {
    systemInstruction: SYSTEM_PREFIX,
    promptVersion: PROMPT_VERSION,
    docType: "DEBT_SCHEDULE",
    expectedKeys: EXPECTED_KEYS,
    userPrompt: DEBT_SCHED_INSTRUCTIONS + "\n\nDocument text:\n" + ocrText,
  };
}

export function buildDebtSchedulePromptForPdf(): GeminiExtractionPrompt {
  return {
    systemInstruction: SYSTEM_PREFIX,
    promptVersion: PROMPT_VERSION,
    docType: "DEBT_SCHEDULE",
    expectedKeys: EXPECTED_KEYS,
    userPrompt: DEBT_SCHED_INSTRUCTIONS,
  };
}
