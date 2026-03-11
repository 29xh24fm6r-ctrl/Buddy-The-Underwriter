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
} from "./structuredJsonParser";

// ---------------------------------------------------------------------------
// Canonical line item keys (same as original extractor)
// ---------------------------------------------------------------------------

const VALID_LINE_KEYS = new Set([
  // Form 1040 — income lines
  "WAGES_W2",
  "TAXABLE_INTEREST",
  "ORDINARY_DIVIDENDS",
  "QUALIFIED_DIVIDENDS",
  "IRA_DISTRIBUTIONS",
  "PENSION_ANNUITY",
  "SOCIAL_SECURITY",
  "CAPITAL_GAINS",
  "SCHED_C_NET",
  "SCHED_E_NET",
  "K1_ORDINARY_INCOME",
  "OTHER_INCOME",
  "TOTAL_PERSONAL_INCOME",
  "ADJUSTMENTS_TO_INCOME",
  "ADJUSTED_GROSS_INCOME",
  "STANDARD_DEDUCTION",
  "ITEMIZED_DEDUCTIONS",
  "QBI_DEDUCTION",
  "TAXABLE_INCOME",
  "TOTAL_TAX",
  // Schedule E — Part I (rental)
  "SCH_E_GROSS_RENTS_RECEIVED",
  "SCH_E_ADVERTISING",
  "SCH_E_AUTO_TRAVEL",
  "SCH_E_CLEANING_MAINTENANCE",
  "SCH_E_COMMISSIONS",
  "SCH_E_INSURANCE",
  "SCH_E_LEGAL_PROFESSIONAL",
  "SCH_E_MANAGEMENT_FEES",
  "SCH_E_MORTGAGE_INTEREST",
  "SCH_E_OTHER_INTEREST",
  "SCH_E_REPAIRS",
  "SCH_E_SUPPLIES",
  "SCH_E_TAXES",
  "SCH_E_UTILITIES",
  "SCH_E_DEPRECIATION",
  "SCH_E_OTHER_EXPENSES",
  "SCH_E_TOTAL_EXPENSES",
  "SCH_E_NET",
  "SCH_E_RENTAL_TOTAL",
  // Schedule E — Part II (K-1 pass-throughs)
  "SCH_E_K1_PASSIVE_INCOME",
  "SCH_E_K1_NONPASSIVE_INCOME",
  "SCH_E_K1_NET_TOTAL",
  // Form 4562 — depreciation
  "F4562_SEC179_ELECTED",
  "F4562_SEC179_CARRYOVER",
  "F4562_BONUS_DEPRECIATION",
  "F4562_MACRS_TOTAL",
  "F4562_AMORTIZATION_TOTAL",
  "F4562_TOTAL_DEPRECIATION",
  // Form 8825 — rental income (entity-level)
  "F8825_TOTAL_GROSS_RENTS",
  "F8825_TOTAL_EXPENSES",
  "F8825_DEPRECIATION",
  "F8825_NET_INCOME_LOSS",
  // Legacy keys — keep for backward compat
  "INTEREST_INCOME",
  "DIVIDEND_INCOME",
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
  { key: "ADJUSTED_GROSS_INCOME", pattern: /(?:line\s+11\b|adjusted\s+gross\s+income|agi\b).*?(\$?[\d,]+(?:\.\d{2})?)/i },
  { key: "TAXABLE_INCOME", pattern: /(?:line\s+15\b|taxable\s+income).*?(\$?[\d,]+(?:\.\d{2})?)/i },
  { key: "TOTAL_TAX", pattern: /(?:line\s+24\b|total\s+tax).*?(\$?[\d,]+(?:\.\d{2})?)/i },
  { key: "STANDARD_DEDUCTION", pattern: /(?:line\s+12\b|standard\s+deduction).*?(\$?[\d,]+(?:\.\d{2})?)/i },
  { key: "QBI_DEDUCTION", pattern: /(?:line\s+13\b|qualified\s+business\s+income\s+deduction|qbi).*?(\$?[\d,]+(?:\.\d{2})?)/i },
  { key: "SCH_E_GROSS_RENTS_RECEIVED", pattern: /(?:line\s+3\b|rents?\s+received).*?(\$?[\d,]+(?:\.\d{2})?)/i },
  { key: "SCH_E_DEPRECIATION", pattern: /(?:line\s+18\b|depreciation\s+expense\s+or\s+depletion).*?(\$?[\d,]+(?:\.\d{2})?)/i },
  { key: "SCH_E_RENTAL_TOTAL", pattern: /(?:line\s+26\b|total\s+rental\s+real\s+estate).*?(\$?[\d,]+(?:\.\d{2})?)/i },
  { key: "F4562_SEC179_ELECTED", pattern: /(?:section\s+179\s+(?:deduction|expense)).*?(\$?[\d,]+(?:\.\d{2})?)/i },
  { key: "F4562_BONUS_DEPRECIATION", pattern: /(?:special\s+depreciation\s+allowance|bonus\s+depreciation).*?(\$?[\d,]+(?:\.\d{2})?)/i },
  { key: "F4562_TOTAL_DEPRECIATION", pattern: /(?:total\s+(?:depreciation|amortization)\s+(?:and|or)\s+amortization|line\s+22\b).*?(\$?[\d,]+(?:\.\d{2})?)/i },
  { key: "F8825_TOTAL_GROSS_RENTS", pattern: /(?:total\s+gross\s+rents|form\s+8825.*?rents?).*?(\$?[\d,]+(?:\.\d{2})?)/i },
  { key: "F8825_NET_INCOME_LOSS", pattern: /(?:form\s+8825.*?net\s+(?:income|loss)).*?(\$?[\d,]+(?:\.\d{2})?)/i },
];

// ---------------------------------------------------------------------------
// Structured entity type → canonical key mapping
// ---------------------------------------------------------------------------

const ENTITY_MAP: Record<string, string> = {
  // Form 1040 — wages & income
  wages_w2: "WAGES_W2",
  wages: "WAGES_W2",
  salaries: "WAGES_W2",
  taxable_interest: "TAXABLE_INTEREST",
  interest_income: "TAXABLE_INTEREST",
  ordinary_dividends: "ORDINARY_DIVIDENDS",
  qualified_dividends: "QUALIFIED_DIVIDENDS",
  dividend_income: "ORDINARY_DIVIDENDS",
  ira_distributions_taxable: "IRA_DISTRIBUTIONS",
  ira_distributions: "IRA_DISTRIBUTIONS",
  pension_annuity_taxable: "PENSION_ANNUITY",
  pension: "PENSION_ANNUITY",
  social_security_taxable: "SOCIAL_SECURITY",
  social_security: "SOCIAL_SECURITY",
  capital_gains_total: "CAPITAL_GAINS",
  capital_gains: "CAPITAL_GAINS",
  schedule_c_net_profit: "SCHED_C_NET",
  business_income: "SCHED_C_NET",
  schedule_c: "SCHED_C_NET",
  business_income_schedule_c: "SCHED_C_NET",
  schedule_e_rental_total: "SCHED_E_NET",
  rental_income: "SCHED_E_NET",
  schedule_e: "SCHED_E_NET",
  k1_ordinary_income: "K1_ORDINARY_INCOME",
  k1_income: "K1_ORDINARY_INCOME",
  ordinary_income: "K1_ORDINARY_INCOME",
  other_income: "OTHER_INCOME",
  total_income: "TOTAL_PERSONAL_INCOME",
  adjustments_to_income: "ADJUSTMENTS_TO_INCOME",
  adjusted_gross_income: "ADJUSTED_GROSS_INCOME",
  standard_deduction: "STANDARD_DEDUCTION",
  itemized_deductions: "ITEMIZED_DEDUCTIONS",
  qbi_deduction: "QBI_DEDUCTION",
  taxable_income: "TAXABLE_INCOME",
  total_tax: "TOTAL_TAX",
  // Schedule E Part I — rental detail
  sch_e_gross_rents_received: "SCH_E_GROSS_RENTS_RECEIVED",
  sch_e_advertising: "SCH_E_ADVERTISING",
  sch_e_auto_travel: "SCH_E_AUTO_TRAVEL",
  sch_e_cleaning_maintenance: "SCH_E_CLEANING_MAINTENANCE",
  sch_e_commissions: "SCH_E_COMMISSIONS",
  sch_e_insurance: "SCH_E_INSURANCE",
  sch_e_legal_professional: "SCH_E_LEGAL_PROFESSIONAL",
  sch_e_management_fees: "SCH_E_MANAGEMENT_FEES",
  sch_e_mortgage_interest: "SCH_E_MORTGAGE_INTEREST",
  sch_e_other_interest: "SCH_E_OTHER_INTEREST",
  sch_e_repairs: "SCH_E_REPAIRS",
  sch_e_supplies: "SCH_E_SUPPLIES",
  sch_e_taxes: "SCH_E_TAXES",
  sch_e_utilities: "SCH_E_UTILITIES",
  sch_e_depreciation: "SCH_E_DEPRECIATION",
  sch_e_other_expenses: "SCH_E_OTHER_EXPENSES",
  sch_e_total_expenses: "SCH_E_TOTAL_EXPENSES",
  sch_e_net_income_loss: "SCH_E_NET",
  sch_e_rental_total: "SCH_E_RENTAL_TOTAL",
  // Schedule E Part II — K-1
  sch_e_k1_passive_income: "SCH_E_K1_PASSIVE_INCOME",
  sch_e_k1_nonpassive_income: "SCH_E_K1_NONPASSIVE_INCOME",
  sch_e_k1_net_total: "SCH_E_K1_NET_TOTAL",
  // Form 4562 — depreciation
  f4562_sec179_elected: "F4562_SEC179_ELECTED",
  f4562_sec179_carryover: "F4562_SEC179_CARRYOVER",
  f4562_bonus_depreciation: "F4562_BONUS_DEPRECIATION",
  f4562_macrs_total: "F4562_MACRS_TOTAL",
  f4562_amortization_total: "F4562_AMORTIZATION_TOTAL",
  f4562_total_depreciation_amortization: "F4562_TOTAL_DEPRECIATION",
  // Form 8825 — entity rental
  f8825_total_gross_rents: "F8825_TOTAL_GROSS_RENTS",
  f8825_total_expenses: "F8825_TOTAL_EXPENSES",
  f8825_depreciation: "F8825_DEPRECIATION",
  f8825_net_income_loss: "F8825_NET_INCOME_LOSS",
};

// ---------------------------------------------------------------------------
// Extractor
// ---------------------------------------------------------------------------

export async function extractPersonalIncomeDeterministic(
  args: DeterministicExtractorArgs,
): Promise<ExtractionResult & { extractionPath: ExtractionPath }> {
  if (!args.ocrText.trim() && !args.structuredJson) {
    return { ok: true, factsWritten: 0, extractionPath: "ocr_regex" };
  }

  let items: ExtractedLineItem[] = [];
  let path: ExtractionPath = "ocr_regex";

  if (args.structuredJson) {
    const structuredItems = tryStructuredEntities(args);
    if (structuredItems.length > 0) {
      items = structuredItems;
      path = "gemini_structured";
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
// Structured assist path
// ---------------------------------------------------------------------------

function tryStructuredEntities(args: DeterministicExtractorArgs): ExtractedLineItem[] {
  const entities = extractEntitiesFlat(args.structuredJson);
  if (entities.length === 0) return [];

  const items: ExtractedLineItem[] = [];
  const taxYear = resolveDocTaxYear(args.ocrText, args.docYear);
  const period = taxYear ? `FY${taxYear}` : null;
  const { start: periodStart, end: periodEnd } = normalizePeriod(period);

  for (const entity of entities) {
    const entityType = entity.type.toLowerCase().replace(/[\s-]+/g, "_");
    const canonicalKey = ENTITY_MAP[entityType];
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
      provenance: makeProvenance(args.documentId, periodEnd, confidence, entity.mentionText, "gemini_structured"),
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
