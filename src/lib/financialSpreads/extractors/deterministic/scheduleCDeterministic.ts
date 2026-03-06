/**
 * Schedule C Deterministic Extractor — Sole Proprietor Business Income
 *
 * Extracts all 29 lines per God Tier spec Section 3C.
 * Pure deterministic extraction — regex + structured JSON, no LLMs.
 * Multi-Schedule-C aware: extracts from the first Schedule C encountered.
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
// Valid Schedule C line keys (spec Section 3C)
// ---------------------------------------------------------------------------

const VALID_LINE_KEYS = new Set([
  "SCH_C_BUSINESS_NAME",
  "SCH_C_NAICS",
  "SCH_C_GROSS_RECEIPTS",
  "SCH_C_RETURNS",
  "SCH_C_NET_SALES",
  "SCH_C_COGS",
  "SCH_C_GROSS_PROFIT",
  "SCH_C_OTHER_INCOME",
  "SCH_C_GROSS_INCOME",
  "SCH_C_ADVERTISING",
  "SCH_C_AUTO",
  "SCH_C_COMMISSIONS",
  "SCH_C_CONTRACT_LABOR",
  "SCH_C_DEPLETION",
  "SCH_C_DEPRECIATION",
  "SCH_C_EMPLOYEE_BENEFITS",
  "SCH_C_INSURANCE",
  "SCH_C_MORTGAGE_INTEREST",
  "SCH_C_OTHER_INTEREST",
  "SCH_C_LEGAL_PROFESSIONAL",
  "SCH_C_OFFICE",
  "SCH_C_PENSION",
  "SCH_C_VEHICLE_RENT",
  "SCH_C_EQUIPMENT_RENT",
  "SCH_C_REPAIRS",
  "SCH_C_SUPPLIES",
  "SCH_C_TAXES_LICENSES",
  "SCH_C_TRAVEL",
  "SCH_C_MEALS",
  "SCH_C_UTILITIES",
  "SCH_C_WAGES",
  "SCH_C_OTHER_EXPENSES",
  "SCH_C_TOTAL_EXPENSES",
  "SCH_C_HOME_OFFICE",
  "SCH_C_NET_PROFIT",
]);

// ---------------------------------------------------------------------------
// Line extraction patterns
// ---------------------------------------------------------------------------

type LinePattern = { key: string; pattern: RegExp };

const SCH_C_PATTERNS: LinePattern[] = [
  // Line 1 — Gross receipts
  { key: "SCH_C_GROSS_RECEIPTS", pattern: /(?:line\s+1\b|gross\s+receipts?\s+or\s+sales).*?(\(?-?\$?\d[\d,]*(?:\.\d{0,2})?\)?)/i },
  // Line 2 — Returns
  { key: "SCH_C_RETURNS", pattern: /(?:line\s+2\b|returns?\s+and\s+allowances?).*?(\(?-?\$?\d[\d,]*(?:\.\d{0,2})?\)?)/i },
  // Line 3 — Net sales
  { key: "SCH_C_NET_SALES", pattern: /(?:line\s+3\b|net\s+sales?).*?(\(?-?\$?\d[\d,]*(?:\.\d{0,2})?\)?)/i },
  // Line 4 — COGS
  { key: "SCH_C_COGS", pattern: /(?:line\s+4\b|cost\s+of\s+goods\s+sold).*?(\(?-?\$?\d[\d,]*(?:\.\d{0,2})?\)?)/i },
  // Line 5 — Gross profit
  { key: "SCH_C_GROSS_PROFIT", pattern: /(?:line\s+5\b|gross\s+profit).*?(\(?-?\$?\d[\d,]*(?:\.\d{0,2})?\)?)/i },
  // Line 6 — Other income
  { key: "SCH_C_OTHER_INCOME", pattern: /(?:line\s+6\b|other\s+income).*?(\(?-?\$?\d[\d,]*(?:\.\d{0,2})?\)?)/i },
  // Line 7 — Gross income
  { key: "SCH_C_GROSS_INCOME", pattern: /(?:line\s+7\b|gross\s+income).*?(\(?-?\$?\d[\d,]*(?:\.\d{0,2})?\)?)/i },
  // Line 8 — Advertising
  { key: "SCH_C_ADVERTISING", pattern: /(?:line\s+8\b|advertising).*?(\(?-?\$?\d[\d,]*(?:\.\d{0,2})?\)?)/i },
  // Line 9 — Car and truck
  { key: "SCH_C_AUTO", pattern: /(?:line\s+9\b|car\s+and\s+truck).*?(\(?-?\$?\d[\d,]*(?:\.\d{0,2})?\)?)/i },
  // Line 10 — Commissions
  { key: "SCH_C_COMMISSIONS", pattern: /(?:line\s+10\b|commissions?\s+and\s+fees?).*?(\(?-?\$?\d[\d,]*(?:\.\d{0,2})?\)?)/i },
  // Line 11 — Contract labor
  { key: "SCH_C_CONTRACT_LABOR", pattern: /(?:line\s+11\b|contract\s+labor).*?(\(?-?\$?\d[\d,]*(?:\.\d{0,2})?\)?)/i },
  // Line 12 — Depletion
  { key: "SCH_C_DEPLETION", pattern: /(?:line\s+12\b|depletion).*?(\(?-?\$?\d[\d,]*(?:\.\d{0,2})?\)?)/i },
  // Line 13 — Depreciation
  { key: "SCH_C_DEPRECIATION", pattern: /(?:line\s+13\b|depreciation).*?(\(?-?\$?\d[\d,]*(?:\.\d{0,2})?\)?)/i },
  // Line 14 — Employee benefits
  { key: "SCH_C_EMPLOYEE_BENEFITS", pattern: /(?:line\s+14\b|employee\s+benefit).*?(\(?-?\$?\d[\d,]*(?:\.\d{0,2})?\)?)/i },
  // Line 15 — Insurance
  { key: "SCH_C_INSURANCE", pattern: /(?:line\s+15\b|insurance\s+\(?other).*?(\(?-?\$?\d[\d,]*(?:\.\d{0,2})?\)?)/i },
  // Line 16a — Mortgage interest
  { key: "SCH_C_MORTGAGE_INTEREST", pattern: /(?:line\s+16a?\b|mortgage\s+interest).*?(\(?-?\$?\d[\d,]*(?:\.\d{0,2})?\)?)/i },
  // Line 16b — Other interest
  { key: "SCH_C_OTHER_INTEREST", pattern: /(?:line\s+16b\b|other\s+interest).*?(\(?-?\$?\d[\d,]*(?:\.\d{0,2})?\)?)/i },
  // Line 17 — Legal/professional
  { key: "SCH_C_LEGAL_PROFESSIONAL", pattern: /(?:line\s+17\b|legal\s+and\s+professional).*?(\(?-?\$?\d[\d,]*(?:\.\d{0,2})?\)?)/i },
  // Line 18 — Office expense
  { key: "SCH_C_OFFICE", pattern: /(?:line\s+18\b|office\s+expense).*?(\(?-?\$?\d[\d,]*(?:\.\d{0,2})?\)?)/i },
  // Line 19 — Pension
  { key: "SCH_C_PENSION", pattern: /(?:line\s+19\b|pension|profit[\s-]sharing).*?(\(?-?\$?\d[\d,]*(?:\.\d{0,2})?\)?)/i },
  // Line 20a — Vehicle rent/lease
  { key: "SCH_C_VEHICLE_RENT", pattern: /(?:line\s+20a?\b|vehicle.*?rent|vehicle.*?lease).*?(\(?-?\$?\d[\d,]*(?:\.\d{0,2})?\)?)/i },
  // Line 20b — Equipment rent
  { key: "SCH_C_EQUIPMENT_RENT", pattern: /(?:line\s+20b\b|(?:other\s+)?(?:machinery|equipment)\s+rent).*?(\(?-?\$?\d[\d,]*(?:\.\d{0,2})?\)?)/i },
  // Line 21 — Repairs
  { key: "SCH_C_REPAIRS", pattern: /(?:line\s+21\b|repairs?\s+and\s+maintenance).*?(\(?-?\$?\d[\d,]*(?:\.\d{0,2})?\)?)/i },
  // Line 22 — Supplies
  { key: "SCH_C_SUPPLIES", pattern: /(?:line\s+22\b|supplies).*?(\(?-?\$?\d[\d,]*(?:\.\d{0,2})?\)?)/i },
  // Line 23 — Taxes and licenses
  { key: "SCH_C_TAXES_LICENSES", pattern: /(?:line\s+23\b|taxes\s+and\s+licenses).*?(\(?-?\$?\d[\d,]*(?:\.\d{0,2})?\)?)/i },
  // Line 24a — Travel
  { key: "SCH_C_TRAVEL", pattern: /(?:line\s+24a?\b|travel(?:\s+expense)?).*?(\(?-?\$?\d[\d,]*(?:\.\d{0,2})?\)?)/i },
  // Line 24b — Meals
  { key: "SCH_C_MEALS", pattern: /(?:line\s+24b\b|meals?\s+\(?deductible).*?(\(?-?\$?\d[\d,]*(?:\.\d{0,2})?\)?)/i },
  // Line 25 — Utilities
  { key: "SCH_C_UTILITIES", pattern: /(?:line\s+25\b|utilities).*?(\(?-?\$?\d[\d,]*(?:\.\d{0,2})?\)?)/i },
  // Line 26 — Wages
  { key: "SCH_C_WAGES", pattern: /(?:line\s+26\b|wages?\s+\(?less).*?(\(?-?\$?\d[\d,]*(?:\.\d{0,2})?\)?)/i },
  // Line 27a — Other expenses
  { key: "SCH_C_OTHER_EXPENSES", pattern: /(?:line\s+27a?\b|other\s+expenses?).*?(\(?-?\$?\d[\d,]*(?:\.\d{0,2})?\)?)/i },
  // Line 28 — Total expenses
  { key: "SCH_C_TOTAL_EXPENSES", pattern: /(?:line\s+28\b|total\s+expenses?).*?(\(?-?\$?\d[\d,]*(?:\.\d{0,2})?\)?)/i },
  // Line 30 — Home office
  { key: "SCH_C_HOME_OFFICE", pattern: /(?:line\s+30\b|business\s+use\s+of\s+home).*?(\(?-?\$?\d[\d,]*(?:\.\d{0,2})?\)?)/i },
  // Line 31 — Net profit
  { key: "SCH_C_NET_PROFIT", pattern: /(?:line\s+31\b|net\s+profit\s+(?:or|\()?\s*loss).*?(\(?-?\$?\d[\d,]*(?:\.\d{0,2})?\)?)/i },
];

// Header patterns
const BUSINESS_NAME_RE = /(?:principal\s+business|business\s+name|name\s+of\s+proprietor)[:\s]*([A-Za-z][A-Za-z0-9\s,.'&()-]+?)(?:\n|$)/i;
const NAICS_RE = /(?:NAICS(?:\s+code)?|business\s+code|principal\s+business.*?code)[:\s]*(\d{4,6})/i;

// ---------------------------------------------------------------------------
// Main extractor
// ---------------------------------------------------------------------------

export function extractScheduleC(
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
        for (const lp of SCH_C_PATTERNS) {
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

  // -- OCR regex extraction --
  for (const lp of SCH_C_PATTERNS) {
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

  // -- Text header fields --
  const nameMatch = ocrText.match(BUSINESS_NAME_RE);
  if (nameMatch) {
    factsAttempted++;
    items.push({
      key: "SCH_C_BUSINESS_NAME",
      value: 0,
      period,
      snippet: nameMatch[1].trim(),
    });
  }

  const naicsMatch = ocrText.match(NAICS_RE);
  if (naicsMatch) {
    factsAttempted++;
    items.push({
      key: "SCH_C_NAICS",
      value: parseInt(naicsMatch[1], 10),
      period,
      snippet: naicsMatch[0].replace(/\s+/g, " ").trim(),
    });
  }

  const validItems = items.filter((i) => VALID_LINE_KEYS.has(i.key));

  return {
    ok: validItems.length > 0,
    items: validItems,
    extractionPath,
    factsAttempted,
  };
}
