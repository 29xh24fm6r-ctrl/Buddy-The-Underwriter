/**
 * Gemini-Primary Prompt — Bank Statement
 *
 * Returns canonical fact keys directly. Version must increment on any text change.
 * v1: Initial — covers standard bank/credit union statement formats. 11 expected keys.
 */

import type { GeminiExtractionPrompt } from "../types";
import { SYSTEM_PREFIX, RESPONSE_FORMAT_INSTRUCTION } from "./shared";

const PROMPT_VERSION = "gemini_primary_bs_stmt_v1";

const EXPECTED_KEYS = [
  "BS_BEGINNING_BALANCE",
  "BS_ENDING_BALANCE",
  "BS_TOTAL_DEPOSITS",
  "BS_TOTAL_WITHDRAWALS",
  "BS_AVERAGE_DAILY_BALANCE",
  "BS_LOWEST_BALANCE",
  "BS_NSF_COUNT",
  "BS_LARGEST_DEPOSIT",
  "BS_LARGEST_WITHDRAWAL",
  "BS_TOTAL_CREDITS",
  "BS_TOTAL_DEBITS",
];

const BANK_STMT_INSTRUCTIONS =
  "Extract the following financial data from this bank statement or credit union statement.\n\n" +

  "── ACCOUNT SUMMARY ──\n" +
  "- BS_BEGINNING_BALANCE: Beginning balance for the statement period\n" +
  "- BS_ENDING_BALANCE: Ending balance for the statement period\n" +
  "- BS_TOTAL_DEPOSITS: Total deposits / credits for the period\n" +
  "- BS_TOTAL_WITHDRAWALS: Total withdrawals / debits for the period\n" +
  "- BS_TOTAL_CREDITS: Total number of credit transactions (count, not dollars). Use null if not stated.\n" +
  "- BS_TOTAL_DEBITS: Total number of debit transactions (count, not dollars). Use null if not stated.\n\n" +

  "── BALANCE METRICS ──\n" +
  "- BS_AVERAGE_DAILY_BALANCE: Average daily balance. If not stated, use null.\n" +
  "- BS_LOWEST_BALANCE: Lowest balance during the period. If not stated, use null.\n\n" +

  "── RISK INDICATORS ──\n" +
  "- BS_NSF_COUNT: Number of NSF (Non-Sufficient Funds), overdraft, or returned item events. " +
  "Look for entries labeled 'NSF', 'OD', 'Overdraft', 'Returned Item', or 'Insufficient Funds'. " +
  "If none found, use 0. If unable to determine, use null.\n\n" +

  "── LARGEST TRANSACTIONS ──\n" +
  "- BS_LARGEST_DEPOSIT: Single largest deposit amount during the period\n" +
  "- BS_LARGEST_WITHDRAWAL: Single largest withdrawal amount during the period (as positive number)\n\n" +

  "Metadata:\n" +
  "- entity_name: Account holder name (business or individual)\n" +
  "- period_start: Statement start date (e.g. 2024-01-01)\n" +
  "- period_end: Statement end date (e.g. 2024-01-31)\n\n" +
  RESPONSE_FORMAT_INSTRUCTION;

export function buildBankStatementPrompt(
  ocrText: string,
): GeminiExtractionPrompt {
  return {
    systemInstruction: SYSTEM_PREFIX,
    promptVersion: PROMPT_VERSION,
    docType: "BANK_STATEMENT",
    expectedKeys: EXPECTED_KEYS,
    userPrompt: BANK_STMT_INSTRUCTIONS + "\n\nDocument text:\n" + ocrText,
  };
}

export function buildBankStatementPromptForPdf(): GeminiExtractionPrompt {
  return {
    systemInstruction: SYSTEM_PREFIX,
    promptVersion: PROMPT_VERSION,
    docType: "BANK_STATEMENT",
    expectedKeys: EXPECTED_KEYS,
    userPrompt: BANK_STMT_INSTRUCTIONS,
  };
}
