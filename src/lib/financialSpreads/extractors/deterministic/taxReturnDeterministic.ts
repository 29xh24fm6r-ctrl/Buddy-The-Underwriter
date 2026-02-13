import "server-only";

import type { FinancialFactProvenance } from "@/lib/financialFacts/keys";
import {
  normalizePeriod,
  writeFactsBatch,
  type ExtractedLineItem,
  type ExtractionResult,
} from "../shared";
import type { DeterministicExtractorArgs, ExtractionPath } from "./types";
import {
  findLabeledAmount,
  resolveDocTaxYear,
  detectIrsFormType,
  parseMoney,
  type IrsFormType,
} from "./parseUtils";
import {
  extractEntitiesFlat,
  extractFormFields,
  entityToMoney,
} from "./docAiParser";

// ---------------------------------------------------------------------------
// Canonical line item keys (same as original extractor)
// ---------------------------------------------------------------------------

const VALID_LINE_KEYS = new Set([
  "GROSS_RECEIPTS", "COST_OF_GOODS_SOLD", "GROSS_PROFIT",
  "TOTAL_INCOME", "TOTAL_DEDUCTIONS", "TAXABLE_INCOME", "NET_INCOME", "TAX_LIABILITY",
  "DEPRECIATION", "AMORTIZATION", "DEPLETION",
  "OFFICER_COMPENSATION", "SALARIES_WAGES",
  "INTEREST_EXPENSE", "INTEREST_INCOME",
  "RENTAL_INCOME", "RENTAL_EXPENSES",
  "WAGES_W2", "BUSINESS_INCOME_SCHEDULE_C", "CAPITAL_GAINS",
  "IRA_DISTRIBUTIONS", "SOCIAL_SECURITY",
  "ADJUSTED_GROSS_INCOME", "STANDARD_DEDUCTION", "ITEMIZED_DEDUCTIONS",
  "QUALIFIED_BUSINESS_INCOME_DEDUCTION",
  "ORDINARY_BUSINESS_INCOME", "NET_RENTAL_REAL_ESTATE_INCOME",
  "GUARANTEED_PAYMENTS", "DISTRIBUTIONS",
  "OTHER_INCOME", "OTHER_DEDUCTIONS", "MEALS_ENTERTAINMENT",
  "RENT_EXPENSE", "TAXES_LICENSES", "INSURANCE_EXPENSE",
  "REPAIRS_MAINTENANCE", "ADVERTISING", "PENSION_PROFIT_SHARING",
]);

// ---------------------------------------------------------------------------
// IRS form line-number extraction patterns by form type
// ---------------------------------------------------------------------------

type LinePattern = { key: string; pattern: RegExp };

const FORM_1040_PATTERNS: LinePattern[] = [
  { key: "WAGES_W2", pattern: /(?:line\s+1\b|wages,?\s+salaries).*?(\$?[\d,]+(?:\.\d{2})?)/i },
  { key: "INTEREST_INCOME", pattern: /(?:line\s+2b|taxable\s+interest).*?(\$?[\d,]+(?:\.\d{2})?)/i },
  { key: "CAPITAL_GAINS", pattern: /(?:line\s+7|capital\s+gain).*?(\$?[\d,]+(?:\.\d{2})?)/i },
  { key: "BUSINESS_INCOME_SCHEDULE_C", pattern: /(?:line\s+(?:8|12)|business\s+income|schedule\s+C\s+(?:net|income)).*?(\$?[\d,]+(?:\.\d{2})?)/i },
  { key: "RENTAL_INCOME", pattern: /(?:line\s+(?:5|17)|rental.*?income|schedule\s+E).*?(\$?[\d,]+(?:\.\d{2})?)/i },
  { key: "SOCIAL_SECURITY", pattern: /(?:line\s+6[ab]|social\s+security).*?(\$?[\d,]+(?:\.\d{2})?)/i },
  { key: "IRA_DISTRIBUTIONS", pattern: /(?:line\s+4[ab]|IRA\s+distributions?|pension).*?(\$?[\d,]+(?:\.\d{2})?)/i },
  { key: "TOTAL_INCOME", pattern: /(?:line\s+9|total\s+income).*?(\$?[\d,]+(?:\.\d{2})?)/i },
  { key: "ADJUSTED_GROSS_INCOME", pattern: /(?:line\s+11|adjusted\s+gross\s+income|AGI).*?(\$?[\d,]+(?:\.\d{2})?)/i },
  { key: "STANDARD_DEDUCTION", pattern: /(?:line\s+12|standard\s+deduction).*?(\$?[\d,]+(?:\.\d{2})?)/i },
  { key: "TAXABLE_INCOME", pattern: /(?:line\s+15|taxable\s+income).*?(\$?[\d,]+(?:\.\d{2})?)/i },
  { key: "TAX_LIABILITY", pattern: /(?:line\s+(?:16|24)|total\s+tax|tax\s+(?:liability|owed)).*?(\$?[\d,]+(?:\.\d{2})?)/i },
];

const FORM_1120_PATTERNS: LinePattern[] = [
  { key: "GROSS_RECEIPTS", pattern: /(?:line\s+1[abc]?|gross\s+receipts).*?(\$?[\d,]+(?:\.\d{2})?)/i },
  { key: "COST_OF_GOODS_SOLD", pattern: /(?:line\s+2|cost\s+of\s+goods\s+sold|COGS).*?(\$?[\d,]+(?:\.\d{2})?)/i },
  { key: "GROSS_PROFIT", pattern: /(?:line\s+3|gross\s+profit).*?(\$?[\d,]+(?:\.\d{2})?)/i },
  { key: "OFFICER_COMPENSATION", pattern: /(?:line\s+12|officer\s+compensation|compensation\s+of\s+officer).*?(\$?[\d,]+(?:\.\d{2})?)/i },
  { key: "SALARIES_WAGES", pattern: /(?:line\s+13|salaries\s+(?:and\s+)?wages).*?(\$?[\d,]+(?:\.\d{2})?)/i },
  { key: "DEPRECIATION", pattern: /(?:line\s+(?:14|20)|depreciation).*?(\$?[\d,]+(?:\.\d{2})?)/i },
  { key: "AMORTIZATION", pattern: /(?:amortization).*?(\$?[\d,]+(?:\.\d{2})?)/i },
  { key: "INTEREST_EXPENSE", pattern: /(?:line\s+18|interest\s+(?:expense|paid|deduction)).*?(\$?[\d,]+(?:\.\d{2})?)/i },
  { key: "RENT_EXPENSE", pattern: /(?:line\s+(?:16|17)|rents?\s+(?:expense|paid)).*?(\$?[\d,]+(?:\.\d{2})?)/i },
  { key: "TAXES_LICENSES", pattern: /(?:line\s+17|taxes\s+(?:and\s+)?licenses).*?(\$?[\d,]+(?:\.\d{2})?)/i },
  { key: "TOTAL_DEDUCTIONS", pattern: /(?:line\s+27|total\s+deductions).*?(\$?[\d,]+(?:\.\d{2})?)/i },
  { key: "TAXABLE_INCOME", pattern: /(?:line\s+(?:28|30)|taxable\s+income).*?(\$?[\d,]+(?:\.\d{2})?)/i },
  { key: "NET_INCOME", pattern: /(?:net\s+income|net\s+profit).*?(\$?[\d,]+(?:\.\d{2})?)/i },
];

const FORM_1065_PATTERNS: LinePattern[] = [
  { key: "GROSS_RECEIPTS", pattern: /(?:line\s+1[abc]?|gross\s+receipts).*?(\$?[\d,]+(?:\.\d{2})?)/i },
  { key: "ORDINARY_BUSINESS_INCOME", pattern: /(?:line\s+22|ordinary\s+(?:business\s+)?income).*?(\$?[\d,]+(?:\.\d{2})?)/i },
  { key: "NET_RENTAL_REAL_ESTATE_INCOME", pattern: /(?:net\s+rental\s+real\s+estate|rental\s+real\s+estate\s+income).*?(\$?[\d,]+(?:\.\d{2})?)/i },
  { key: "GUARANTEED_PAYMENTS", pattern: /(?:guaranteed\s+payments?).*?(\$?[\d,]+(?:\.\d{2})?)/i },
  { key: "DEPRECIATION", pattern: /(?:depreciation).*?(\$?[\d,]+(?:\.\d{2})?)/i },
  { key: "INTEREST_EXPENSE", pattern: /(?:interest\s+(?:expense|paid|deduction)).*?(\$?[\d,]+(?:\.\d{2})?)/i },
  { key: "DISTRIBUTIONS", pattern: /(?:distributions?\s+(?:to|paid)).*?(\$?[\d,]+(?:\.\d{2})?)/i },
];

/** Generic fallback patterns when form type is unknown */
const GENERIC_TAX_PATTERNS: LinePattern[] = [
  { key: "GROSS_RECEIPTS", pattern: /gross\s+receipts|gross\s+income|total\s+(?:gross\s+)?revenue/i },
  { key: "COST_OF_GOODS_SOLD", pattern: /cost\s+of\s+goods\s+sold|COGS/i },
  { key: "TOTAL_INCOME", pattern: /total\s+income/i },
  { key: "TOTAL_DEDUCTIONS", pattern: /total\s+deductions/i },
  { key: "TAXABLE_INCOME", pattern: /taxable\s+income/i },
  { key: "NET_INCOME", pattern: /net\s+income|net\s+(?:profit|loss)/i },
  { key: "DEPRECIATION", pattern: /\bdepreciation\b/i },
  { key: "AMORTIZATION", pattern: /\bamortization\b/i },
  { key: "OFFICER_COMPENSATION", pattern: /officer\s+compensation/i },
  { key: "INTEREST_EXPENSE", pattern: /interest\s+(?:expense|paid|deduction)/i },
  { key: "SALARIES_WAGES", pattern: /salaries\s+(?:and\s+)?wages/i },
  { key: "RENT_EXPENSE", pattern: /rents?\s+(?:expense|paid)/i },
  { key: "ADJUSTED_GROSS_INCOME", pattern: /adjusted\s+gross\s+income|AGI/i },
  { key: "TAX_LIABILITY", pattern: /total\s+tax|tax\s+(?:liability|owed)/i },
];

// ---------------------------------------------------------------------------
// DocAI entity type → canonical key mapping
// ---------------------------------------------------------------------------

const DOCAI_ENTITY_MAP: Record<string, string> = {
  gross_receipts: "GROSS_RECEIPTS",
  cost_of_goods_sold: "COST_OF_GOODS_SOLD",
  gross_profit: "GROSS_PROFIT",
  total_income: "TOTAL_INCOME",
  total_deductions: "TOTAL_DEDUCTIONS",
  taxable_income: "TAXABLE_INCOME",
  net_income: "NET_INCOME",
  tax: "TAX_LIABILITY",
  tax_liability: "TAX_LIABILITY",
  depreciation: "DEPRECIATION",
  amortization: "AMORTIZATION",
  officer_compensation: "OFFICER_COMPENSATION",
  salaries_wages: "SALARIES_WAGES",
  interest_expense: "INTEREST_EXPENSE",
  rent: "RENT_EXPENSE",
  ordinary_income: "ORDINARY_BUSINESS_INCOME",
  guaranteed_payments: "GUARANTEED_PAYMENTS",
  distributions: "DISTRIBUTIONS",
  wages: "WAGES_W2",
  adjusted_gross_income: "ADJUSTED_GROSS_INCOME",
  capital_gains: "CAPITAL_GAINS",
};

// ---------------------------------------------------------------------------
// Extractor
// ---------------------------------------------------------------------------

export async function extractTaxReturnDeterministic(
  args: DeterministicExtractorArgs,
): Promise<ExtractionResult & { extractionPath: ExtractionPath }> {
  if (!args.ocrText.trim() && !args.docAiJson) {
    return { ok: true, factsWritten: 0, extractionPath: "ocr_regex" };
  }

  let items: ExtractedLineItem[] = [];
  let path: ExtractionPath = "ocr_regex";

  // DocAI structured path (primary for tax returns)
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

  if (items.length === 0) {
    return { ok: true, factsWritten: 0, extractionPath: path };
  }

  const result = await writeFactsBatch({
    dealId: args.dealId,
    bankId: args.bankId,
    sourceDocumentId: args.documentId,
    factType: "TAX_RETURN",
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
  const taxYear = resolveDocTaxYear(args.ocrText, args.docYear);
  const period = taxYear ? `FY${taxYear}` : null;
  const { start: periodStart, end: periodEnd } = normalizePeriod(period);

  for (const entity of entities) {
    const entityType = entity.type.toLowerCase().replace(/[\s-]+/g, "_");
    const canonicalKey = DOCAI_ENTITY_MAP[entityType];
    if (!canonicalKey || !VALID_LINE_KEYS.has(canonicalKey)) continue;

    const value = entityToMoney(entity);
    if (value === null) continue;

    const confidence = Math.min(1, Math.max(0, entity.confidence || 0.75));

    items.push({
      factKey: canonicalKey,
      value,
      confidence,
      periodStart,
      periodEnd,
      provenance: makeProvenance(args.documentId, periodEnd, confidence, entity.mentionText, "docai_structured"),
    });
  }

  // Also try form fields (IRS forms have labeled fields)
  const formFields = extractFormFields(args.docAiJson);
  for (const field of formFields) {
    const normalized = field.name.toLowerCase().replace(/[\s-]+/g, "_").replace(/[^a-z0-9_]/g, "");
    const canonicalKey = DOCAI_ENTITY_MAP[normalized];
    if (!canonicalKey || !VALID_LINE_KEYS.has(canonicalKey)) continue;

    // Don't duplicate if already found in entities
    if (items.some((i) => i.factKey === canonicalKey)) continue;

    const value = parseMoney(field.value);
    if (value === null) continue;

    items.push({
      factKey: canonicalKey,
      value,
      confidence: Math.min(1, Math.max(0, field.confidence || 0.65)),
      periodStart,
      periodEnd,
      provenance: makeProvenance(args.documentId, periodEnd, field.confidence, `${field.name}: ${field.value}`, "docai_structured"),
    });
  }

  return items;
}

// ---------------------------------------------------------------------------
// OCR regex path
// ---------------------------------------------------------------------------

function tryOcrRegex(args: DeterministicExtractorArgs): ExtractedLineItem[] {
  const text = args.ocrText;
  const formType = detectIrsFormType(text);
  const taxYear = resolveDocTaxYear(text, args.docYear);
  const period = taxYear ? `FY${taxYear}` : null;
  const { start: periodStart, end: periodEnd } = normalizePeriod(period);

  const patterns = selectPatterns(formType);
  const items: ExtractedLineItem[] = [];

  for (const { key, pattern } of patterns) {
    const result = findLabeledAmount(text, pattern);
    if (result.value === null) continue;

    // Skip duplicate keys (first match wins)
    if (items.some((i) => i.factKey === key)) continue;

    items.push({
      factKey: key,
      value: result.value,
      confidence: 0.55,
      periodStart,
      periodEnd,
      provenance: makeProvenance(args.documentId, periodEnd, 0.55, result.snippet, "ocr_regex"),
    });
  }

  return items;
}

function selectPatterns(formType: IrsFormType): LinePattern[] {
  switch (formType) {
    case "1040":
      return [...FORM_1040_PATTERNS, ...GENERIC_TAX_PATTERNS];
    case "1120":
    case "1120S":
      return [...FORM_1120_PATTERNS, ...GENERIC_TAX_PATTERNS];
    case "1065":
      return [...FORM_1065_PATTERNS, ...GENERIC_TAX_PATTERNS];
    case "SCHEDULE_C":
      return [...FORM_1120_PATTERNS, ...GENERIC_TAX_PATTERNS]; // Similar structure
    default:
      return GENERIC_TAX_PATTERNS;
  }
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
    extractor: "taxReturnExtractor:v2:deterministic",
    confidence,
    extraction_path: path,
    citations: snippet ? [{ page: null, snippet }] : [],
    raw_snippets: snippet ? [snippet] : [],
  } as FinancialFactProvenance;
}
