/**
 * Schedule E Deterministic Extractor — Supplemental Income
 *
 * Extracts Part I (rental properties) and Part II (K-1 pass-throughs)
 * per God Tier spec Section 3D.
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
// Valid Schedule E line keys (spec Section 3D)
// ---------------------------------------------------------------------------

const VALID_LINE_KEYS = new Set([
  // Part I — Rental Real Estate
  "SCH_E_PROPERTY_ADDRESS",
  "SCH_E_RENTS_RECEIVED",
  "SCH_E_ROYALTIES_RECEIVED",
  "SCH_E_MORTGAGE_INTEREST",
  "SCH_E_DEPRECIATION",
  "SCH_E_NET_PER_PROPERTY",
  "SCH_E_PASSIVE_LOSS",
  "SCH_E_RENTAL_TOTAL",
  // Part II — Partnerships / S-Corps
  "SCH_E_ENTITY_NAME",
  "SCH_E_PASSIVE_FLAG",
  "SCH_E_PASSIVE_INCOME",
  "SCH_E_NONPASSIVE_LOSS",
  "SCH_E_PASSIVE_LOSS_LIMITED",
  "SCH_E_NONPASSIVE_INCOME",
]);

// ---------------------------------------------------------------------------
// Line extraction patterns
// ---------------------------------------------------------------------------

type LinePattern = { key: string; pattern: RegExp };

// Part I patterns
const PART_I_PATTERNS: LinePattern[] = [
  { key: "SCH_E_RENTS_RECEIVED", pattern: /(?:line\s+3\b|rents?\s+received).*?(\(?-?\$?\d[\d,]*(?:\.\d{0,2})?\)?)/i },
  { key: "SCH_E_ROYALTIES_RECEIVED", pattern: /(?:line\s+4\b|royalties?\s+received).*?(\(?-?\$?\d[\d,]*(?:\.\d{0,2})?\)?)/i },
  { key: "SCH_E_MORTGAGE_INTEREST", pattern: /(?:line\s+12\b|mortgage\s+interest\s+paid).*?(\(?-?\$?\d[\d,]*(?:\.\d{0,2})?\)?)/i },
  { key: "SCH_E_DEPRECIATION", pattern: /(?:line\s+18\b|depreciation\s+expense).*?(\$[\d,]+(?:\.\d{0,2})?)/i },
  { key: "SCH_E_NET_PER_PROPERTY", pattern: /(?:line\s+22\b|net\s+(?:income|loss)\s+(?:or|per)\s+(?:loss\s+)?(?:per\s+)?property).*?(\(?-?\$?\d[\d,]*(?:\.\d{0,2})?\)?)/i },
  { key: "SCH_E_PASSIVE_LOSS", pattern: /(?:line\s+23[a-c]?\b|passive\s+(?:activity\s+)?loss).*?(\(?-?\$?\d[\d,]*(?:\.\d{0,2})?\)?)/i },
  { key: "SCH_E_RENTAL_TOTAL", pattern: /(?:line\s+26\b|total\s+rental\s+real\s+estate).*?(\(?-?\$?\d[\d,]*(?:\.\d{0,2})?\)?)/i },
];

// Part II patterns
const PART_II_PATTERNS: LinePattern[] = [
  { key: "SCH_E_PASSIVE_INCOME", pattern: /(?:line\s+28a\b|passive\s+income).*?(\(?-?\$?\d[\d,]*(?:\.\d{0,2})?\)?)/i },
  { key: "SCH_E_NONPASSIVE_LOSS", pattern: /(?:line\s+28b\b|nonpassive\s+loss).*?(\(?-?\$?\d[\d,]*(?:\.\d{0,2})?\)?)/i },
  { key: "SCH_E_PASSIVE_LOSS_LIMITED", pattern: /(?:line\s+28c\b|passive\s+loss.*?limitation).*?(\(?-?\$?\d[\d,]*(?:\.\d{0,2})?\)?)/i },
  { key: "SCH_E_NONPASSIVE_INCOME", pattern: /(?:line\s+28d\b|nonpassive\s+income).*?(\(?-?\$?\d[\d,]*(?:\.\d{0,2})?\)?)/i },
];

const ALL_PATTERNS = [...PART_I_PATTERNS, ...PART_II_PATTERNS];

// Header patterns
const PROPERTY_ADDRESS_RE = /(?:property\s+(?:address|location)|col(?:umn)?\s+[abc])[:\s]*([A-Za-z0-9\s,.'#()-]+?)(?:\n|$)/i;
const ENTITY_NAME_RE = /(?:name\s+of\s+entity|partnership\s+name|s[\s-]?corp(?:oration)?\s+name)[:\s]*([A-Za-z][A-Za-z0-9\s,.'&()-]+?)(?:\n|$)/i;
const PASSIVE_FLAG_RE = /(?:passive\s+activity|passive|nonpassive)[:\s]*(passive|nonpassive|yes|no)/i;

// ---------------------------------------------------------------------------
// Main extractor
// ---------------------------------------------------------------------------

export function extractScheduleE(
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
        for (const lp of ALL_PATTERNS) {
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
  for (const lp of ALL_PATTERNS) {
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
  const propMatch = ocrText.match(PROPERTY_ADDRESS_RE);
  if (propMatch) {
    factsAttempted++;
    items.push({
      key: "SCH_E_PROPERTY_ADDRESS",
      value: 0,
      period,
      snippet: propMatch[1].trim(),
    });
  }

  const entityMatch = ocrText.match(ENTITY_NAME_RE);
  if (entityMatch) {
    factsAttempted++;
    items.push({
      key: "SCH_E_ENTITY_NAME",
      value: 0,
      period,
      snippet: entityMatch[1].trim(),
    });
  }

  const passiveMatch = ocrText.match(PASSIVE_FLAG_RE);
  if (passiveMatch) {
    factsAttempted++;
    items.push({
      key: "SCH_E_PASSIVE_FLAG",
      value: 0,
      period,
      snippet: passiveMatch[1].toLowerCase(),
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
