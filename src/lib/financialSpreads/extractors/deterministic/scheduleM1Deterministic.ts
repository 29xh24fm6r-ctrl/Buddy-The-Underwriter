/**
 * Schedule M-1 Deterministic Extractor — Book-Tax Reconciliation
 *
 * Extracts all M-1 lines (book income to taxable income reconciliation)
 * per God Tier Phase 2 spec Layer 1/4E.
 * Pure deterministic extraction — regex, no LLMs.
 */

import type {
  DeterministicExtractorArgs,
  PureDeterministicResult,
  PureLineItem,
  ExtractionPath,
} from "./types";
import { parseMoney, resolveDocTaxYear } from "./parseUtils";
import { extractFormFields } from "./structuredJsonParser";

// ---------------------------------------------------------------------------
// Valid keys
// ---------------------------------------------------------------------------

const VALID_LINE_KEYS = new Set([
  // M-1
  "M1_BOOK_INCOME",
  "M1_FEDERAL_TAX_BOOK",
  "M1_EXCESS_CAP_LOSS",
  "M1_INCOME_NOT_ON_BOOKS",
  "M1_DEPR_BOOK_TAX_DIFF",
  "M1_AMORT_BOOK_TAX_DIFF",
  "M1_DEPLETION_DIFF",
  "M1_OTHER_BOOK_ADDITIONS",
  "M1_TOTAL_ADDITIONS",
  "M1_INCOME_BOOK_NOT_TAX",
  "M1_EXPENSE_BOOK_NOT_DEDUCTED",
  "M1_OTHER_REDUCTIONS",
  "M1_TAXABLE_INCOME",
  // M-2
  "M2_RETAINED_EARNINGS_BEGIN",
  "M2_NET_INCOME_BOOKS",
  "M2_OTHER_INCREASES",
  "M2_DISTRIBUTIONS",
  "M2_OTHER_DECREASES",
  "M2_RETAINED_EARNINGS_END",
]);

// ---------------------------------------------------------------------------
// Patterns — Schedule M-1
// ---------------------------------------------------------------------------

type LinePattern = { key: string; pattern: RegExp };

const M1_PATTERNS: LinePattern[] = [
  // Line 1 — Net income per books
  { key: "M1_BOOK_INCOME", pattern: /(?:line\s+1\b|net\s+income.*?per\s+books).*?(\(?-?\$?\d[\d,]*(?:\.\d{0,2})?\)?)/i },
  // Line 2 — Federal income tax per books
  { key: "M1_FEDERAL_TAX_BOOK", pattern: /(?:line\s+2\b|federal\s+income\s+tax\s+per\s+books?).*?(\(?-?\$?\d[\d,]*(?:\.\d{0,2})?\)?)/i },
  // Line 3 — Excess capital losses
  { key: "M1_EXCESS_CAP_LOSS", pattern: /(?:line\s+3\b|excess.*?capital\s+loss).*?(\(?-?\$?\d[\d,]*(?:\.\d{0,2})?\)?)/i },
  // Line 4 — Income subject to tax not on books
  { key: "M1_INCOME_NOT_ON_BOOKS", pattern: /(?:line\s+4\b|income\s+subject\s+to\s+tax\s+not\s+on\s+books?).*?(\(?-?\$?\d[\d,]*(?:\.\d{0,2})?\)?)/i },
  // Line 5a — Depreciation book vs tax diff
  { key: "M1_DEPR_BOOK_TAX_DIFF", pattern: /(?:line\s+5a?\b|depreciation).*?(\(?-?\$?\d[\d,]*(?:\.\d{0,2})?\)?)/i },
  // Line 5b — Amortization diff
  { key: "M1_AMORT_BOOK_TAX_DIFF", pattern: /(?:line\s+5b\b|amortization).*?(\(?-?\$?\d[\d,]*(?:\.\d{0,2})?\)?)/i },
  // Line 5c — Depletion
  { key: "M1_DEPLETION_DIFF", pattern: /(?:line\s+5c\b|depletion).*?(\(?-?\$?\d[\d,]*(?:\.\d{0,2})?\)?)/i },
  // Line 5d — Other
  { key: "M1_OTHER_BOOK_ADDITIONS", pattern: /(?:line\s+5d\b).*?(\(?-?\$?\d[\d,]*(?:\.\d{0,2})?\)?)/i },
  // Line 6 — Total
  { key: "M1_TOTAL_ADDITIONS", pattern: /(?:line\s+6\b|total.*?line[s]?\s+1.*?5).*?(\(?-?\$?\d[\d,]*(?:\.\d{0,2})?\)?)/i },
  // Line 7a — Income on books not taxed
  { key: "M1_INCOME_BOOK_NOT_TAX", pattern: /(?:line\s+7a?\b|income\s+recorded\s+on\s+books?\s+not.*?tax).*?(\(?-?\$?\d[\d,]*(?:\.\d{0,2})?\)?)/i },
  // Line 7b — Expenses on books not deducted
  { key: "M1_EXPENSE_BOOK_NOT_DEDUCTED", pattern: /(?:line\s+7b\b|expenses?\s+on\s+books?\s+not\s+deducted).*?(\(?-?\$?\d[\d,]*(?:\.\d{0,2})?\)?)/i },
  // Line 7c — Other reductions
  { key: "M1_OTHER_REDUCTIONS", pattern: /(?:line\s+7c\b|other\s+reductions?).*?(\(?-?\$?\d[\d,]*(?:\.\d{0,2})?\)?)/i },
  // Line 8 — Taxable income
  { key: "M1_TAXABLE_INCOME", pattern: /(?:line\s+8\b|taxable\s+income).*?(\(?-?\$?\d[\d,]*(?:\.\d{0,2})?\)?)/i },
];

// ---------------------------------------------------------------------------
// Patterns — Schedule M-2
// ---------------------------------------------------------------------------

const M2_PATTERNS: LinePattern[] = [
  { key: "M2_RETAINED_EARNINGS_BEGIN", pattern: /(?:m-?2.*?line\s+1\b|balance.*?beginning\s+of\s+year).*?(\(?-?\$?\d[\d,]*(?:\.\d{0,2})?\)?)/i },
  { key: "M2_NET_INCOME_BOOKS", pattern: /(?:m-?2.*?line\s+2\b|net\s+income.*?per\s+books).*?(\(?-?\$?\d[\d,]*(?:\.\d{0,2})?\)?)/i },
  { key: "M2_OTHER_INCREASES", pattern: /(?:m-?2.*?line\s+3\b|other\s+increases).*?(\(?-?\$?\d[\d,]*(?:\.\d{0,2})?\)?)/i },
  { key: "M2_DISTRIBUTIONS", pattern: /(?:m-?2.*?line\s+5\b|distributions?).*?(\(?-?\$?\d[\d,]*(?:\.\d{0,2})?\)?)/i },
  { key: "M2_OTHER_DECREASES", pattern: /(?:m-?2.*?line\s+6\b|other\s+decreases).*?(\(?-?\$?\d[\d,]*(?:\.\d{0,2})?\)?)/i },
  { key: "M2_RETAINED_EARNINGS_END", pattern: /(?:m-?2.*?line\s+7\b|balance.*?end\s+of\s+year).*?(\(?-?\$?\d[\d,]*(?:\.\d{0,2})?\)?)/i },
];

// ---------------------------------------------------------------------------
// Main extractor
// ---------------------------------------------------------------------------

export function extractScheduleM1(
  args: DeterministicExtractorArgs,
): PureDeterministicResult {
  const { ocrText, structuredJson, docYear } = args;
  const items: PureLineItem[] = [];
  let extractionPath: ExtractionPath = "ocr_regex";
  let factsAttempted = 0;

  const taxYear = resolveDocTaxYear(ocrText, docYear);
  const period = taxYear ? String(taxYear) : null;

  const allPatterns = [...M1_PATTERNS, ...M2_PATTERNS];

  // -- Structured JSON --
  if (structuredJson) {
    const formFields = extractFormFields(structuredJson);
    if (formFields.length > 0) {
      extractionPath = "gemini_structured";
      for (const field of formFields) {
        for (const lp of allPatterns) {
          if (lp.pattern.test(field.name)) {
            const val = parseMoney(field.value);
            if (val !== null) {
              factsAttempted++;
              items.push({
                key: lp.key,
                value: val,
                period,
                snippet: `${field.name}: ${field.value}`,
              });
              break;
            }
          }
        }
      }
    }
  }

  // -- OCR regex --
  for (const lp of allPatterns) {
    if (items.some((i) => i.key === lp.key)) continue;
    factsAttempted++;
    const match = ocrText.match(lp.pattern);
    if (match) {
      const val = parseMoney(match[1]);
      if (val !== null) {
        items.push({
          key: lp.key,
          value: val,
          period,
          snippet: match[0].replace(/\s+/g, " ").trim().slice(0, 120),
        });
      }
    }
  }

  const validItems = items.filter((i) => VALID_LINE_KEYS.has(i.key));

  return {
    ok: validItems.length > 0,
    items: validItems,
    extractionPath,
    factsAttempted,
  };
}

// ---------------------------------------------------------------------------
// Book EBITDA adjustment (pure computation)
// ---------------------------------------------------------------------------

export type BookEbitdaAdjustmentResult = {
  bookEbitda: number | null;
  deprBookTaxDiff: number | null;
};

/**
 * Book EBITDA = Tax Return EBITDA + (Tax Depreciation − Book Depreciation)
 *            = is_ebitda + m1_depr_book_tax_diff
 */
export function computeBookEbitda(
  taxEbitda: number | null,
  deprBookTaxDiff: number | null,
): BookEbitdaAdjustmentResult {
  if (taxEbitda === null) {
    return { bookEbitda: null, deprBookTaxDiff };
  }
  const bookEbitda =
    deprBookTaxDiff !== null ? taxEbitda + deprBookTaxDiff : taxEbitda;
  return { bookEbitda, deprBookTaxDiff };
}
