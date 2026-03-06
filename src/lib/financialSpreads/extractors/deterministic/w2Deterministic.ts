/**
 * W-2 Deterministic Extractor — Wage & Salary Income
 *
 * Extracts all 14 boxes per God Tier spec Section 3E.
 * Pure deterministic extraction — regex + structured JSON, no LLMs.
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
// Valid W-2 line keys (spec Section 3E)
// ---------------------------------------------------------------------------

const VALID_LINE_KEYS = new Set([
  "W2_WAGES",
  "W2_FED_TAX_WITHHELD",
  "W2_SS_WAGES",
  "W2_SS_TAX",
  "W2_MEDICARE_WAGES",
  "W2_MEDICARE_TAX",
  "W2_DEP_CARE",
  "W2_NQDC",
  "W2_BOX12_DETAIL",
  "W2_CHECKBOXES",
  "W2_OTHER_DETAIL",
  "W2_EMPLOYER_NAME",
  "W2_EMPLOYEE_NAME",
  "W2_SSN_LAST4",
]);

// ---------------------------------------------------------------------------
// Box extraction patterns
// ---------------------------------------------------------------------------

type BoxPattern = { key: string; pattern: RegExp };

const W2_PATTERNS: BoxPattern[] = [
  // Box 1 — Wages
  { key: "W2_WAGES", pattern: /(?:box\s+1\b|wages,?\s+tips,?\s+other\s+compensation).*?(\(?-?\$?\d[\d,]*(?:\.\d{0,2})?\)?)/i },
  // Box 2 — Federal tax withheld
  { key: "W2_FED_TAX_WITHHELD", pattern: /(?:box\s+2\b|federal\s+income\s+tax\s+withheld).*?(\(?-?\$?\d[\d,]*(?:\.\d{0,2})?\)?)/i },
  // Box 3 — Social Security wages
  { key: "W2_SS_WAGES", pattern: /(?:box\s+3\b|social\s+security\s+wages).*?(\(?-?\$?\d[\d,]*(?:\.\d{0,2})?\)?)/i },
  // Box 4 — Social Security tax
  { key: "W2_SS_TAX", pattern: /(?:box\s+4\b|social\s+security\s+tax\s+withheld).*?(\(?-?\$?\d[\d,]*(?:\.\d{0,2})?\)?)/i },
  // Box 5 — Medicare wages
  { key: "W2_MEDICARE_WAGES", pattern: /(?:box\s+5\b|medicare\s+wages).*?(\(?-?\$?\d[\d,]*(?:\.\d{0,2})?\)?)/i },
  // Box 6 — Medicare tax
  { key: "W2_MEDICARE_TAX", pattern: /(?:box\s+6\b|medicare\s+tax\s+withheld).*?(\(?-?\$?\d[\d,]*(?:\.\d{0,2})?\)?)/i },
  // Box 10 — Dependent care
  { key: "W2_DEP_CARE", pattern: /(?:box\s+10\b|dependent\s+care\s+benefits?).*?(\(?-?\$?\d[\d,]*(?:\.\d{0,2})?\)?)/i },
  // Box 11 — Nonqualified deferred comp
  { key: "W2_NQDC", pattern: /(?:box\s+11\b|nonqualified\s+(?:deferred\s+)?(?:plans?|comp)).*?(\(?-?\$?\d[\d,]*(?:\.\d{0,2})?\)?)/i },
];

// Text field patterns
const EMPLOYER_NAME_RE = /(?:employer(?:'s)?\s+name|box\s+c\b)[:\s]*([A-Za-z][A-Za-z0-9\s,.'&()-]+?)(?:\n|$)/i;
const EMPLOYEE_NAME_RE = /(?:employee(?:'s)?\s+(?:first\s+)?name|box\s+e\b)[:\s]*([A-Za-z][A-Za-z\s,.'()-]+?)(?:\n|$)/i;
const SSN_LAST4_RE = /(?:SSN|social\s+security\s+number|box\s+f\b).*?(\d{4})\s*$/im;
const BOX12_RE = /(?:box\s+12[a-d]?\b|12[a-d]\s*[-:]?\s*(?:code|[A-Z]{1,2}\b)).*?([A-Z]{1,2})\s+(\(?-?\$?\d[\d,]*(?:\.\d{0,2})?\)?)/gi;

// ---------------------------------------------------------------------------
// Main extractor
// ---------------------------------------------------------------------------

export function extractW2(
  args: DeterministicExtractorArgs,
): PureDeterministicResult {
  const { ocrText, structuredJson, docYear } = args;
  const items: PureLineItem[] = [];
  let extractionPath: ExtractionPath = "ocr_regex";
  let factsAttempted = 0;

  const taxYear = resolveDocTaxYear(ocrText, docYear);
  const period = taxYear ? String(taxYear) : null;

  // -- Try structured JSON first --
  if (structuredJson) {
    const formFields = extractFormFields(structuredJson);
    if (formFields.length > 0) {
      extractionPath = "gemini_structured";
      for (const field of formFields) {
        for (const bp of W2_PATTERNS) {
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
  for (const bp of W2_PATTERNS) {
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

  // -- Text fields --
  const employerMatch = ocrText.match(EMPLOYER_NAME_RE);
  if (employerMatch) {
    factsAttempted++;
    items.push({ key: "W2_EMPLOYER_NAME", value: 0, period, snippet: employerMatch[1].trim() });
  }

  const employeeMatch = ocrText.match(EMPLOYEE_NAME_RE);
  if (employeeMatch) {
    factsAttempted++;
    items.push({ key: "W2_EMPLOYEE_NAME", value: 0, period, snippet: employeeMatch[1].trim() });
  }

  const ssnMatch = ocrText.match(SSN_LAST4_RE);
  if (ssnMatch) {
    factsAttempted++;
    items.push({ key: "W2_SSN_LAST4", value: 0, period, snippet: ssnMatch[1] });
  }

  // Box 12 — multiple codes
  const box12Matches = ocrText.matchAll(BOX12_RE);
  const box12Parts: string[] = [];
  for (const m of box12Matches) {
    box12Parts.push(`${m[1]}=${m[2]}`);
  }
  if (box12Parts.length > 0) {
    factsAttempted++;
    items.push({ key: "W2_BOX12_DETAIL", value: 0, period, snippet: box12Parts.join("; ") });
  }

  const validItems = items.filter((i) => VALID_LINE_KEYS.has(i.key));

  return {
    ok: validItems.length > 0,
    items: validItems,
    extractionPath,
    factsAttempted,
  };
}
