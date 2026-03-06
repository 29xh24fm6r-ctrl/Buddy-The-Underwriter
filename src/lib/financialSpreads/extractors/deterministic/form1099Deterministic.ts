/**
 * 1099 Suite Deterministic Extractor — All 1099 Variants + SSA-1099
 *
 * Single extractor handling all 1099 variants per God Tier spec Section 3F.
 * Pure deterministic extraction — regex + structured JSON, no LLMs.
 *
 * Supported forms:
 *   1099-NEC, 1099-MISC, 1099-INT, 1099-DIV, 1099-R, SSA-1099
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
// Valid 1099 line keys (spec Section 3F)
// ---------------------------------------------------------------------------

const VALID_LINE_KEYS = new Set([
  // 1099-NEC
  "F1099NEC_NONEMPLOYEE_COMP",
  // 1099-MISC
  "F1099MISC_RENTS",
  "F1099MISC_ROYALTIES",
  "F1099MISC_OTHER_INCOME",
  "F1099MISC_MEDICAL",
  // 1099-INT
  "F1099INT_INTEREST",
  "F1099INT_US_SAVINGS",
  "F1099INT_TAX_EXEMPT",
  // 1099-DIV
  "F1099DIV_ORDINARY",
  "F1099DIV_QUALIFIED",
  "F1099DIV_CAP_GAIN",
  // 1099-R
  "F1099R_GROSS_DISTRIBUTION",
  "F1099R_TAXABLE",
  "F1099R_DISTRIBUTION_CODE",
  // SSA-1099
  "SSA1099_NET_BENEFITS",
]);

// ---------------------------------------------------------------------------
// Extraction patterns by form type
// ---------------------------------------------------------------------------

type BoxPattern = { key: string; pattern: RegExp };

// 1099-NEC
const NEC_PATTERNS: BoxPattern[] = [
  { key: "F1099NEC_NONEMPLOYEE_COMP", pattern: /(?:box\s+1\b|nonemployee\s+compensation).*?(\(?-?\$?\d[\d,]*(?:\.\d{0,2})?\)?)/i },
];

// 1099-MISC
const MISC_PATTERNS: BoxPattern[] = [
  { key: "F1099MISC_RENTS", pattern: /(?:box\s+1\b|rents).*?(\(?-?\$?\d[\d,]*(?:\.\d{0,2})?\)?)/i },
  { key: "F1099MISC_ROYALTIES", pattern: /(?:box\s+2\b|royalties).*?(\(?-?\$?\d[\d,]*(?:\.\d{0,2})?\)?)/i },
  { key: "F1099MISC_OTHER_INCOME", pattern: /(?:box\s+3\b|other\s+income).*?(\(?-?\$?\d[\d,]*(?:\.\d{0,2})?\)?)/i },
  { key: "F1099MISC_MEDICAL", pattern: /(?:box\s+6\b|medical.*?(?:health)?.*?payments?).*?(\(?-?\$?\d[\d,]*(?:\.\d{0,2})?\)?)/i },
];

// 1099-INT
const INT_PATTERNS: BoxPattern[] = [
  { key: "F1099INT_INTEREST", pattern: /(?:box\s+1\b|interest\s+income).*?(\(?-?\$?\d[\d,]*(?:\.\d{0,2})?\)?)/i },
  { key: "F1099INT_US_SAVINGS", pattern: /(?:box\s+3\b|(?:U\.?S\.?\s+)?savings?\s+bonds?).*?(\(?-?\$?\d[\d,]*(?:\.\d{0,2})?\)?)/i },
  { key: "F1099INT_TAX_EXEMPT", pattern: /(?:box\s+8\b|tax[\s-]exempt\s+interest).*?(\(?-?\$?\d[\d,]*(?:\.\d{0,2})?\)?)/i },
];

// 1099-DIV
const DIV_PATTERNS: BoxPattern[] = [
  { key: "F1099DIV_ORDINARY", pattern: /(?:box\s+1a\b|total\s+ordinary\s+dividends?).*?(\(?-?\$?\d[\d,]*(?:\.\d{0,2})?\)?)/i },
  { key: "F1099DIV_QUALIFIED", pattern: /(?:box\s+1b\b|qualified\s+dividends?).*?(\(?-?\$?\d[\d,]*(?:\.\d{0,2})?\)?)/i },
  { key: "F1099DIV_CAP_GAIN", pattern: /(?:box\s+2a\b|(?:total\s+)?capital\s+gain\s+distributions?).*?(\(?-?\$?\d[\d,]*(?:\.\d{0,2})?\)?)/i },
];

// 1099-R
const R_PATTERNS: BoxPattern[] = [
  { key: "F1099R_GROSS_DISTRIBUTION", pattern: /(?:box\s+1\b|gross\s+distribution).*?(\(?-?\$?\d[\d,]*(?:\.\d{0,2})?\)?)/i },
  { key: "F1099R_TAXABLE", pattern: /(?:box\s+2a\b|taxable\s+amount).*?(\(?-?\$?\d[\d,]*(?:\.\d{0,2})?\)?)/i },
];

const R_CODE_PATTERN = /distribution\s+code[:\s]*([0-9A-Z]{1,2})/i;

// SSA-1099
const SSA_PATTERNS: BoxPattern[] = [
  { key: "SSA1099_NET_BENEFITS", pattern: /(?:box\s+5\b|net\s+benefits?\s+(?:paid|received)).*?(\(?-?\$?\d[\d,]*(?:\.\d{0,2})?\)?)/i },
];

// ---------------------------------------------------------------------------
// Form type detection
// ---------------------------------------------------------------------------

type Form1099Type = "NEC" | "MISC" | "INT" | "DIV" | "R" | "SSA" | "UNKNOWN";

function detect1099Type(text: string): Form1099Type {
  const upper = text.slice(0, 2000).toUpperCase();
  if (/1099[\s-]?NEC/.test(upper)) return "NEC";
  if (/1099[\s-]?MISC/.test(upper)) return "MISC";
  if (/1099[\s-]?INT/.test(upper)) return "INT";
  if (/1099[\s-]?DIV/.test(upper)) return "DIV";
  if (/1099[\s-]?R\b/.test(upper)) return "R";
  if (/SSA[\s-]?1099/.test(upper)) return "SSA";
  return "UNKNOWN";
}

function getPatternsForType(formType: Form1099Type): BoxPattern[] {
  switch (formType) {
    case "NEC": return NEC_PATTERNS;
    case "MISC": return MISC_PATTERNS;
    case "INT": return INT_PATTERNS;
    case "DIV": return DIV_PATTERNS;
    case "R": return R_PATTERNS;
    case "SSA": return SSA_PATTERNS;
    case "UNKNOWN":
      // Try all patterns
      return [...NEC_PATTERNS, ...MISC_PATTERNS, ...INT_PATTERNS, ...DIV_PATTERNS, ...R_PATTERNS, ...SSA_PATTERNS];
  }
}

// ---------------------------------------------------------------------------
// Main extractor
// ---------------------------------------------------------------------------

export function extractForm1099(
  args: DeterministicExtractorArgs,
): PureDeterministicResult {
  const { ocrText, structuredJson, docYear } = args;
  const items: PureLineItem[] = [];
  let extractionPath: ExtractionPath = "ocr_regex";
  let factsAttempted = 0;

  const taxYear = resolveDocTaxYear(ocrText, docYear);
  const period = taxYear ? String(taxYear) : null;

  const formType = detect1099Type(ocrText);
  const patterns = getPatternsForType(formType);

  // -- Try structured JSON first --
  if (structuredJson) {
    const formFields = extractFormFields(structuredJson);
    if (formFields.length > 0) {
      extractionPath = "gemini_structured";
      for (const field of formFields) {
        for (const bp of patterns) {
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

  // -- OCR regex extraction --
  for (const bp of patterns) {
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

  // -- 1099-R distribution code (text field) --
  if (formType === "R" || formType === "UNKNOWN") {
    const codeMatch = ocrText.match(R_CODE_PATTERN);
    if (codeMatch) {
      factsAttempted++;
      items.push({
        key: "F1099R_DISTRIBUTION_CODE",
        value: 0,
        period,
        snippet: codeMatch[1],
      });
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
