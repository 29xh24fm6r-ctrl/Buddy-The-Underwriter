/**
 * K-1 Deterministic Extractor — Schedule K-1 (1120-S and 1065)
 *
 * Extracts all boxes per God Tier spec Section 2D.
 * Pure deterministic extraction — regex + structured JSON, no LLMs.
 */

import type {
  DeterministicExtractorArgs,
  PureDeterministicResult,
  PureLineItem,
  ExtractionPath,
} from "./types";
import { parseMoney, resolveDocTaxYear } from "./parseUtils";
import { extractEntitiesFlat, extractFormFields, entityToMoney } from "./structuredJsonParser";

// ---------------------------------------------------------------------------
// Valid K-1 line keys (spec Section 2D)
// ---------------------------------------------------------------------------

const VALID_LINE_KEYS = new Set([
  "K1_OWNER_NAME",
  "K1_ENTITY_EIN",
  "K1_OWNERSHIP_PCT",
  "K1_CAP_ACCT_BEGIN",
  "K1_CAP_ACCT_END",
  "K1_ORDINARY_INCOME",
  "K1_RENTAL_RE_INCOME",
  "K1_OTHER_RENTAL",
  "K1_GUARANTEED_PAYMENTS",
  "K1_INTEREST_INCOME",
  "K1_QUALIFIED_DIVIDENDS",
  "K1_ORDINARY_DIVIDENDS",
  "K1_ROYALTIES",
  "K1_ST_CAP_GAIN",
  "K1_LT_CAP_GAIN",
  "K1_1231_GAIN",
  "K1_OTHER_INCOME",
  "K1_SEC179_DEDUCTION",
  "K1_CASH_DISTRIBUTIONS",
  "K1_OTHER_INFO",
]);

// ---------------------------------------------------------------------------
// Box-level extraction patterns
// ---------------------------------------------------------------------------

type BoxPattern = { key: string; pattern: RegExp };

const K1_BOX_PATTERNS: BoxPattern[] = [
  // Box 1 — Ordinary business income
  { key: "K1_ORDINARY_INCOME", pattern: /(?:box\s+1\b|ordinary\s+(?:business\s+)?income).*?(\(?-?\$?\d[\d,]*(?:\.\d{0,2})?\)?)/i },
  // Box 2 — Net rental real estate income
  { key: "K1_RENTAL_RE_INCOME", pattern: /(?:box\s+2\b|net\s+rental\s+real\s+estate).*?(\(?-?\$?\d[\d,]*(?:\.\d{0,2})?\)?)/i },
  // Box 3 — Other net rental income
  { key: "K1_OTHER_RENTAL", pattern: /(?:box\s+3\b|other\s+(?:net\s+)?rental\s+income).*?(\(?-?\$?\d[\d,]*(?:\.\d{0,2})?\)?)/i },
  // Box 4 — Guaranteed payments (1065 only)
  { key: "K1_GUARANTEED_PAYMENTS", pattern: /(?:box\s+4\b|guaranteed\s+payments?).*?(\(?-?\$?\d[\d,]*(?:\.\d{0,2})?\)?)/i },
  // Box 5a — Interest income
  { key: "K1_INTEREST_INCOME", pattern: /(?:box\s+5a?\b|interest\s+income).*?(\(?-?\$?\d[\d,]*(?:\.\d{0,2})?\)?)/i },
  // Box 5b — Qualified dividends
  { key: "K1_QUALIFIED_DIVIDENDS", pattern: /(?:box\s+5b\b|qualified\s+dividends?).*?(\(?-?\$?\d[\d,]*(?:\.\d{0,2})?\)?)/i },
  // Box 6a — Ordinary dividends
  { key: "K1_ORDINARY_DIVIDENDS", pattern: /(?:box\s+6a?\b|ordinary\s+dividends?).*?(\(?-?\$?\d[\d,]*(?:\.\d{0,2})?\)?)/i },
  // Box 7 — Royalties
  { key: "K1_ROYALTIES", pattern: /(?:box\s+7\b|royalties).*?(\(?-?\$?\d[\d,]*(?:\.\d{0,2})?\)?)/i },
  // Box 8 — Net short-term capital gain
  { key: "K1_ST_CAP_GAIN", pattern: /(?:box\s+8\b|(?:net\s+)?short[\s-]term\s+capital\s+gain).*?(\(?-?\$?\d[\d,]*(?:\.\d{0,2})?\)?)/i },
  // Box 9a — Net long-term capital gain
  { key: "K1_LT_CAP_GAIN", pattern: /(?:box\s+9a?\b|(?:net\s+)?long[\s-]term\s+capital\s+gain).*?(\(?-?\$?\d[\d,]*(?:\.\d{0,2})?\)?)/i },
  // Box 10 — Net Section 1231 gain
  { key: "K1_1231_GAIN", pattern: /(?:box\s+10\b|section\s+1231\s+gain).*?(\(?-?\$?\d[\d,]*(?:\.\d{0,2})?\)?)/i },
  // Box 11 — Other income
  { key: "K1_OTHER_INCOME", pattern: /(?:box\s+11\b|other\s+income).*?(\(?-?\$?\d[\d,]*(?:\.\d{0,2})?\)?)/i },
  // Box 12/13 — Section 179 deduction
  { key: "K1_SEC179_DEDUCTION", pattern: /(?:box\s+1[23]\b|section\s+179).*?(\(?-?\$?\d[\d,]*(?:\.\d{0,2})?\)?)/i },
  // Box 16/19 — Cash distributions
  { key: "K1_CASH_DISTRIBUTIONS", pattern: /(?:box\s+(?:16[d]?|19[a]?)\b|(?:cash\s+)?distributions?).*?(\(?-?\$?\d[\d,]*(?:\.\d{0,2})?\)?)/i },
];

// Header extraction patterns
const OWNER_NAME_PATTERNS = [
  /(?:partner(?:'s)?\s+name|shareholder(?:'s)?\s+name|name\s+of\s+partner|name\s+of\s+shareholder)[:\s]*([A-Z][A-Za-z\s,.'()-]+?)(?:\n|$)/i,
];

const EIN_PATTERNS = [
  /(?:employer\s+identification(?:\s+number)?|EIN|tax\s+identification(?:\s+number)?)[:\s]*(\d{2}[\s-]?\d{7})/i,
];

const OWNERSHIP_PATTERNS = [
  /(?:ownership|profit\s+sharing|profit\s*%|share\s*%|percentage)[:\s]*([\d.]+)\s*%/i,
  /(?:profit|loss|capital)\s+(?:sharing\s+)?(?:percentage|percent|%)[:\s]*([\d.]+)/i,
];

const CAP_ACCOUNT_PATTERNS = [
  { key: "K1_CAP_ACCT_BEGIN", pattern: /(?:beginning\s+capital\s+account|beginning\s+balance|capital\s+account.*?beginning).*?(\(?-?\$?\d[\d,]*(?:\.\d{0,2})?\)?)/i },
  { key: "K1_CAP_ACCT_END", pattern: /(?:ending\s+capital\s+account|ending\s+balance|capital\s+account.*?ending).*?(\(?-?\$?\d[\d,]*(?:\.\d{0,2})?\)?)/i },
];

// ---------------------------------------------------------------------------
// Main extractor
// ---------------------------------------------------------------------------

export function extractK1(
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
    const entities = extractEntitiesFlat(structuredJson);
    const formFields = extractFormFields(structuredJson);

    if (entities.length > 0 || formFields.length > 0) {
      extractionPath = "gemini_structured";

      // Extract from form fields
      for (const field of formFields) {
        const upperName = field.name.toUpperCase().replace(/[\s-]+/g, "_");
        for (const bp of K1_BOX_PATTERNS) {
          if (bp.pattern.test(field.name) || upperName.includes(bp.key.replace("K1_", ""))) {
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

      // Extract from entities
      for (const entity of entities) {
        const etype = entity.type.toUpperCase().replace(/[\s-]+/g, "_");
        for (const bp of K1_BOX_PATTERNS) {
          if (etype.includes(bp.key.replace("K1_", ""))) {
            const val = entityToMoney(entity);
            if (val !== null) {
              factsAttempted++;
              items.push({
                key: bp.key,
                value: val,
                period,
                snippet: entity.mentionText,
              });
              break;
            }
          }
        }
      }
    }
  }

  // -- OCR regex fallback / supplement --
  for (const bp of K1_BOX_PATTERNS) {
    // Skip if already found via structured JSON
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

  // -- Capital account extraction --
  for (const cap of CAP_ACCOUNT_PATTERNS) {
    if (items.some((i) => i.key === cap.key)) continue;
    factsAttempted++;
    const match = ocrText.match(cap.pattern);
    if (match) {
      const val = parseMoney(match[1]);
      if (val !== null) {
        items.push({
          key: cap.key,
          value: val,
          period,
          snippet: match[0].replace(/\s+/g, " ").trim().slice(0, 120),
        });
      }
    }
  }

  // -- Header fields (text only, not numeric) --
  for (const pat of OWNER_NAME_PATTERNS) {
    const m = ocrText.match(pat);
    if (m) {
      factsAttempted++;
      items.push({
        key: "K1_OWNER_NAME",
        value: 0, // text field — stored in snippet
        period,
        snippet: m[1].trim(),
      });
      break;
    }
  }

  for (const pat of EIN_PATTERNS) {
    const m = ocrText.match(pat);
    if (m) {
      factsAttempted++;
      items.push({
        key: "K1_ENTITY_EIN",
        value: 0, // text field — stored in snippet
        period,
        snippet: m[1].replace(/\s/g, ""),
      });
      break;
    }
  }

  for (const pat of OWNERSHIP_PATTERNS) {
    const m = ocrText.match(pat);
    if (m) {
      factsAttempted++;
      const pct = parseFloat(m[1]);
      if (!isNaN(pct)) {
        items.push({
          key: "K1_OWNERSHIP_PCT",
          value: pct,
          period,
          snippet: m[0].replace(/\s+/g, " ").trim().slice(0, 80),
        });
      }
      break;
    }
  }

  // Filter to valid keys only
  const validItems = items.filter((i) => VALID_LINE_KEYS.has(i.key));

  return {
    ok: validItems.length > 0,
    items: validItems,
    extractionPath,
    factsAttempted,
  };
}
