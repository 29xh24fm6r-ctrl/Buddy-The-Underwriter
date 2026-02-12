import "server-only";

import type { FinancialFactProvenance } from "@/lib/financialFacts/keys";
import {
  normalizePeriod,
  writeFactsBatch,
  type ExtractedLineItem,
  type ExtractionResult,
} from "../shared";
import type { DeterministicExtractorArgs, ExtractionPath } from "./types";
import { findLabeledAmount, findDateOnDocument } from "./parseUtils";
import {
  extractEntitiesFlat,
  entityToMoney,
} from "./docAiParser";

// ---------------------------------------------------------------------------
// Canonical line item keys (same as original extractor)
// ---------------------------------------------------------------------------

const VALID_LINE_KEYS = new Set([
  "CASH_AND_EQUIVALENTS", "ACCOUNTS_RECEIVABLE", "INVENTORY", "PREPAID_EXPENSES",
  "OTHER_CURRENT_ASSETS", "TOTAL_CURRENT_ASSETS",
  "PROPERTY_PLANT_EQUIPMENT", "ACCUMULATED_DEPRECIATION", "NET_FIXED_ASSETS",
  "INVESTMENT_PROPERTIES", "INTANGIBLE_ASSETS", "OTHER_NON_CURRENT_ASSETS",
  "TOTAL_NON_CURRENT_ASSETS", "TOTAL_ASSETS",
  "ACCOUNTS_PAYABLE", "ACCRUED_EXPENSES", "SHORT_TERM_DEBT", "CURRENT_PORTION_LTD",
  "OTHER_CURRENT_LIABILITIES", "TOTAL_CURRENT_LIABILITIES",
  "LONG_TERM_DEBT", "MORTGAGE_PAYABLE", "DEFERRED_TAX_LIABILITY",
  "OTHER_NON_CURRENT_LIABILITIES", "TOTAL_NON_CURRENT_LIABILITIES", "TOTAL_LIABILITIES",
  "COMMON_STOCK", "RETAINED_EARNINGS", "PARTNERS_CAPITAL", "MEMBERS_EQUITY",
  "OTHER_EQUITY", "TOTAL_EQUITY",
  "TOTAL_LIABILITIES_AND_EQUITY",
]);

// ---------------------------------------------------------------------------
// Label → canonical key mapping for OCR regex extraction
// ---------------------------------------------------------------------------

const LABEL_PATTERNS: Array<{ key: string; pattern: RegExp }> = [
  // Current Assets
  { key: "CASH_AND_EQUIVALENTS", pattern: /cash\s+(?:and\s+)?(?:cash\s+)?equivalents?|cash\s+(?:and\s+)?short[\s-]?term|cash\s+(?:in\s+)?banks?|(?:checking|savings)(?:\s+account)?|current\s+assets?\s*\(cash\)|\bcash\b(?!\s+(?:flow|basis|surrender|method|value))/i },
  { key: "ACCOUNTS_RECEIVABLE", pattern: /accounts?\s+receivable|A\/R|trade\s+receivable|unpaid\s+.*?(?:income|receivable)\s+owed/i },
  { key: "INVENTORY", pattern: /\binventor(?:y|ies)\b/i },
  { key: "PREPAID_EXPENSES", pattern: /prepaid\s+(?:expense|asset)|pre[\s-]?paid\s+expense|asset\s+pre[\s-]?paid/i },
  { key: "OTHER_CURRENT_ASSETS", pattern: /other\s+current\s+asset|other\s+equipment/i },
  { key: "TOTAL_CURRENT_ASSETS", pattern: /total\s+current\s+asset/i },
  // Non-Current Assets
  { key: "PROPERTY_PLANT_EQUIPMENT", pattern: /property[\s,]+plant\s+(?:&|and)\s+equipment|PP&E|(?:net\s+)?fixed\s+assets?|land\s+(?:&|and)\s+building/i },
  { key: "ACCUMULATED_DEPRECIATION", pattern: /accumulated\s+depreciation|accum\.?\s+depr|\bdepreciation\b/i },
  { key: "NET_FIXED_ASSETS", pattern: /net\s+(?:fixed|property)\s+asset|total\s+fixed\s+asset/i },
  { key: "INVESTMENT_PROPERTIES", pattern: /investment\s+(?:propert|real\s+estate)/i },
  { key: "INTANGIBLE_ASSETS", pattern: /intangible\s+asset|goodwill/i },
  { key: "OTHER_NON_CURRENT_ASSETS", pattern: /other\s+(?:non[\s-]?current|long[\s-]?term)\s+asset/i },
  { key: "TOTAL_NON_CURRENT_ASSETS", pattern: /total\s+(?:non[\s-]?current|long[\s-]?term|fixed)\s+asset/i },
  { key: "TOTAL_ASSETS", pattern: /total\s+assets/i },
  // Current Liabilities
  { key: "ACCOUNTS_PAYABLE", pattern: /accounts?\s+payable|A\/P|trade\s+payable/i },
  { key: "ACCRUED_EXPENSES", pattern: /accrued\s+(?:expense|liabilit)/i },
  { key: "SHORT_TERM_DEBT", pattern: /short[\s-]?term\s+(?:debt|borrowing|note)|line\s+of\s+credit|LOC|credit\s+card\s+balance/i },
  { key: "CURRENT_PORTION_LTD", pattern: /current\s+portion\s+(?:of\s+)?(?:long[\s-]?term|LTD)|CPLTD/i },
  { key: "OTHER_CURRENT_LIABILITIES", pattern: /other\s+current\s+liabilit/i },
  { key: "TOTAL_CURRENT_LIABILITIES", pattern: /total\s+current\s+liabilit/i },
  // Non-Current Liabilities
  { key: "LONG_TERM_DEBT", pattern: /long[\s-]?term\s+(?:debt|borrowing|note)|LTD|term\s+loan/i },
  { key: "MORTGAGE_PAYABLE", pattern: /mortgage\s+(?:payable|note|loan)/i },
  { key: "DEFERRED_TAX_LIABILITY", pattern: /deferred\s+(?:tax|income\s+tax)\s+liabilit/i },
  { key: "OTHER_NON_CURRENT_LIABILITIES", pattern: /other\s+(?:non[\s-]?current|long[\s-]?term)\s+liabilit/i },
  { key: "TOTAL_NON_CURRENT_LIABILITIES", pattern: /total\s+(?:non[\s-]?current|long[\s-]?term)\s+liabilit/i },
  { key: "TOTAL_LIABILITIES", pattern: /total\s+liabilities(?!\s+(?:and|&))/i },
  // Equity
  { key: "COMMON_STOCK", pattern: /common\s+stock|capital\s+stock|paid[\s-]?in\s+capital/i },
  { key: "RETAINED_EARNINGS", pattern: /retained\s+earnings|accumulated\s+(?:deficit|surplus)/i },
  { key: "PARTNERS_CAPITAL", pattern: /partners?['\u2019]?\s+capital|partnership\s+equity/i },
  { key: "MEMBERS_EQUITY", pattern: /members?['\u2019]?\s+equity|LLC\s+equity/i },
  { key: "OTHER_EQUITY", pattern: /other\s+equity|treasury\s+stock|additional\s+paid/i },
  { key: "TOTAL_EQUITY", pattern: /total\s+(?:stockholders?['\u2019]?\s+|owners?['\u2019]?\s+|partners?['\u2019]?\s+|members?['\u2019]?\s+)?equity|owners?\s+equity|total\s+(?:net\s+)?worth|total\s+capital/i },
  { key: "TOTAL_LIABILITIES_AND_EQUITY", pattern: /total\s+liabilities\s+(?:and|&)\s+(?:stockholders?['\u2019]?\s+)?equity|total\s+liabilities\s+(?:and|&)\s+(?:net\s+)?worth/i },
];

// ---------------------------------------------------------------------------
// DocAI entity type → canonical key mapping
// ---------------------------------------------------------------------------

const DOCAI_ENTITY_MAP: Record<string, string> = {
  cash: "CASH_AND_EQUIVALENTS",
  cash_equivalents: "CASH_AND_EQUIVALENTS",
  accounts_receivable: "ACCOUNTS_RECEIVABLE",
  inventory: "INVENTORY",
  total_current_assets: "TOTAL_CURRENT_ASSETS",
  property_plant_equipment: "PROPERTY_PLANT_EQUIPMENT",
  accumulated_depreciation: "ACCUMULATED_DEPRECIATION",
  total_assets: "TOTAL_ASSETS",
  accounts_payable: "ACCOUNTS_PAYABLE",
  total_current_liabilities: "TOTAL_CURRENT_LIABILITIES",
  long_term_debt: "LONG_TERM_DEBT",
  total_liabilities: "TOTAL_LIABILITIES",
  retained_earnings: "RETAINED_EARNINGS",
  total_equity: "TOTAL_EQUITY",
  total_liabilities_equity: "TOTAL_LIABILITIES_AND_EQUITY",
};

// ---------------------------------------------------------------------------
// Extractor
// ---------------------------------------------------------------------------

export async function extractBalanceSheetDeterministic(
  args: DeterministicExtractorArgs,
): Promise<ExtractionResult & { extractionPath: ExtractionPath }> {
  if (!args.ocrText.trim() && !args.docAiJson) {
    return { ok: true, factsWritten: 0, extractionPath: "ocr_regex" };
  }

  let items: ExtractedLineItem[] = [];
  let path: ExtractionPath = "ocr_regex";

  if (args.docAiJson) {
    const docAiItems = tryDocAiEntities(args);
    if (docAiItems.length > 0) {
      items = docAiItems;
      path = "docai_structured";
    }
  }

  if (items.length === 0 && args.ocrText.trim()) {
    items = tryOcrRegex(args);
    path = "ocr_regex";
  }

  if (items.length === 0) {
    return { ok: true, factsWritten: 0, extractionPath: path };
  }

  const result = await writeFactsBatch({
    dealId: args.dealId,
    bankId: args.bankId,
    sourceDocumentId: args.documentId,
    factType: "BALANCE_SHEET",
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

  const dateStr = findDateOnDocument(text);
  const { start: periodStart, end: periodEnd } = normalizePeriod(dateStr);

  for (const { key, pattern } of LABEL_PATTERNS) {
    // Try same-line first (higher confidence), then cross-line fallback
    let result = findLabeledAmount(text, pattern);
    let confidence = 0.55;
    if (result.value === null) {
      result = findLabeledAmount(text, pattern, { crossLine: true });
      confidence = 0.50;
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
    extractor: "balanceSheetExtractor:v2:deterministic",
    confidence,
    extraction_path: path,
    citations: snippet ? [{ page: null, snippet }] : [],
    raw_snippets: snippet ? [snippet] : [],
  } as FinancialFactProvenance;
}
