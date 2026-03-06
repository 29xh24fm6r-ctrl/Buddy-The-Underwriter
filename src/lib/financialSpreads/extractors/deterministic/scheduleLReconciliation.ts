/**
 * Schedule L Deterministic Extractor — Balance Sheet per Tax Return
 *
 * Extracts all Schedule L lines (Form 1120/1120-S/1065 balance sheet)
 * and provides reconciliation against financial statement balance sheet
 * with 3% variance threshold trigger per God Tier Phase 2 spec Layer 4F.
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
  // Assets
  "SL_CASH",
  "SL_AR_GROSS",
  "SL_AR_ALLOWANCE",
  "SL_INVENTORY",
  "SL_US_GOV_OBLIGATIONS",
  "SL_TAX_EXEMPT_SECURITIES",
  "SL_OTHER_CURRENT_ASSETS",
  "SL_SHAREHOLDER_LOANS_RECEIVABLE",
  "SL_MORTGAGE_LOANS",
  "SL_OTHER_INVESTMENTS",
  "SL_PPE_GROSS",
  "SL_ACCUMULATED_DEPRECIATION",
  "SL_DEPLETABLE_ASSETS",
  "SL_LAND",
  "SL_INTANGIBLES_GROSS",
  "SL_ACCUMULATED_AMORTIZATION",
  "SL_OTHER_ASSETS",
  "SL_TOTAL_ASSETS",
  // Liabilities & equity
  "SL_ACCOUNTS_PAYABLE",
  "SL_MORTGAGES_NOTES_BONDS",
  "SL_OTHER_LIABILITIES",
  "SL_TOTAL_LIABILITIES",
  "SL_CAPITAL_STOCK",
  "SL_RETAINED_EARNINGS",
  "SL_TOTAL_EQUITY",
]);

// ---------------------------------------------------------------------------
// Patterns — Assets
// ---------------------------------------------------------------------------

type LinePattern = { key: string; pattern: RegExp };

const SL_ASSET_PATTERNS: LinePattern[] = [
  { key: "SL_CASH", pattern: /(?:line\s+1\b|cash\b).*?(\(?-?\$?\d[\d,]*(?:\.\d{0,2})?\)?)/i },
  { key: "SL_AR_GROSS", pattern: /(?:line\s+2a?\b|trade\s+notes\s+and\s+accounts?\s+receivable).*?(\(?-?\$?\d[\d,]*(?:\.\d{0,2})?\)?)/i },
  { key: "SL_AR_ALLOWANCE", pattern: /(?:line\s+2b\b|less\s+allowance\s+for\s+bad\s+debts?).*?(\(?-?\$?\d[\d,]*(?:\.\d{0,2})?\)?)/i },
  { key: "SL_INVENTORY", pattern: /(?:line\s+3\b|inventor(?:y|ies)).*?(\(?-?\$?\d[\d,]*(?:\.\d{0,2})?\)?)/i },
  { key: "SL_US_GOV_OBLIGATIONS", pattern: /(?:line\s+4\b|u\.?s\.?\s+government\s+obligations?).*?(\(?-?\$?\d[\d,]*(?:\.\d{0,2})?\)?)/i },
  { key: "SL_TAX_EXEMPT_SECURITIES", pattern: /(?:line\s+5\b|tax[- ]exempt\s+securities?).*?(\(?-?\$?\d[\d,]*(?:\.\d{0,2})?\)?)/i },
  { key: "SL_OTHER_CURRENT_ASSETS", pattern: /(?:line\s+6\b|other\s+current\s+assets?).*?(\(?-?\$?\d[\d,]*(?:\.\d{0,2})?\)?)/i },
  { key: "SL_SHAREHOLDER_LOANS_RECEIVABLE", pattern: /(?:line\s+7\b|loans?\s+to\s+shareholders?).*?(\(?-?\$?\d[\d,]*(?:\.\d{0,2})?\)?)/i },
  { key: "SL_MORTGAGE_LOANS", pattern: /(?:line\s+8\b|mortgage\s+and\s+real\s+estate\s+loans?).*?(\(?-?\$?\d[\d,]*(?:\.\d{0,2})?\)?)/i },
  { key: "SL_OTHER_INVESTMENTS", pattern: /(?:line\s+9\b|other\s+investments?).*?(\(?-?\$?\d[\d,]*(?:\.\d{0,2})?\)?)/i },
  { key: "SL_PPE_GROSS", pattern: /(?:line\s+10a?\b|buildings?\s+and\s+other\s+depreciable\s+assets?).*?(\(?-?\$?\d[\d,]*(?:\.\d{0,2})?\)?)/i },
  { key: "SL_ACCUMULATED_DEPRECIATION", pattern: /(?:line\s+10b\b|less\s+accumulated\s+depreciation).*?(\(?-?\$?\d[\d,]*(?:\.\d{0,2})?\)?)/i },
  { key: "SL_DEPLETABLE_ASSETS", pattern: /(?:line\s+11\b|depletable\s+assets?).*?(\(?-?\$?\d[\d,]*(?:\.\d{0,2})?\)?)/i },
  { key: "SL_LAND", pattern: /(?:line\s+12\b|land\b(?:\s*\()?).*?(\(?-?\$?\d[\d,]*(?:\.\d{0,2})?\)?)/i },
  { key: "SL_INTANGIBLES_GROSS", pattern: /(?:line\s+13a?\b|intangible\s+assets?).*?(\(?-?\$?\d[\d,]*(?:\.\d{0,2})?\)?)/i },
  { key: "SL_ACCUMULATED_AMORTIZATION", pattern: /(?:line\s+13b\b|less\s+accumulated\s+amortization).*?(\(?-?\$?\d[\d,]*(?:\.\d{0,2})?\)?)/i },
  { key: "SL_OTHER_ASSETS", pattern: /(?:line\s+14\b|other\s+assets?).*?(\(?-?\$?\d[\d,]*(?:\.\d{0,2})?\)?)/i },
  { key: "SL_TOTAL_ASSETS", pattern: /(?:line\s+15\b|total\s+assets?).*?(\(?-?\$?\d[\d,]*(?:\.\d{0,2})?\)?)/i },
];

// ---------------------------------------------------------------------------
// Patterns — Liabilities & Equity
// ---------------------------------------------------------------------------

const SL_LIABILITY_PATTERNS: LinePattern[] = [
  { key: "SL_ACCOUNTS_PAYABLE", pattern: /(?:line\s+16\b|accounts?\s+payable).*?(\(?-?\$?\d[\d,]*(?:\.\d{0,2})?\)?)/i },
  { key: "SL_MORTGAGES_NOTES_BONDS", pattern: /(?:line\s+17\b|mortgages?\s*,?\s*notes?\s*,?\s*bonds?).*?(\(?-?\$?\d[\d,]*(?:\.\d{0,2})?\)?)/i },
  { key: "SL_OTHER_LIABILITIES", pattern: /(?:line\s+18\b|other\s+liabilities?).*?(\(?-?\$?\d[\d,]*(?:\.\d{0,2})?\)?)/i },
  { key: "SL_TOTAL_LIABILITIES", pattern: /(?:total\s+liabilities?).*?(\(?-?\$?\d[\d,]*(?:\.\d{0,2})?\)?)/i },
  { key: "SL_CAPITAL_STOCK", pattern: /(?:line\s+22\b|capital\s+stock).*?(\(?-?\$?\d[\d,]*(?:\.\d{0,2})?\)?)/i },
  { key: "SL_RETAINED_EARNINGS", pattern: /(?:line\s+24\b|retained\s+earnings?).*?(\(?-?\$?\d[\d,]*(?:\.\d{0,2})?\)?)/i },
  { key: "SL_TOTAL_EQUITY", pattern: /(?:total\s+(?:shareholders?['']?\s+)?equity|total\s+(?:capital|stockholders?['']?\s+equity)).*?(\(?-?\$?\d[\d,]*(?:\.\d{0,2})?\)?)/i },
];

// ---------------------------------------------------------------------------
// Main extractor
// ---------------------------------------------------------------------------

export function extractScheduleL(
  args: DeterministicExtractorArgs,
): PureDeterministicResult {
  const { ocrText, structuredJson, docYear } = args;
  const items: PureLineItem[] = [];
  let extractionPath: ExtractionPath = "ocr_regex";
  let factsAttempted = 0;

  const taxYear = resolveDocTaxYear(ocrText, docYear);
  const period = taxYear ? String(taxYear) : null;

  const allPatterns = [...SL_ASSET_PATTERNS, ...SL_LIABILITY_PATTERNS];

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
// Balance sheet reconciliation (pure computation)
// ---------------------------------------------------------------------------

export type ReconciliationVariance = {
  field: string;
  scheduleLValue: number;
  financialStatementValue: number;
  variance: number;
  variancePct: number;
  breachesThreshold: boolean;
};

export type ReconciliationResult = {
  variances: ReconciliationVariance[];
  hasBreaches: boolean;
  totalAssetsVariancePct: number | null;
  message: string;
};

const RECONCILIATION_THRESHOLD = 0.03; // 3%

/**
 * Reconcile Schedule L (tax return balance sheet) against financial statement
 * balance sheet. Flag variances > 3% per spec.
 */
export function reconcileScheduleL(
  scheduleLTotals: { totalAssets: number | null; totalLiabilities: number | null; totalEquity: number | null },
  financialStatementTotals: { totalAssets: number | null; totalLiabilities: number | null; totalEquity: number | null },
): ReconciliationResult {
  const variances: ReconciliationVariance[] = [];

  const pairs: Array<{ field: string; sl: number | null; fs: number | null }> = [
    { field: "Total Assets", sl: scheduleLTotals.totalAssets, fs: financialStatementTotals.totalAssets },
    { field: "Total Liabilities", sl: scheduleLTotals.totalLiabilities, fs: financialStatementTotals.totalLiabilities },
    { field: "Total Equity", sl: scheduleLTotals.totalEquity, fs: financialStatementTotals.totalEquity },
  ];

  for (const { field, sl, fs } of pairs) {
    if (sl !== null && fs !== null && fs !== 0) {
      const variance = sl - fs;
      const variancePct = Math.abs(variance) / Math.abs(fs);
      variances.push({
        field,
        scheduleLValue: sl,
        financialStatementValue: fs,
        variance,
        variancePct,
        breachesThreshold: variancePct > RECONCILIATION_THRESHOLD,
      });
    }
  }

  const hasBreaches = variances.some((v) => v.breachesThreshold);
  const totalAssetsVariance = variances.find((v) => v.field === "Total Assets");
  const totalAssetsVariancePct = totalAssetsVariance?.variancePct ?? null;

  let message: string;
  if (variances.length === 0) {
    message = "Insufficient data for reconciliation";
  } else if (hasBreaches) {
    const breached = variances.filter((v) => v.breachesThreshold).map((v) => v.field);
    message = `BALANCE SHEET DISCREPANCY: Tax return vs. financial statement variance >3% in ${breached.join(", ")}. Explanation required.`;
  } else {
    message = "Schedule L reconciles with financial statements within 3% threshold";
  }

  return {
    variances,
    hasBreaches,
    totalAssetsVariancePct,
    message,
  };
}
