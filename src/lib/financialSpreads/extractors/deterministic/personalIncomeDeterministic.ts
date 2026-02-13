import "server-only";

import type { FinancialFactProvenance } from "@/lib/financialFacts/keys";
import {
  normalizePeriod,
  writeFactsBatch,
  type ExtractedLineItem,
  type ExtractionResult,
} from "../shared";
import type { DeterministicExtractorArgs, ExtractionPath } from "./types";
import { findLabeledAmount, resolveDocTaxYear } from "./parseUtils";
import {
  extractEntitiesFlat,
  entityToMoney,
} from "./docAiParser";

// ---------------------------------------------------------------------------
// Canonical line item keys (same as original extractor)
// ---------------------------------------------------------------------------

const VALID_LINE_KEYS = new Set([
  "WAGES_W2",
  "SCHED_C_NET",
  "SCHED_E_NET",
  "K1_ORDINARY_INCOME",
  "INTEREST_INCOME",
  "DIVIDEND_INCOME",
  "CAPITAL_GAINS",
  "SOCIAL_SECURITY",
  "IRA_DISTRIBUTIONS",
  "OTHER_INCOME",
  "TOTAL_PERSONAL_INCOME",
  "ADJUSTED_GROSS_INCOME",
]);

// ---------------------------------------------------------------------------
// OCR regex patterns (IRS 1040 line references)
// ---------------------------------------------------------------------------

const LABEL_PATTERNS: Array<{ key: string; pattern: RegExp }> = [
  { key: "WAGES_W2", pattern: /(?:line\s+1\b|wages,?\s+salaries,?\s+(?:and\s+)?tips).*?(\$?[\d,]+(?:\.\d{2})?)/i },
  { key: "INTEREST_INCOME", pattern: /(?:line\s+2b|taxable\s+interest).*?(\$?[\d,]+(?:\.\d{2})?)/i },
  { key: "DIVIDEND_INCOME", pattern: /(?:line\s+3b|(?:qualified\s+)?dividends?).*?(\$?[\d,]+(?:\.\d{2})?)/i },
  { key: "CAPITAL_GAINS", pattern: /(?:line\s+7|capital\s+gain).*?(\$?[\d,]+(?:\.\d{2})?)/i },
  { key: "SCHED_C_NET", pattern: /(?:line\s+(?:8|12)|schedule\s+C|business\s+(?:income|profit)).*?(\$?[\d,]+(?:\.\d{2})?)/i },
  { key: "SCHED_E_NET", pattern: /(?:line\s+(?:5|17)|schedule\s+E|rental.*?income|supplemental\s+income).*?(\$?[\d,]+(?:\.\d{2})?)/i },
  { key: "K1_ORDINARY_INCOME", pattern: /(?:K[\s-]?1|ordinary\s+(?:business\s+)?income\s+from\s+(?:partnership|S\s+corp)).*?(\$?[\d,]+(?:\.\d{2})?)/i },
  { key: "SOCIAL_SECURITY", pattern: /(?:line\s+6[ab]|social\s+security\s+benefit).*?(\$?[\d,]+(?:\.\d{2})?)/i },
  { key: "IRA_DISTRIBUTIONS", pattern: /(?:line\s+4[ab]|IRA\s+distributions?|pension|annuit).*?(\$?[\d,]+(?:\.\d{2})?)/i },
  { key: "OTHER_INCOME", pattern: /(?:line\s+(?:8|10)|other\s+income).*?(\$?[\d,]+(?:\.\d{2})?)/i },
  { key: "TOTAL_PERSONAL_INCOME", pattern: /(?:line\s+9|total\s+income).*?(\$?[\d,]+(?:\.\d{2})?)/i },
  { key: "ADJUSTED_GROSS_INCOME", pattern: /(?:line\s+11|adjusted\s+gross\s+income|AGI).*?(\$?[\d,]+(?:\.\d{2})?)/i },
];

// ---------------------------------------------------------------------------
// DocAI entity type → canonical key mapping
// ---------------------------------------------------------------------------

const DOCAI_ENTITY_MAP: Record<string, string> = {
  wages: "WAGES_W2",
  salaries: "WAGES_W2",
  interest_income: "INTEREST_INCOME",
  dividend_income: "DIVIDEND_INCOME",
  capital_gains: "CAPITAL_GAINS",
  business_income: "SCHED_C_NET",
  schedule_c: "SCHED_C_NET",
  rental_income: "SCHED_E_NET",
  schedule_e: "SCHED_E_NET",
  k1_income: "K1_ORDINARY_INCOME",
  ordinary_income: "K1_ORDINARY_INCOME",
  social_security: "SOCIAL_SECURITY",
  ira_distributions: "IRA_DISTRIBUTIONS",
  pension: "IRA_DISTRIBUTIONS",
  other_income: "OTHER_INCOME",
  total_income: "TOTAL_PERSONAL_INCOME",
  adjusted_gross_income: "ADJUSTED_GROSS_INCOME",
};

// ---------------------------------------------------------------------------
// Extractor
// ---------------------------------------------------------------------------

export async function extractPersonalIncomeDeterministic(
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
    factType: "PERSONAL_INCOME",
    items,
    ownerType: "PERSONAL",
    ownerEntityId: args.ownerEntityId ?? null,
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
  const text = args.ocrText;
  const taxYear = resolveDocTaxYear(text, args.docYear);
  const period = taxYear ? `FY${taxYear}` : null;
  const { start: periodStart, end: periodEnd } = normalizePeriod(period);

  const items: ExtractedLineItem[] = [];

  for (const { key, pattern } of LABEL_PATTERNS) {
    const result = findLabeledAmount(text, pattern);
    if (result.value === null) continue;
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
    extractor: "personalIncomeExtractor:v2:deterministic",
    confidence,
    extraction_path: path,
    citations: snippet ? [{ page: null, snippet }] : [],
    raw_snippets: snippet ? [snippet] : [],
  } as FinancialFactProvenance;
}
