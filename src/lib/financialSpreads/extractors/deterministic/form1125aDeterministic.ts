/**
 * Form 1125-A Deterministic Extractor — Cost of Goods Sold
 *
 * Extracts COGS detail (inventory, purchases, labor, 263A costs)
 * plus inventory method (FIFO/LIFO) and LIFO reserve flag
 * per God Tier Phase 2 spec Layer 4C.
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
  "F1125A_BEGIN_INVENTORY",
  "F1125A_PURCHASES",
  "F1125A_DIRECT_LABOR",
  "F1125A_263A_COSTS",
  "F1125A_OTHER_COSTS",
  "F1125A_TOTAL_BEFORE_CLOSING",
  "F1125A_END_INVENTORY",
  "F1125A_COGS",
  "F1125A_INVENTORY_METHOD",
  "F1125A_LIFO_ELECTED",
]);

// ---------------------------------------------------------------------------
// Patterns — numeric line items
// ---------------------------------------------------------------------------

type LinePattern = { key: string; pattern: RegExp };

const F1125A_PATTERNS: LinePattern[] = [
  // Line 1 — Inventory at beginning of year
  { key: "F1125A_BEGIN_INVENTORY", pattern: /(?:line\s+1\b|inventory\s+(?:at\s+)?begin(?:ning)?(?:\s+of\s+(?:the\s+)?year)?).*?(\(?-?\$?\d[\d,]*(?:\.\d{0,2})?\)?)/i },
  // Line 2 — Purchases
  { key: "F1125A_PURCHASES", pattern: /(?:line\s+2\b|purchases?).*?(\(?-?\$?\d[\d,]*(?:\.\d{0,2})?\)?)/i },
  // Line 3 — Cost of labor
  { key: "F1125A_DIRECT_LABOR", pattern: /(?:line\s+3\b|cost\s+of\s+labor|direct\s+labor).*?(\(?-?\$?\d[\d,]*(?:\.\d{0,2})?\)?)/i },
  // Line 4 — Additional §263A costs
  { key: "F1125A_263A_COSTS", pattern: /(?:line\s+4\b|263A|additional\s+section\s+263A|uniform\s+capitalization).*?(\(?-?\$?\d[\d,]*(?:\.\d{0,2})?\)?)/i },
  // Line 5 — Other costs
  { key: "F1125A_OTHER_COSTS", pattern: /(?:line\s+5\b|other\s+costs?).*?(\(?-?\$?\d[\d,]*(?:\.\d{0,2})?\)?)/i },
  // Line 6 — Total
  { key: "F1125A_TOTAL_BEFORE_CLOSING", pattern: /(?:line\s+6\b|total\s+(?:of\s+)?lines?\s+1\s+through\s+5).*?(\(?-?\$?\d[\d,]*(?:\.\d{0,2})?\)?)/i },
  // Line 7 — Inventory at end of year
  { key: "F1125A_END_INVENTORY", pattern: /(?:line\s+7\b|inventory\s+(?:at\s+)?end(?:ing)?(?:\s+of\s+(?:the\s+)?year)?).*?(\(?-?\$?\d[\d,]*(?:\.\d{0,2})?\)?)/i },
  // Line 8 — Cost of goods sold
  { key: "F1125A_COGS", pattern: /(?:line\s+8\b|cost\s+of\s+goods\s+sold).*?(\(?-?\$?\d[\d,]*(?:\.\d{0,2})?\)?)/i },
];

// ---------------------------------------------------------------------------
// Patterns — inventory method & LIFO election
// ---------------------------------------------------------------------------

const INVENTORY_METHOD_PATTERN = /(?:inventory\s+method|method\s+of\s+valuing)[:\s]*(FIFO|LIFO|specific\s+identification|lower\s+of\s+cost\s+or\s+market)/i;
const LIFO_ELECTED_PATTERN = /(?:LIFO\s+elect(?:ed|ion)|was\s+LIFO.*?adopted)\s*(?:[:=\s]*)(yes|no|true|false|x)/i;

// ---------------------------------------------------------------------------
// Main extractor
// ---------------------------------------------------------------------------

export function extractForm1125A(
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
        for (const lp of F1125A_PATTERNS) {
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

  // -- OCR regex — numeric fields --
  for (const lp of F1125A_PATTERNS) {
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

  // -- Inventory method --
  factsAttempted++;
  const methodMatch = ocrText.match(INVENTORY_METHOD_PATTERN);
  if (methodMatch) {
    const methodRaw = methodMatch[1].toLowerCase().trim();
    let method: string;
    if (methodRaw.startsWith("fifo")) method = "FIFO";
    else if (methodRaw.startsWith("lifo")) method = "LIFO";
    else if (methodRaw.startsWith("specific")) method = "SPECIFIC_IDENTIFICATION";
    else method = "LOWER_OF_COST_OR_MARKET";

    items.push({
      key: "F1125A_INVENTORY_METHOD",
      value: method,
      period,
      snippet: methodMatch[0].replace(/\s+/g, " ").trim().slice(0, 120),
    });
  }

  // -- LIFO election --
  factsAttempted++;
  const lifoMatch = ocrText.match(LIFO_ELECTED_PATTERN);
  if (lifoMatch) {
    const raw = lifoMatch[1].toLowerCase();
    const elected = raw === "yes" || raw === "true" || raw === "x";
    items.push({
      key: "F1125A_LIFO_ELECTED",
      value: elected,
      period,
      snippet: lifoMatch[0].replace(/\s+/g, " ").trim().slice(0, 120),
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

// ---------------------------------------------------------------------------
// LIFO Reserve normalization (pure computation)
// ---------------------------------------------------------------------------

export type LifoNormalizationResult = {
  fifoInventory: number;
  fifoCogs: number;
  lifoReserveAdjustment: number;
};

/**
 * LIFO → FIFO normalization per spec:
 *   FIFO Inventory = LIFO Inventory + LIFO Reserve
 *   FIFO COGS = LIFO COGS − Change in LIFO Reserve
 */
export function normalizeLifoToFifo(
  lifoInventory: number,
  lifoCogs: number,
  currentLifoReserve: number,
  priorLifoReserve: number,
): LifoNormalizationResult {
  const fifoInventory = lifoInventory + currentLifoReserve;
  const changeInReserve = currentLifoReserve - priorLifoReserve;
  const fifoCogs = lifoCogs - changeInReserve;
  return {
    fifoInventory,
    fifoCogs,
    lifoReserveAdjustment: changeInReserve,
  };
}
