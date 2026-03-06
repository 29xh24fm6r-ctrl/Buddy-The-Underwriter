/**
 * Form 8825 Deterministic Extractor — Rental Real Estate Income & Expenses
 *
 * Extracts per-property rental data from Form 8825
 * (partnership/S-corp rental real estate).
 * Per-property: description, kind, fair rental days, personal use days,
 * gross rents, all expense columns, net income.
 *
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
// Valid keys (f8825_ prefix per spec)
// ---------------------------------------------------------------------------

const VALID_LINE_KEYS = new Set([
  "F8825_PROPERTY_DESCRIPTION",
  "F8825_PROPERTY_KIND",
  "F8825_FAIR_RENTAL_DAYS",
  "F8825_PERSONAL_USE_DAYS",
  "F8825_GROSS_RENTS",
  "F8825_ADVERTISING",
  "F8825_AUTO_TRAVEL",
  "F8825_CLEANING_MAINTENANCE",
  "F8825_COMMISSIONS",
  "F8825_INSURANCE",
  "F8825_LEGAL_PROFESSIONAL",
  "F8825_MANAGEMENT_FEES",
  "F8825_MORTGAGE_INTEREST",
  "F8825_OTHER_INTEREST",
  "F8825_REPAIRS",
  "F8825_TAXES",
  "F8825_UTILITIES",
  "F8825_DEPRECIATION",
  "F8825_OTHER_EXPENSES",
  "F8825_TOTAL_EXPENSES",
  "F8825_NET_INCOME",
  "F8825_TOTAL_GROSS_RENTS",
  "F8825_TOTAL_NET_INCOME",
  "F8825_TOTAL_DEPRECIATION",
]);

// ---------------------------------------------------------------------------
// Patterns — per-property expense lines
// ---------------------------------------------------------------------------

type LinePattern = { key: string; pattern: RegExp };

const EXPENSE_PATTERNS: LinePattern[] = [
  { key: "F8825_ADVERTISING",          pattern: /(?:line\s+3a?\b|advertising).*?(\(?-?\$?\d[\d,]*(?:\.\d{0,2})?\)?)/i },
  { key: "F8825_AUTO_TRAVEL",          pattern: /(?:line\s+3b\b|auto\s+and\s+travel|auto\/travel).*?(\(?-?\$?\d[\d,]*(?:\.\d{0,2})?\)?)/i },
  { key: "F8825_CLEANING_MAINTENANCE", pattern: /(?:line\s+4\b|cleaning\s+and\s+maintenance|cleaning\/maintenance).*?(\(?-?\$?\d[\d,]*(?:\.\d{0,2})?\)?)/i },
  { key: "F8825_COMMISSIONS",          pattern: /(?:line\s+5\b|commissions?).*?(\(?-?\$?\d[\d,]*(?:\.\d{0,2})?\)?)/i },
  { key: "F8825_INSURANCE",            pattern: /(?:line\s+6\b|insurance).*?(\(?-?\$?\d[\d,]*(?:\.\d{0,2})?\)?)/i },
  { key: "F8825_LEGAL_PROFESSIONAL",   pattern: /(?:line\s+7\b|legal\s+and\s+(?:other\s+)?professional|legal\/professional).*?(\(?-?\$?\d[\d,]*(?:\.\d{0,2})?\)?)/i },
  { key: "F8825_MANAGEMENT_FEES",      pattern: /(?:line\s+8\b|management\s+fees?).*?(\(?-?\$?\d[\d,]*(?:\.\d{0,2})?\)?)/i },
  { key: "F8825_MORTGAGE_INTEREST",    pattern: /(?:line\s+9\b|mortgage\s+interest\s+paid).*?(\(?-?\$?\d[\d,]*(?:\.\d{0,2})?\)?)/i },
  { key: "F8825_OTHER_INTEREST",       pattern: /(?:line\s+10\b|other\s+interest).*?(\(?-?\$?\d[\d,]*(?:\.\d{0,2})?\)?)/i },
  { key: "F8825_REPAIRS",              pattern: /(?:line\s+11\b|repairs?).*?(\(?-?\$?\d[\d,]*(?:\.\d{0,2})?\)?)/i },
  { key: "F8825_TAXES",                pattern: /(?:line\s+12\b|(?:property\s+)?taxes).*?(\(?-?\$?\d[\d,]*(?:\.\d{0,2})?\)?)/i },
  { key: "F8825_UTILITIES",            pattern: /(?:line\s+13\b|utilities).*?(\(?-?\$?\d[\d,]*(?:\.\d{0,2})?\)?)/i },
  { key: "F8825_DEPRECIATION",         pattern: /(?:line\s+14\b|depreciation).*?(\(?-?\$?\d[\d,]*(?:\.\d{0,2})?\)?)/i },
  { key: "F8825_OTHER_EXPENSES",       pattern: /(?:line\s+15\b|other\s+expenses?).*?(\(?-?\$?\d[\d,]*(?:\.\d{0,2})?\)?)/i },
  { key: "F8825_TOTAL_EXPENSES",       pattern: /(?:line\s+16\b|total\s+expenses?).*?(\(?-?\$?\d[\d,]*(?:\.\d{0,2})?\)?)/i },
  { key: "F8825_NET_INCOME",           pattern: /(?:line\s+17\b|net\s+(?:income|loss)\s+(?:per|for)\s+(?:each\s+)?property|net\s+rental\s+income).*?(\(?-?\$?\d[\d,]*(?:\.\d{0,2})?\)?)/i },
];

// ---------------------------------------------------------------------------
// Patterns — property header and summary
// ---------------------------------------------------------------------------

const PROPERTY_DESC_PATTERN = /(?:description\s+of\s+property|property\s+(?:address|description|name))[:\s]*(.+)/i;
const PROPERTY_KIND_PATTERN = /(?:kind\s+of\s+property|type\s+of\s+property|property\s+type)[:\s]*(residential|commercial|industrial|land|mixed[\s-]?use|office|retail|multi[\s-]?family)/i;
const FAIR_RENTAL_DAYS_PATTERN = /(?:fair\s+rental\s+days|rental\s+days)[:\s]*(\d+)/i;
const PERSONAL_USE_DAYS_PATTERN = /(?:personal\s+use\s+days|personal\s+days)[:\s]*(\d+)/i;
const GROSS_RENTS_PATTERN = /(?:line\s+2\b|gross\s+rents?\s+received|gross\s+rents?|rents?\s+received).*?(\(?-?\$?\d[\d,]*(?:\.\d{0,2})?\)?)/i;

// Total summary patterns
const TOTAL_GROSS_RENTS_PATTERN = /(?:line\s+18\b|total\s+gross\s+rents?).*?(\(?-?\$?\d[\d,]*(?:\.\d{0,2})?\)?)/i;
const TOTAL_NET_INCOME_PATTERN = /(?:line\s+21\b|total\s+net\s+(?:income|loss)).*?(\(?-?\$?\d[\d,]*(?:\.\d{0,2})?\)?)/i;
const TOTAL_DEPRECIATION_PATTERN = /(?:line\s+20\b|total\s+depreciation).*?(\(?-?\$?\d[\d,]*(?:\.\d{0,2})?\)?)/i;

// ---------------------------------------------------------------------------
// Main extractor
// ---------------------------------------------------------------------------

export function extractForm8825(
  args: DeterministicExtractorArgs,
): PureDeterministicResult {
  const { ocrText, structuredJson, docYear } = args;
  const items: PureLineItem[] = [];
  let extractionPath: ExtractionPath = "ocr_regex";
  let factsAttempted = 0;

  const taxYear = resolveDocTaxYear(ocrText, docYear);
  const period = taxYear ? String(taxYear) : null;

  // -- Structured JSON path --
  if (structuredJson) {
    const formFields = extractFormFields(structuredJson);
    if (formFields.length > 0) {
      extractionPath = "gemini_structured";
      for (const field of formFields) {
        // Combine name+value — patterns expect label+amount on one line
        const combined = `${field.name} ${field.value}`;

        // Property description
        const descMatch = combined.match(PROPERTY_DESC_PATTERN);
        if (descMatch) {
          factsAttempted++;
          items.push({
            key: "F8825_PROPERTY_DESCRIPTION",
            value: descMatch[1].trim(),
            period,
            snippet: `${field.name}: ${field.value}`,
          });
        }
        // Gross rents
        if (GROSS_RENTS_PATTERN.test(combined)) {
          const val = parseMoney(field.value);
          if (val !== null) {
            factsAttempted++;
            items.push({
              key: "F8825_GROSS_RENTS",
              value: val,
              period,
              snippet: `${field.name}: ${field.value}`,
            });
          }
        }
        // Expense lines
        for (const lp of EXPENSE_PATTERNS) {
          if (lp.pattern.test(combined)) {
            const val = parseMoney(field.value);
            if (val !== null) {
              factsAttempted++;
              items.push({
                key: lp.key,
                value: val,
                period,
                snippet: `${field.name}: ${field.value}`,
              });
            }
            break;
          }
        }
      }
    }
  }

  // -- OCR regex — property metadata --
  factsAttempted++;
  const descMatch = ocrText.match(PROPERTY_DESC_PATTERN);
  if (descMatch && !items.some((i) => i.key === "F8825_PROPERTY_DESCRIPTION")) {
    items.push({
      key: "F8825_PROPERTY_DESCRIPTION",
      value: descMatch[1].trim(),
      period,
      snippet: descMatch[0].replace(/\s+/g, " ").trim().slice(0, 120),
    });
  }

  factsAttempted++;
  const kindMatch = ocrText.match(PROPERTY_KIND_PATTERN);
  if (kindMatch) {
    items.push({
      key: "F8825_PROPERTY_KIND",
      value: kindMatch[1].trim().toLowerCase(),
      period,
      snippet: kindMatch[0].replace(/\s+/g, " ").trim().slice(0, 120),
    });
  }

  factsAttempted++;
  const fairDaysMatch = ocrText.match(FAIR_RENTAL_DAYS_PATTERN);
  if (fairDaysMatch) {
    items.push({
      key: "F8825_FAIR_RENTAL_DAYS",
      value: parseInt(fairDaysMatch[1], 10),
      period,
      snippet: `Fair rental days: ${fairDaysMatch[1]}`,
    });
  }

  factsAttempted++;
  const personalDaysMatch = ocrText.match(PERSONAL_USE_DAYS_PATTERN);
  if (personalDaysMatch) {
    items.push({
      key: "F8825_PERSONAL_USE_DAYS",
      value: parseInt(personalDaysMatch[1], 10),
      period,
      snippet: `Personal use days: ${personalDaysMatch[1]}`,
    });
  }

  // -- OCR regex — gross rents --
  if (!items.some((i) => i.key === "F8825_GROSS_RENTS")) {
    factsAttempted++;
    const rentsMatch = ocrText.match(GROSS_RENTS_PATTERN);
    if (rentsMatch) {
      const val = parseMoney(rentsMatch[1]);
      if (val !== null) {
        items.push({
          key: "F8825_GROSS_RENTS",
          value: val,
          period,
          snippet: rentsMatch[0].replace(/\s+/g, " ").trim().slice(0, 120),
        });
      }
    }
  }

  // -- OCR regex — expense lines --
  for (const lp of EXPENSE_PATTERNS) {
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

  // -- OCR regex — totals (all properties) --
  factsAttempted++;
  const totalRentsMatch = ocrText.match(TOTAL_GROSS_RENTS_PATTERN);
  if (totalRentsMatch) {
    const val = parseMoney(totalRentsMatch[1]);
    if (val !== null) {
      items.push({
        key: "F8825_TOTAL_GROSS_RENTS",
        value: val,
        period,
        snippet: totalRentsMatch[0].replace(/\s+/g, " ").trim().slice(0, 120),
      });
    }
  }

  factsAttempted++;
  const totalDeprecMatch = ocrText.match(TOTAL_DEPRECIATION_PATTERN);
  if (totalDeprecMatch) {
    const val = parseMoney(totalDeprecMatch[1]);
    if (val !== null) {
      items.push({
        key: "F8825_TOTAL_DEPRECIATION",
        value: val,
        period,
        snippet: totalDeprecMatch[0].replace(/\s+/g, " ").trim().slice(0, 120),
      });
    }
  }

  factsAttempted++;
  const totalNetMatch = ocrText.match(TOTAL_NET_INCOME_PATTERN);
  if (totalNetMatch) {
    const val = parseMoney(totalNetMatch[1]);
    if (val !== null) {
      items.push({
        key: "F8825_TOTAL_NET_INCOME",
        value: val,
        period,
        snippet: totalNetMatch[0].replace(/\s+/g, " ").trim().slice(0, 120),
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
