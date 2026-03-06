/**
 * Form 4562 Deterministic Extractor — Depreciation & Amortization
 *
 * Extracts Section 179, bonus depreciation, MACRS, amortization
 * per God Tier Phase 2 spec Layer 4A.
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
  "F4562_SEC179_TOTAL",
  "F4562_BONUS_DEPRECIATION",
  "F4562_MACRS_TOTAL",
  "F4562_ACRS_TOTAL",
  "F4562_LISTED_PROPERTY",
  "F4562_AMORTIZATION_TOTAL",
]);

// ---------------------------------------------------------------------------
// Patterns
// ---------------------------------------------------------------------------

type BoxPattern = { key: string; pattern: RegExp };

const F4562_PATTERNS: BoxPattern[] = [
  // Part I — Section 179
  { key: "F4562_SEC179_TOTAL", pattern: /(?:section\s+179|part\s+I\b|elected?\s+(?:to\s+)?expense).*?(\(?-?\$?\d[\d,]*(?:\.\d{0,2})?\)?)/i },
  // Part II Line 14 — Bonus / Special depreciation
  { key: "F4562_BONUS_DEPRECIATION", pattern: /(?:line\s+14\b|special\s+depreciation\s+allowance|bonus\s+depreciation).*?(\(?-?\$?\d[\d,]*(?:\.\d{0,2})?\)?)/i },
  // Part II Line 17 — MACRS
  { key: "F4562_MACRS_TOTAL", pattern: /(?:line\s+17\b|MACRS\s+deductions?).*?(\(?-?\$?\d[\d,]*(?:\.\d{0,2})?\)?)/i },
  // Part III — ACRS
  { key: "F4562_ACRS_TOTAL", pattern: /(?:part\s+III\b|ACRS\s+deductions?).*?(\(?-?\$?\d[\d,]*(?:\.\d{0,2})?\)?)/i },
  // Part IV Line 22 — Listed property
  { key: "F4562_LISTED_PROPERTY", pattern: /(?:line\s+22\b|listed\s+property|total.*?listed).*?(\(?-?\$?\d[\d,]*(?:\.\d{0,2})?\)?)/i },
  // Part VI — Amortization
  { key: "F4562_AMORTIZATION_TOTAL", pattern: /(?:part\s+VI\b|amortization(?:\s+of\s+intangibles?)?).*?(\(?-?\$?\d[\d,]*(?:\.\d{0,2})?\)?)/i },
];

// ---------------------------------------------------------------------------
// Main extractor
// ---------------------------------------------------------------------------

export function extractForm4562(
  args: DeterministicExtractorArgs,
): PureDeterministicResult {
  const { ocrText, structuredJson, docYear } = args;
  const items: PureLineItem[] = [];
  let extractionPath: ExtractionPath = "ocr_regex";
  let factsAttempted = 0;

  const taxYear = resolveDocTaxYear(ocrText, docYear);
  const period = taxYear ? String(taxYear) : null;

  // -- Structured JSON --
  if (structuredJson) {
    const formFields = extractFormFields(structuredJson);
    if (formFields.length > 0) {
      extractionPath = "gemini_structured";
      for (const field of formFields) {
        for (const bp of F4562_PATTERNS) {
          if (bp.pattern.test(field.name)) {
            const val = parseMoney(field.value);
            if (val !== null) {
              factsAttempted++;
              items.push({
                key: bp.key,
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
  for (const bp of F4562_PATTERNS) {
    if (items.some((i) => i.key === bp.key)) continue;
    factsAttempted++;
    const match = ocrText.match(bp.pattern);
    if (match) {
      const val = parseMoney(match[1]);
      if (val !== null) {
        items.push({
          key: bp.key,
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
// Normalized depreciation computation (pure)
// ---------------------------------------------------------------------------

export type NormalizedDepreciationInput = {
  sec179Total: number | null;
  bonusDepreciation: number | null;
  macrsTotal: number | null;
  amortizationTotal: number | null;
  averageMacrsLife?: number; // default 7 years
};

export type NormalizedDepreciationResult = {
  totalTaxDepreciation: number;
  normalizedDepreciation: number;
  addBackAmount: number;
  sec179PctOfTotal: number | null;
};

/**
 * Compute normalized depreciation for cash flow analysis.
 * Section 179 + bonus depreciation distort the tax return year —
 * use straight-line equivalent for DSCR computation.
 */
export function computeNormalizedDepreciation(
  input: NormalizedDepreciationInput,
): NormalizedDepreciationResult {
  const sec179 = input.sec179Total ?? 0;
  const bonus = input.bonusDepreciation ?? 0;
  const macrs = input.macrsTotal ?? 0;
  const amort = input.amortizationTotal ?? 0;
  const avgLife = input.averageMacrsLife ?? 7;

  const totalTax = sec179 + bonus + macrs + amort;

  // Normalize: spread 179/bonus over average useful life
  const normalizedAccelerated = avgLife > 0 ? (sec179 + bonus) / avgLife : 0;
  const normalizedDepreciation = macrs + normalizedAccelerated + amort;

  const addBackAmount = totalTax - normalizedDepreciation;

  const sec179PctOfTotal =
    totalTax > 0 ? (sec179 + bonus) / totalTax : null;

  return {
    totalTaxDepreciation: totalTax,
    normalizedDepreciation,
    addBackAmount,
    sec179PctOfTotal,
  };
}
