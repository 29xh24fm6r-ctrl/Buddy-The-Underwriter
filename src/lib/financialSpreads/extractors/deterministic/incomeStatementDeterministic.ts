import "server-only";

import type { FinancialFactProvenance } from "@/lib/financialFacts/keys";
import {
  normalizePeriod,
  writeFactsBatch,
  type ExtractedLineItem,
  type ExtractionResult,
} from "../shared";
import type { DeterministicExtractorArgs, ExtractionPath } from "./types";
import { findLabeledAmount, findDateOnDocument, extractPeriodFromHeaders, parseTable, parseMoney } from "./parseUtils";
import {
  extractEntitiesFlat,
  extractTables,
  findEntitiesByType,
  entityToMoney,
} from "./docAiParser";
import { normalizePlLabel } from "../../normalization/plAliases";

// ---------------------------------------------------------------------------
// Canonical line item keys (same as original extractor)
// ---------------------------------------------------------------------------

const VALID_LINE_KEYS = new Set([
  // CRE-specific
  "GROSS_RENTAL_INCOME",
  "VACANCY_CONCESSIONS",
  "OTHER_INCOME",
  "REPAIRS_MAINTENANCE",
  "UTILITIES",
  "PROPERTY_MANAGEMENT",
  "REAL_ESTATE_TAXES",
  "INSURANCE",
  "PAYROLL",
  "MARKETING",
  "PROFESSIONAL_FEES",
  "OTHER_OPEX",
  "DEPRECIATION",
  "AMORTIZATION",
  "DEBT_SERVICE",
  "CAPITAL_EXPENDITURES",
  "EFFECTIVE_GROSS_INCOME",
  "TOTAL_OPERATING_EXPENSES",
  "NET_OPERATING_INCOME",
  "NET_INCOME",
  // General business P&L
  "TOTAL_REVENUE",
  "COST_OF_GOODS_SOLD",
  "GROSS_PROFIT",
  "SELLING_GENERAL_ADMIN",
  "OPERATING_INCOME",
  "EBITDA",
]);

// ---------------------------------------------------------------------------
// Label → canonical key mapping for OCR regex extraction
// ---------------------------------------------------------------------------

const LABEL_PATTERNS: Array<{ key: string; pattern: RegExp }> = [
  // ── General business P&L (checked first — more common) ────────────────
  { key: "TOTAL_REVENUE", pattern: /total\s+(?:sales\s+)?revenue|(?:net|gross)\s+(?:sales|revenue)|total\s+sales|service\s+(?:income|revenue)|fee\s+income/i },
  { key: "COST_OF_GOODS_SOLD", pattern: /cost\s+of\s+(?:goods\s+)?sold|\bCOGS\b|(?:total\s+)?cost\s+of\s+(?:sales|revenue)|direct\s+costs?/i },
  { key: "GROSS_PROFIT", pattern: /gross\s+(?:profit|margin)/i },
  { key: "SELLING_GENERAL_ADMIN", pattern: /selling[\s,]+general\s+(?:&|and)\s+admin|\bSG&?A\b|total\s+general\s+and\s+admin/i },
  { key: "OPERATING_INCOME", pattern: /(?:income|profit|earnings)\s+from\s+operations|operating\s+(?:income|profit|earnings)/i },
  { key: "EBITDA", pattern: /\bEBITDA\b/i },
  // ── CRE-specific ──────────────────────────────────────────────────────
  { key: "GROSS_RENTAL_INCOME", pattern: /gross\s+(?:rental\s+)?income|rental\s+revenue|total\s+rental\s+income/i },
  { key: "VACANCY_CONCESSIONS", pattern: /vacancy|concession|loss\s+to\s+lease|vacancy\s+(?:loss|allowance)/i },
  { key: "OTHER_INCOME", pattern: /other\s+income|miscellaneous\s+income|laundry|parking\s+income|late\s+fees/i },
  { key: "EFFECTIVE_GROSS_INCOME", pattern: /effective\s+gross\s+income|EGI|total\s+income/i },
  // ── Shared operating expense categories ────────────────────────────────
  { key: "REPAIRS_MAINTENANCE", pattern: /repairs?\s*(?:&|and)?\s*maintenance|R&M|marina\s+svcs/i },
  { key: "UTILITIES", pattern: /utilit(?:y|ies)|electric|gas|water|sewer|fuel/i },
  { key: "PROPERTY_MANAGEMENT", pattern: /(?:property\s+)?management\s+(?:fee|expense)|management/i },
  { key: "REAL_ESTATE_TAXES", pattern: /real\s+estate\s+tax|property\s+tax|RE\s+tax/i },
  { key: "INSURANCE", pattern: /\binsurance\b(?!\s+(?:income|value))/i },
  { key: "PAYROLL", pattern: /payroll(?:\s+(?:&|and)\s+labor)?|salaries|wages|employee\s+(?:cost|expense)/i },
  { key: "MARKETING", pattern: /marketing(?:\s+(?:&|and)\s+advertising)?|advertising/i },
  { key: "PROFESSIONAL_FEES", pattern: /professional\s+fees?|legal|accounting|audit/i },
  { key: "OTHER_OPEX", pattern: /other\s+(?:operating\s+)?expense|general\s+(?:&|and)\s+admin|G&A|miscellaneous\s+expense/i },
  { key: "DEPRECIATION", pattern: /\bdepreciation\b/i },
  { key: "AMORTIZATION", pattern: /\bamortization\b/i },
  { key: "DEBT_SERVICE", pattern: /debt\s+service|mortgage\s+payment|loan\s+payment|interest\s+(?:expense|paid)/i },
  { key: "CAPITAL_EXPENDITURES", pattern: /capital\s+(?:expenditure|improvement)|capex|cap\s+ex/i },
  { key: "TOTAL_OPERATING_EXPENSES", pattern: /total\s+(?:operating\s+)?expenses|total\s+opex/i },
  { key: "NET_OPERATING_INCOME", pattern: /net\s+operating\s+income|\bNOI\b/i },
  { key: "NET_INCOME", pattern: /net\s+(?:income|profit|loss)|bottom\s+line/i },
];

// ---------------------------------------------------------------------------
// DocAI entity type → canonical key mapping
// ---------------------------------------------------------------------------

const DOCAI_ENTITY_MAP: Record<string, string> = {
  // General business
  revenue: "TOTAL_REVENUE",
  total_revenue: "TOTAL_REVENUE",
  sales: "TOTAL_REVENUE",
  total_sales: "TOTAL_REVENUE",
  net_sales: "TOTAL_REVENUE",
  cost_of_goods_sold: "COST_OF_GOODS_SOLD",
  cogs: "COST_OF_GOODS_SOLD",
  cost_of_sales: "COST_OF_GOODS_SOLD",
  gross_profit: "GROSS_PROFIT",
  gross_margin: "GROSS_PROFIT",
  operating_income: "OPERATING_INCOME",
  income_from_operations: "OPERATING_INCOME",
  ebitda: "EBITDA",
  sga: "SELLING_GENERAL_ADMIN",
  selling_general_admin: "SELLING_GENERAL_ADMIN",
  // CRE
  gross_income: "GROSS_RENTAL_INCOME",
  rental_income: "GROSS_RENTAL_INCOME",
  total_income: "EFFECTIVE_GROSS_INCOME",
  vacancy: "VACANCY_CONCESSIONS",
  other_income: "OTHER_INCOME",
  repairs: "REPAIRS_MAINTENANCE",
  maintenance: "REPAIRS_MAINTENANCE",
  utilities: "UTILITIES",
  management: "PROPERTY_MANAGEMENT",
  management_fee: "PROPERTY_MANAGEMENT",
  property_tax: "REAL_ESTATE_TAXES",
  taxes: "REAL_ESTATE_TAXES",
  insurance: "INSURANCE",
  payroll: "PAYROLL",
  marketing: "MARKETING",
  professional_fees: "PROFESSIONAL_FEES",
  other_expenses: "OTHER_OPEX",
  depreciation: "DEPRECIATION",
  amortization: "AMORTIZATION",
  debt_service: "DEBT_SERVICE",
  interest: "DEBT_SERVICE",
  capital_expenditures: "CAPITAL_EXPENDITURES",
  total_expenses: "TOTAL_OPERATING_EXPENSES",
  operating_expenses: "TOTAL_OPERATING_EXPENSES",
  net_operating_income: "NET_OPERATING_INCOME",
  noi: "NET_OPERATING_INCOME",
  net_income: "NET_INCOME",
  net_profit: "NET_INCOME",
};

// ---------------------------------------------------------------------------
// Extractor
// ---------------------------------------------------------------------------

export async function extractIncomeStatementDeterministic(
  args: DeterministicExtractorArgs,
): Promise<ExtractionResult & { extractionPath: ExtractionPath }> {
  if (!args.ocrText.trim() && !args.docAiJson) {
    return { ok: true, factsWritten: 0, extractionPath: "ocr_regex" };
  }

  let items: ExtractedLineItem[] = [];
  let path: ExtractionPath = "ocr_regex";

  // Try DocAI structured path
  if (args.docAiJson) {
    const docAiItems = tryDocAiEntities(args);
    if (docAiItems.length > 0) {
      items = docAiItems;
      path = "docai_structured";
    }
  }

  // Fallback to OCR regex
  if (items.length === 0 && args.ocrText.trim()) {
    items = tryOcrRegex(args);
    path = "ocr_regex";
  }

  // Last resort: generic row scan via P&L normalization aliases
  if (items.length === 0 && args.ocrText.trim()) {
    items = tryGenericRowScan(args);
    path = "ocr_generic_scan";
  }

  if (items.length === 0) {
    return { ok: true, factsWritten: 0, extractionPath: path };
  }

  const result = await writeFactsBatch({
    dealId: args.dealId,
    bankId: args.bankId,
    sourceDocumentId: args.documentId,
    factType: "INCOME_STATEMENT",
    items,
  });

  return { ...result, extractionPath: path };
}

// ---------------------------------------------------------------------------
// DocAI path
// ---------------------------------------------------------------------------

function tryDocAiEntities(args: DeterministicExtractorArgs): ExtractedLineItem[] {
  const entities = extractEntitiesFlat(args.docAiJson);
  if (entities.length === 0) return [];

  const items: ExtractedLineItem[] = [];
  const dateStr = findDateOnDocument(args.ocrText);
  const { start: periodStart, end: periodEnd } = normalizePeriod(dateStr);

  for (const entity of entities) {
    const entityType = entity.type.toLowerCase().replace(/[\s-]+/g, "_");
    const canonicalKey = DOCAI_ENTITY_MAP[entityType];
    if (!canonicalKey || !VALID_LINE_KEYS.has(canonicalKey)) continue;

    const value = entityToMoney(entity);
    if (value === null) continue;

    const confidence = Math.min(1, Math.max(0, entity.confidence || 0.7));

    items.push({
      factKey: canonicalKey,
      value,
      confidence,
      periodStart,
      periodEnd,
      provenance: makeProvenance(args.documentId, periodEnd, confidence, entity.mentionText, "docai_structured"),
    });
  }

  return items;
}

// ---------------------------------------------------------------------------
// OCR regex path
// ---------------------------------------------------------------------------

function tryOcrRegex(args: DeterministicExtractorArgs): ExtractedLineItem[] {
  const items: ExtractedLineItem[] = [];
  const text = args.ocrText;

  // Try to detect period from document
  const dateStr = findDateOnDocument(text);
  const { start: periodStart, end: periodEnd } = normalizePeriod(dateStr);

  for (const { key, pattern } of LABEL_PATTERNS) {
    // Try same-line first (higher confidence), then cross-line fallback
    let result = findLabeledAmount(text, pattern);
    let confidence = 0.60;
    if (result.value === null) {
      result = findLabeledAmount(text, pattern, { crossLine: true });
      confidence = 0.55;
    }
    if (result.value === null) continue;

    items.push({
      factKey: key,
      value: result.value,
      confidence,
      periodStart,
      periodEnd,
      provenance: makeProvenance(args.documentId, periodEnd, confidence, result.snippet, "ocr_regex"),
    });
  }

  return items;
}

// ---------------------------------------------------------------------------
// Generic row scan — normalize any OCR row via P&L alias dictionary
// ---------------------------------------------------------------------------

/** Regex that captures a dollar amount token on a line. */
const MONEY_RE = /\$?\(?-?[0-9][0-9,]*(?:\.[0-9]{1,2})?\)?/;

/**
 * Scan ALL OCR lines for rows containing a dollar amount, then try to
 * normalize the label text into a canonical P&L concept via plAliases.
 *
 * This is the last-resort fallback. It finds facts that fixed regex patterns
 * miss because the label wording is industry-specific (e.g. "charter revenue",
 * "merchant fees", "contract revenue").
 */
function tryGenericRowScan(args: DeterministicExtractorArgs): ExtractedLineItem[] {
  const text = args.ocrText;
  const lines = text.split(/\n/);
  const dateStr = findDateOnDocument(text);
  const { start: periodStart, end: periodEnd } = normalizePeriod(dateStr);

  const items: ExtractedLineItem[] = [];
  const seenKeys = new Set<string>();

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const moneyMatch = line.match(MONEY_RE);
    if (!moneyMatch) continue;

    const value = parseMoney(moneyMatch[0]);
    if (value === null) continue;

    // Build label context: text before the money token on this line,
    // plus the previous line if this line is mostly just a number.
    const labelOnLine = line.slice(0, moneyMatch.index).trim();
    let labelCtx = labelOnLine;
    if (labelOnLine.length < 4 && i > 0) {
      // Amount is on its own line — use previous line as label
      labelCtx = lines[i - 1].trim();
    }

    if (!labelCtx) continue;

    // Strip common noise: bracketed references like "[J]", "(Sch A)"
    const cleaned = labelCtx
      .replace(/\[.*?\]/g, "")
      .replace(/\(Sch\s+\w+\)/gi, "")
      .trim();

    const alias = normalizePlLabel(cleaned);
    if (!alias) continue;

    const factKey = alias.factKey;
    if (!VALID_LINE_KEYS.has(factKey)) continue;
    if (seenKeys.has(factKey)) continue;
    seenKeys.add(factKey);

    const snippet = `${cleaned} ${moneyMatch[0]}`.trim();

    items.push({
      factKey,
      value,
      confidence: 0.45,
      periodStart,
      periodEnd,
      provenance: makeProvenance(args.documentId, periodEnd, 0.45, snippet, "ocr_generic_scan"),
    });
  }

  return items;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeProvenance(
  documentId: string,
  periodEnd: string | null,
  confidence: number,
  snippet: string | null,
  path: ExtractionPath,
): FinancialFactProvenance {
  return {
    source_type: "DOC_EXTRACT",
    source_ref: `deal_documents:${documentId}`,
    as_of_date: periodEnd,
    extractor: "incomeStatementExtractor:v2:deterministic",
    confidence,
    extraction_path: path,
    citations: snippet ? [{ page: null, snippet }] : [],
    raw_snippets: snippet ? [snippet] : [],
  } as FinancialFactProvenance;
}
