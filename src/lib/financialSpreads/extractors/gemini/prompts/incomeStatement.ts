/**
 * Gemini-Primary Prompt — Income Statement / P&L / T12
 *
 * Returns canonical fact keys directly. Version must increment on any text change.
 */

import type { GeminiExtractionPrompt } from "../types";
import { SYSTEM_PREFIX, RESPONSE_FORMAT_INSTRUCTION } from "./shared";

const PROMPT_VERSION = "gemini_primary_is_v1";

const EXPECTED_KEYS = [
  "TOTAL_REVENUE",
  "COST_OF_GOODS_SOLD",
  "GROSS_PROFIT",
  "TOTAL_OPERATING_EXPENSES",
  "OPERATING_INCOME",
  "EBITDA",
  "DEPRECIATION",
  "AMORTIZATION",
  "INTEREST_EXPENSE",
  "NET_INCOME",
  "GROSS_RENTAL_INCOME",
  "VACANCY_LOSS",
  "EFFECTIVE_GROSS_INCOME",
  "NET_OPERATING_INCOME",
];

const IS_INSTRUCTIONS =
  "Extract the following financial data from this income statement, P&L, or operating statement.\n\n" +
  "Monetary facts (use the exact keys shown):\n" +
  "- TOTAL_REVENUE: Total revenue, gross revenue, or net sales\n" +
  "- COST_OF_GOODS_SOLD: Cost of goods sold (COGS) or cost of sales\n" +
  "- GROSS_PROFIT: Gross profit (revenue minus COGS)\n" +
  "- TOTAL_OPERATING_EXPENSES: Total operating expenses\n" +
  "- OPERATING_INCOME: Operating income (income from operations)\n" +
  "- EBITDA: EBITDA (if stated explicitly; otherwise use null)\n" +
  "- DEPRECIATION: Depreciation expense\n" +
  "- AMORTIZATION: Amortization expense\n" +
  "- INTEREST_EXPENSE: Interest expense or debt service\n" +
  "- NET_INCOME: Net income or net profit/loss\n" +
  "- GROSS_RENTAL_INCOME: Gross rental income (for CRE properties)\n" +
  "- VACANCY_LOSS: Vacancy and collection loss\n" +
  "- EFFECTIVE_GROSS_INCOME: Effective gross income (EGI)\n" +
  "- NET_OPERATING_INCOME: Net operating income (NOI)\n\n" +
  "Metadata:\n" +
  "- entity_name: Company or property name\n" +
  "- period_start: Period start date (e.g. 2023-01-01)\n" +
  "- period_end: Period end date (e.g. 2023-12-31)\n\n" +
  RESPONSE_FORMAT_INSTRUCTION;

export function buildIncomeStatementPrompt(
  ocrText: string,
): GeminiExtractionPrompt {
  return {
    systemInstruction: SYSTEM_PREFIX,
    promptVersion: PROMPT_VERSION,
    docType: "INCOME_STATEMENT",
    expectedKeys: EXPECTED_KEYS,
    userPrompt: IS_INSTRUCTIONS + "\n\nDocument text:\n" + ocrText,
  };
}

export function buildIncomeStatementPromptForPdf(): GeminiExtractionPrompt {
  return {
    systemInstruction: SYSTEM_PREFIX,
    promptVersion: PROMPT_VERSION,
    docType: "INCOME_STATEMENT",
    expectedKeys: EXPECTED_KEYS,
    userPrompt: IS_INSTRUCTIONS,
  };
}
