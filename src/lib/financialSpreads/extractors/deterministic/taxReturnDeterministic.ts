import "server-only";

import type { FinancialFactProvenance } from "@/lib/financialFacts/keys";
import {
  normalizePeriod,
  writeFactsBatch,
  type ExtractedLineItem,
  type ExtractionResult,
} from "../shared";
import type { DeterministicExtractorArgs, ExtractionPath, PureDeterministicResult } from "./types";
import {
  findLabeledAmount,
  resolveDocTaxYear,
  detectIrsFormType,
  parseMoney,
  isLikelyReferenceNumber,
  type IrsFormType,
} from "./parseUtils";
import {
  extractEntitiesFlat,
  extractFormFields,
  entityToMoney,
} from "./structuredJsonParser";
import { extractScheduleL } from "./scheduleLReconciliation";
import { extractScheduleM1 } from "./scheduleM1Deterministic";
import { extractForm4562 } from "./form4562Deterministic";
import { extractForm8825 } from "./form8825Deterministic";
import { extractForm1125A } from "./form1125aDeterministic";
import { extractForm1125E } from "./form1125eDeterministic";
import { extractK1 } from "./k1Deterministic";
import { validateArithmetic } from "./arithmeticValidator";
import { writeScheduleLFacts } from "@/lib/financialFacts/writeScheduleLFacts";
import { writeK1BaseFacts } from "@/lib/financialFacts/writeK1BaseFacts";

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
  "EMPLOYEE_BENEFITS", "BAD_DEBT_EXPENSE",
  // Schedule L keys (also validated via scheduleLReconciliation)
  "SL_CASH", "SL_AR_GROSS", "SL_INVENTORY", "SL_OTHER_CURRENT_ASSETS",
  "SL_SHAREHOLDER_LOANS_RECEIVABLE", "SL_PPE_GROSS", "SL_ACCUMULATED_DEPRECIATION",
  "SL_INTANGIBLES_GROSS", "SL_ACCUMULATED_AMORTIZATION", "SL_LAND",
  "SL_TOTAL_ASSETS", "SL_ACCOUNTS_PAYABLE", "SL_WAGES_PAYABLE",
  "SL_OTHER_LIABILITIES", "SL_OPERATING_CURRENT_LIABILITIES",
  "SL_MORTGAGES_NOTES_BONDS", "SL_LOANS_FROM_SHAREHOLDERS",
  "SL_TOTAL_LIABILITIES", "SL_RETAINED_EARNINGS", "SL_CAPITAL_STOCK", "SL_TOTAL_EQUITY",
]);

// ---------------------------------------------------------------------------
// IRS form line-number extraction patterns by form type
// ---------------------------------------------------------------------------

type LinePattern = { key: string; pattern: RegExp };

const FORM_1040_PATTERNS: LinePattern[] = [
  { key: "WAGES_W2", pattern: /(?:line\s+1\b|wages,?\s+salaries).*?(\$?[\d,]+(?:\.\d{0,2})?)/i },
  { key: "INTEREST_INCOME", pattern: /(?:line\s+2b|taxable\s+interest).*?(\$?[\d,]+(?:\.\d{0,2})?)/i },
  { key: "CAPITAL_GAINS", pattern: /(?:line\s+7|capital\s+gain).*?(\$?[\d,]+(?:\.\d{0,2})?)/i },
  { key: "BUSINESS_INCOME_SCHEDULE_C", pattern: /(?:line\s+(?:8|12)|business\s+income|schedule\s+C\s+(?:net|income)).*?(\$?[\d,]+(?:\.\d{0,2})?)/i },
  { key: "RENTAL_INCOME", pattern: /(?:line\s+(?:5|17)|rental.*?income|schedule\s+E).*?(\$?[\d,]+(?:\.\d{0,2})?)/i },
  { key: "SOCIAL_SECURITY", pattern: /(?:line\s+6[ab]|social\s+security).*?(\$?[\d,]+(?:\.\d{0,2})?)/i },
  { key: "IRA_DISTRIBUTIONS", pattern: /(?:line\s+4[ab]|IRA\s+distributions?|pension).*?(\$?[\d,]+(?:\.\d{0,2})?)/i },
  { key: "TOTAL_INCOME", pattern: /(?:line\s+9|total\s+income).*?(\$?[\d,]+(?:\.\d{0,2})?)/i },
  { key: "ADJUSTED_GROSS_INCOME", pattern: /(?:line\s+11|adjusted\s+gross\s+income|AGI).*?(\$?[\d,]+(?:\.\d{0,2})?)/i },
  { key: "STANDARD_DEDUCTION", pattern: /(?:line\s+12|standard\s+deduction).*?(\$?[\d,]+(?:\.\d{0,2})?)/i },
  { key: "TAXABLE_INCOME", pattern: /(?:line\s+15|taxable\s+income).*?(\$?[\d,]+(?:\.\d{0,2})?)/i },
  { key: "TAX_LIABILITY", pattern: /(?:line\s+(?:16|24)|total\s+tax|tax\s+(?:liability|owed)).*?(\$?[\d,]+(?:\.\d{0,2})?)/i },
];

const FORM_1120_PATTERNS: LinePattern[] = [
  { key: "GROSS_RECEIPTS", pattern: /(?:line\s+1[abc]?|gross\s+receipts).*?(\$?[\d,]+(?:\.\d{0,2})?)/i },
  { key: "COST_OF_GOODS_SOLD", pattern: /(?:line\s+2|cost\s+of\s+goods\s+sold|COGS).*?(\$?[\d,]+(?:\.\d{0,2})?)/i },
  { key: "GROSS_PROFIT", pattern: /(?:line\s+3|gross\s+profit).*?(\$?[\d,]+(?:\.\d{0,2})?)/i },
  { key: "OFFICER_COMPENSATION", pattern: /(?:line\s+12|officer\s+compensation|compensation\s+of\s+officer).*?(\$?[\d,]+(?:\.\d{0,2})?)/i },
  { key: "SALARIES_WAGES", pattern: /(?:line\s+13|salaries\s+(?:and\s+)?wages).*?(\$?[\d,]+(?:\.\d{0,2})?)/i },
  { key: "DEPRECIATION", pattern: /(?:line\s+(?:14|20)|depreciation).*?(\$?[\d,]+(?:\.\d{0,2})?)/i },
  { key: "AMORTIZATION", pattern: /(?:amortization).*?(\$?[\d,]+(?:\.\d{0,2})?)/i },
  { key: "INTEREST_EXPENSE", pattern: /(?:line\s+18|interest\s+(?:expense|paid|deduction)).*?(\$?[\d,]+(?:\.\d{0,2})?)/i },
  { key: "RENT_EXPENSE", pattern: /(?:line\s+(?:16|17)|rents?\s+(?:expense|paid)).*?(\$?[\d,]+(?:\.\d{0,2})?)/i },
  { key: "TAXES_LICENSES", pattern: /(?:line\s+17|taxes\s+(?:and\s+)?licenses).*?(\$?[\d,]+(?:\.\d{0,2})?)/i },
  { key: "TOTAL_DEDUCTIONS", pattern: /(?:line\s+27|total\s+deductions).*?(\$?[\d,]+(?:\.\d{0,2})?)/i },
  { key: "TAXABLE_INCOME", pattern: /(?:line\s+(?:28|30)|taxable\s+income).*?(\$?[\d,]+(?:\.\d{0,2})?)/i },
  { key: "NET_INCOME", pattern: /(?:net\s+income|net\s+profit).*?(\$?[\d,]+(?:\.\d{0,2})?)/i },
];

const FORM_1065_PATTERNS: LinePattern[] = [
  { key: "GROSS_RECEIPTS", pattern: /(?:line\s+1[abc]?|gross\s+receipts).*?(\$?[\d,]+(?:\.\d{0,2})?)/i },
  { key: "GROSS_PROFIT", pattern: /(?:line\s+3\b|gross\s+profit).*?(\$?[\d,]+(?:\.\d{0,2})?)/i },
  { key: "TOTAL_INCOME", pattern: /(?:line\s+8\b|total\s+income).*?(\$?[\d,]+(?:\.\d{0,2})?)/i },
  { key: "TOTAL_DEDUCTIONS", pattern: /(?:line\s+22\b|total\s+deductions).*?(\$?[\d,]+(?:\.\d{0,2})?)/i },
  { key: "ORDINARY_BUSINESS_INCOME", pattern: /(?:line\s+23\b|ordinary\s+(?:business\s+)?income).*?(\$?[\d,]+(?:\.\d{0,2})?)/i },
  { key: "NET_RENTAL_REAL_ESTATE_INCOME", pattern: /(?:net\s+rental\s+real\s+estate|rental\s+real\s+estate\s+income).*?(\$?[\d,]+(?:\.\d{0,2})?)/i },
  { key: "GUARANTEED_PAYMENTS", pattern: /(?:guaranteed\s+payments?).*?(\$?[\d,]+(?:\.\d{0,2})?)/i },
  { key: "DEPRECIATION", pattern: /(?:depreciation).*?(\$?[\d,]+(?:\.\d{0,2})?)/i },
  { key: "INTEREST_EXPENSE", pattern: /(?:interest\s+(?:expense|paid|deduction)).*?(\$?[\d,]+(?:\.\d{0,2})?)/i },
  { key: "SALARIES_WAGES", pattern: /(?:salaries\s+(?:and\s+)?wages).*?(\$?[\d,]+(?:\.\d{0,2})?)/i },
  { key: "RENT_EXPENSE", pattern: /(?:rents?\s+(?:expense|paid)).*?(\$?[\d,]+(?:\.\d{0,2})?)/i },
  { key: "DISTRIBUTIONS", pattern: /(?:distributions?\s+(?:to|paid)).*?(\$?[\d,]+(?:\.\d{0,2})?)/i },
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
// Structured entity type → canonical key mapping
// ---------------------------------------------------------------------------

const ENTITY_MAP: Record<string, string> = {
  // Income statement
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
  rent_expense: "RENT_EXPENSE",
  repairs_maintenance: "REPAIRS_MAINTENANCE",
  bad_debt_expense: "BAD_DEBT_EXPENSE",
  advertising_expense: "ADVERTISING",
  pension_profit_sharing: "PENSION_PROFIT_SHARING",
  employee_benefits: "EMPLOYEE_BENEFITS",
  other_deductions: "OTHER_DEDUCTIONS",
  other_income: "OTHER_INCOME",
  ordinary_income: "ORDINARY_BUSINESS_INCOME",
  ordinary_business_income: "ORDINARY_BUSINESS_INCOME",
  guaranteed_payments: "GUARANTEED_PAYMENTS",
  distributions: "DISTRIBUTIONS",
  taxes_paid: "TAXES_LICENSES",
  // Personal return keys
  wages: "WAGES_W2",
  adjusted_gross_income: "ADJUSTED_GROSS_INCOME",
  capital_gains: "CAPITAL_GAINS",
  // Schedule L balance sheet (maps to SL_ prefix via scheduleLReconciliation)
  cash_schedule_l: "SL_CASH",
  accounts_receivable_schedule_l: "SL_AR_GROSS",
  inventory_schedule_l: "SL_INVENTORY",
  other_current_assets_schedule_l: "SL_OTHER_CURRENT_ASSETS",
  officer_shareholder_loans_receivable: "SL_SHAREHOLDER_LOANS_RECEIVABLE",
  ppe_gross_schedule_l: "SL_PPE_GROSS",
  accumulated_depreciation_schedule_l: "SL_ACCUMULATED_DEPRECIATION",
  intangibles_gross_schedule_l: "SL_INTANGIBLES_GROSS",
  accumulated_amortization_schedule_l: "SL_ACCUMULATED_AMORTIZATION",
  land_schedule_l: "SL_LAND",
  total_assets: "SL_TOTAL_ASSETS",
  accounts_payable_schedule_l: "SL_ACCOUNTS_PAYABLE",
  wages_payable_schedule_l: "SL_WAGES_PAYABLE",
  other_current_liabilities_schedule_l: "SL_OTHER_LIABILITIES",
  operating_current_liabilities_schedule_l: "SL_OPERATING_CURRENT_LIABILITIES",
  mortgages_notes_bonds_lt: "SL_MORTGAGES_NOTES_BONDS",
  loans_from_shareholders: "SL_LOANS_FROM_SHAREHOLDERS",
  total_liabilities: "SL_TOTAL_LIABILITIES",
  retained_earnings_schedule_l: "SL_RETAINED_EARNINGS",
  paid_in_capital_schedule_l: "SL_CAPITAL_STOCK",
  total_equity: "SL_TOTAL_EQUITY",
};

// ---------------------------------------------------------------------------
// Extractor
// ---------------------------------------------------------------------------

export async function extractTaxReturnDeterministic(
  args: DeterministicExtractorArgs,
): Promise<ExtractionResult & { extractionPath: ExtractionPath }> {
  if (!args.ocrText.trim() && !args.structuredJson) {
    return { ok: true, factsWritten: 0, extractionPath: "ocr_regex" };
  }

  let items: ExtractedLineItem[] = [];
  let path: ExtractionPath = "ocr_regex";

  // Structured assist path (primary for tax returns)
  if (args.structuredJson) {
    const structuredItems = tryStructuredEntities(args);
    if (structuredItems.length > 0) {
      items = structuredItems;
      path = "gemini_structured";
    }
  }

  // Fallback 1: IRS line-number parsing (cross-line label/value separation)
  // IRS form OCR commonly renders values in a separate column, producing:
  //   "Gross receipts (Form 1065, line 1c)\n...\n1c\n1,227,085.\n"
  // Prefer this over label-based regex for known IRS forms since the label
  // descriptions contain line number references (e.g., "lines 9 through 21")
  // that produce false positives with same-line matching.
  if (items.length === 0 && args.ocrText.trim()) {
    const irsFormType = detectIrsFormType(args.ocrText);
    if (irsFormType !== "UNKNOWN") {
      items = tryIrsLineNumberParsing(args);
      path = "ocr_regex";
    }
  }

  // Fallback 2: OCR regex (same-line label+value) — for non-IRS forms or
  // when IRS line-number parsing fails to extract anything
  if (items.length === 0 && args.ocrText.trim()) {
    items = tryOcrRegex(args);
    path = "ocr_regex";
  }

  // Write main tax return items
  let factsWritten = 0;
  if (items.length > 0) {
    const mainResult = await writeFactsBatch({
      dealId: args.dealId,
      bankId: args.bankId,
      sourceDocumentId: args.documentId,
      factType: "TAX_RETURN",
      items,
    });
    factsWritten += mainResult.factsWritten;
  }

  // Detect K-1 presence and extract
  const ocrText = args.ocrText;
  const taxYear = resolveDocTaxYear(ocrText, args.docYear);

  const hasK1 = /schedule\s+k-?1\b/i.test(ocrText);
  let k1Facts = 0;
  if (hasK1) {
    const k1Result = extractK1(args);
    k1Facts = await writeK1Facts(k1Result, args, taxYear);
  }

  // Detect schedule presence and extract in parallel (non-blocking)

  const scheduleChecks: Array<{
    pattern: RegExp;
    extractor: (a: DeterministicExtractorArgs) => PureDeterministicResult;
    factType: string;
  }> = [
    { pattern: /schedule\s+l\b/i, extractor: extractScheduleL, factType: "TAX_RETURN_BALANCE_SHEET" },
    { pattern: /schedule\s+m-?1\b/i, extractor: extractScheduleM1, factType: "TAX_RETURN_RECONCILIATION" },
    { pattern: /form\s+4562\b/i, extractor: extractForm4562, factType: "TAX_RETURN_DEPRECIATION" },
    { pattern: /form\s+8825\b/i, extractor: extractForm8825, factType: "TAX_RETURN_RENTAL" },
    { pattern: /form\s+1125-?a\b|cost\s+of\s+goods\s+sold/i, extractor: extractForm1125A, factType: "TAX_RETURN_COGS_DETAIL" },
    { pattern: /form\s+1125-?e\b|compensation\s+of\s+officers/i, extractor: extractForm1125E, factType: "TAX_RETURN_OFFICER_COMP" },
  ];

  const schedulePromises = scheduleChecks
    .filter((s) => s.pattern.test(ocrText))
    .map((s) => writeScheduleFacts(s.extractor(args), args, s.factType, taxYear));

  const settled = await Promise.allSettled(schedulePromises);
  for (const r of settled) {
    if (r.status === "fulfilled") factsWritten += r.value;
  }

  factsWritten += k1Facts;

  // Write Schedule L balance sheet facts as canonical keys (TOTAL_ASSETS, NET_WORTH, etc.)
  // These supplement the SL_-prefixed keys written by writeScheduleFacts above
  if (args.structuredJson) {
    const entities = extractEntitiesFlat(args.structuredJson);
    if (entities.length > 0) {
      await writeScheduleLFacts({
        dealId: args.dealId,
        bankId: args.bankId,
        documentId: args.documentId,
        taxYear,
        entities,
      }).catch((err) =>
        console.warn("[extractFacts] writeScheduleLFacts failed (non-fatal)", { documentId: args.documentId, err })
      );
    }
  }

  // Write K-1 approximation facts for single-owner pass-through entities
  // OBI value comes from extracted items — find it from the written facts
  const obiItem = items.find((i) => i.factKey === "ORDINARY_BUSINESS_INCOME");
  const obiValue = obiItem?.value ?? null;
  if (obiValue !== null) {
    await writeK1BaseFacts({
      dealId: args.dealId,
      bankId: args.bankId,
      documentId: args.documentId,
      taxYear,
      ordinaryBusinessIncome: obiValue,
      ownerCount: 1, // Conservative default — single owner assumed if not parsed
    }).catch((err) =>
      console.warn("[extractFacts] writeK1BaseFacts failed (non-fatal)", { documentId: args.documentId, err })
    );
  }

  // Arithmetic validation — build facts snapshot from this extraction run
  const factsSnapshot: Record<string, number | null> = {};
  for (const item of items) {
    if (typeof item.value === "number") {
      factsSnapshot[item.factKey] = item.value;
    }
  }
  const validation = validateArithmetic(factsSnapshot);

  if (validation.failCount > 0) {
    console.warn(
      `[taxReturnExtractor] Arithmetic validation failures for deal ${args.dealId}:`,
      validation.results.filter((r) => !r.passes).map((r) => r.message),
    );
  }

  // Write validation summary fact so the UI can surface data quality
  if (validation.validationCount > 0) {
    try {
      await writeFactsBatch({
        dealId: args.dealId,
        bankId: args.bankId,
        sourceDocumentId: args.documentId,
        factType: "EXTRACTION_VALIDATION" as any,
        items: [{
          factKey: "EXTRACTION_CONFIDENCE",
          value: validation.overallConfidence,
          confidence: 1.0,
          periodStart: null,
          periodEnd: null,
          provenance: {
            source_type: "STRUCTURAL",
            source_ref: `deal_documents:${args.documentId}`,
            as_of_date: null,
            extractor: "arithmeticValidator:v1",
            confidence: 1.0,
            extraction_path: "computed",
            citations: validation.results
              .filter((r) => !r.passes)
              .map((r) => ({ page: null, snippet: r.message })),
            raw_snippets: validation.results
              .filter((r) => !r.passes)
              .map((r) => r.message),
          } as FinancialFactProvenance,
        }],
      });
    } catch {
      // Non-fatal — validation persistence is best-effort
    }
  }

  return { ok: true, factsWritten, extractionPath: path };
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

    const confidence = Math.min(1, Math.max(0, entity.confidence || 0.75));

    items.push({
      factKey: canonicalKey,
      value,
      confidence,
      periodStart,
      periodEnd,
      provenance: makeProvenance(args.documentId, periodEnd, confidence, entity.mentionText, "gemini_structured"),
    });
  }

  // Also try form fields (IRS forms have labeled fields)
  const formFields = extractFormFields(args.structuredJson);
  for (const field of formFields) {
    const normalized = field.name.toLowerCase().replace(/[\s-]+/g, "_").replace(/[^a-z0-9_]/g, "");
    const canonicalKey = ENTITY_MAP[normalized];
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
      provenance: makeProvenance(args.documentId, periodEnd, field.confidence, `${field.name}: ${field.value}`, "gemini_structured"),
    });
  }

  return items;
}

// ---------------------------------------------------------------------------
// OCR regex path
// ---------------------------------------------------------------------------

function tryOcrRegex(args: DeterministicExtractorArgs): ExtractedLineItem[] {
  const text = truncateBeforeK1(args.ocrText);
  const formType = detectIrsFormType(args.ocrText); // detect on full text, parse on truncated
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

// ---------------------------------------------------------------------------
// K-1 boundary guard — Schedule K-1 pages contain per-partner allocations
// whose line/box numbers collide with Form 1065 main-form line numbers.
// Truncate OCR text before the first K-1 header to prevent K-1 partner shares
// from being misread as entity-level IS values (e.g. K-1 box 2 ≠ 1065 line 2).
// ---------------------------------------------------------------------------

function truncateBeforeK1(text: string): string {
  const k1Match = text.search(/schedule\s+k-?1/i);
  if (k1Match > 0) return text.substring(0, k1Match);
  return text;
}

// ---------------------------------------------------------------------------
// IRS line-number parsing (handles cross-line OCR)
// ---------------------------------------------------------------------------

/**
 * IRS form line number → canonical key mappings.
 * These map the actual IRS form line numbers to our canonical keys.
 */
const IRS_LINE_MAP_1065: Record<string, string> = {
  "1": "GROSS_RECEIPTS", "1a": "GROSS_RECEIPTS", "1c": "GROSS_RECEIPTS",
  "2": "COST_OF_GOODS_SOLD",
  "3": "GROSS_PROFIT",
  "8": "TOTAL_INCOME",
  "9": "SALARIES_WAGES",
  "10": "GUARANTEED_PAYMENTS",
  "13": "RENT_EXPENSE",
  "14": "TAXES_LICENSES",
  "15": "INTEREST_EXPENSE",
  "16": "DEPRECIATION", "16a": "DEPRECIATION", "16c": "DEPRECIATION",
  "21": "OTHER_DEDUCTIONS",
  "22": "TOTAL_DEDUCTIONS",
  "23": "ORDINARY_BUSINESS_INCOME",
};

const IRS_LINE_MAP_1120: Record<string, string> = {
  "1": "GROSS_RECEIPTS", "1a": "GROSS_RECEIPTS", "1c": "GROSS_RECEIPTS",
  "2": "COST_OF_GOODS_SOLD",
  "3": "GROSS_PROFIT",
  "11": "TOTAL_INCOME",
  "12": "OFFICER_COMPENSATION",
  "13": "SALARIES_WAGES",
  "14": "REPAIRS_MAINTENANCE",
  "16": "RENT_EXPENSE",
  "17": "TAXES_LICENSES",
  "18": "INTEREST_EXPENSE",
  "20": "DEPRECIATION",
  "21": "DEPLETION",
  "26": "OTHER_DEDUCTIONS",
  "27": "TOTAL_DEDUCTIONS",
  "28": "TAXABLE_INCOME", "30": "TAXABLE_INCOME",
};

const IRS_LINE_MAP_1040: Record<string, string> = {
  "1": "WAGES_W2",
  "2b": "INTEREST_INCOME",
  "7": "CAPITAL_GAINS",
  "8": "BUSINESS_INCOME_SCHEDULE_C",
  "9": "TOTAL_INCOME",
  "11": "ADJUSTED_GROSS_INCOME",
  "12": "STANDARD_DEDUCTION",
  "15": "TAXABLE_INCOME",
  "16": "TAX_LIABILITY", "24": "TAX_LIABILITY",
};

/** 8879-PE Part I items → 1065 canonical keys (summary form) */
const IRS_LINE_MAP_8879: Record<string, string> = {
  "1": "GROSS_RECEIPTS",
  "2": "GROSS_PROFIT",
  "3": "ORDINARY_BUSINESS_INCOME",
  "4": "NET_RENTAL_REAL_ESTATE_INCOME",
};

function getLineMap(formType: IrsFormType, _text: string): Record<string, string> {
  // Use the main form type detection — NOT 8879 summary.
  // 8879-PE is an e-file authorization cover page whose line numbers have different
  // meanings than the actual 1065/1120 form. The main form always follows the 8879
  // and its line numbers are the ones we need to map.
  switch (formType) {
    case "1065": return IRS_LINE_MAP_1065;
    case "1120": case "1120S": return IRS_LINE_MAP_1120;
    case "1040": return IRS_LINE_MAP_1040;
    default: return { ...IRS_LINE_MAP_1065, ...IRS_LINE_MAP_1120 };
  }
}

/**
 * Parse IRS form values from OCR text where line numbers and values
 * appear on separate lines. Common OCR pattern:
 *   "1\n797,989.\n2\n797,989.\n3\n325,912."
 *
 * Also handles inline: "1  797,989." and "1\t797,989."
 */
function tryIrsLineNumberParsing(args: DeterministicExtractorArgs): ExtractedLineItem[] {
  const text = truncateBeforeK1(args.ocrText);
  const formType = detectIrsFormType(args.ocrText); // detect on full text, parse on truncated
  const lineMap = getLineMap(formType, text);
  const taxYear = resolveDocTaxYear(text, args.docYear);
  const period = taxYear ? `FY${taxYear}` : null;
  const { start: periodStart, end: periodEnd } = normalizePeriod(period);

  const items: ExtractedLineItem[] = [];
  const seen = new Set<string>();

  // Pattern: line number on its own line, value on the next line
  // Matches: "1\n797,989." or "1\n$797,989.00" or "22\n(325,912)" or "3\n1,227,085."
  // Note: \.\d{0,2} allows trailing period with 0 decimal digits (IRS whole-dollar format)
  const lineValueRe = /(?:^|\n)\s*(\d{1,2}[a-c]?)\s*\n\s*(\$?\(?-?[\d,]+(?:\.\d{0,2})?\)?)\s*(?:\n|$)/g;
  let m: RegExpExecArray | null;
  while ((m = lineValueRe.exec(text)) !== null) {
    const lineNum = m[1].toLowerCase();
    const canonicalKey = lineMap[lineNum];
    if (!canonicalKey || !VALID_LINE_KEYS.has(canonicalKey)) continue;
    if (seen.has(canonicalKey)) continue;

    const value = parseMoney(m[2]);
    if (value === null || value === 0) continue;

    // Guard: reject IRS reference numbers (1040, 1065, etc.)
    if (isLikelyReferenceNumber(value, m[0])) continue;

    // Guard: reject bare small numbers — likely label-number sequences (e.g., "1\n2\n3\n4\n5")
    // not real dollar amounts. IRS line items in business/personal returns are always > $100.
    if (Math.abs(value) < 100) continue;

    seen.add(canonicalKey);
    items.push({
      factKey: canonicalKey,
      value,
      confidence: 0.50,
      periodStart,
      periodEnd,
      provenance: makeProvenance(
        args.documentId, periodEnd, 0.50,
        `Line ${m[1]}: ${m[2]}`, "ocr_regex",
      ),
    });
  }

  // Also try inline: "line_num  value" on the same line with 2+ spaces or tab
  const inlineRe = /(?:^|\n)\s*(\d{1,2}[a-c]?)\s{2,}(\$?\(?-?[\d,]+(?:\.\d{0,2})?\)?)\s*(?:\n|$)/g;
  while ((m = inlineRe.exec(text)) !== null) {
    const lineNum = m[1].toLowerCase();
    const canonicalKey = lineMap[lineNum];
    if (!canonicalKey || !VALID_LINE_KEYS.has(canonicalKey)) continue;
    if (seen.has(canonicalKey)) continue;

    const value = parseMoney(m[2]);
    if (value === null || value === 0) continue;
    if (isLikelyReferenceNumber(value, m[0])) continue;
    if (Math.abs(value) < 100) continue;

    seen.add(canonicalKey);
    items.push({
      factKey: canonicalKey,
      value,
      confidence: 0.50,
      periodStart,
      periodEnd,
      provenance: makeProvenance(
        args.documentId, periodEnd, 0.50,
        `Line ${m[1]}: ${m[2]}`, "ocr_regex",
      ),
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
// Schedule fact writer
// ---------------------------------------------------------------------------

async function writeScheduleFacts(
  result: PureDeterministicResult,
  args: DeterministicExtractorArgs,
  factType: string,
  taxYear: number | null,
): Promise<number> {
  const numericItems = result.items.filter((i) => typeof i.value === "number");
  if (numericItems.length === 0) return 0;

  const period = taxYear ? `FY${taxYear}` : null;
  const { start: periodStart, end: periodEnd } = normalizePeriod(period);

  const mapped: ExtractedLineItem[] = numericItems.map((i) => ({
    factKey: i.key,
    value: i.value as number,
    confidence: 0.50,
    periodStart,
    periodEnd,
    provenance: makeProvenance(
      args.documentId,
      periodEnd,
      0.50,
      i.snippet,
      result.extractionPath,
    ),
  }));

  const writeResult = await writeFactsBatch({
    dealId: args.dealId,
    bankId: args.bankId,
    sourceDocumentId: args.documentId,
    factType: factType as any,
    items: mapped,
  });

  return writeResult.factsWritten;
}

// ---------------------------------------------------------------------------
// K-1 fact writer
// ---------------------------------------------------------------------------

async function writeK1Facts(
  result: PureDeterministicResult,
  args: DeterministicExtractorArgs,
  taxYear: number | null,
): Promise<number> {
  if (!result.ok || result.items.length === 0) return 0;
  const period = taxYear ? `FY${taxYear}` : null;
  const { start: periodStart, end: periodEnd } = normalizePeriod(period);
  const mapped: ExtractedLineItem[] = result.items
    .filter((i) => typeof i.value === "number" && i.value !== 0)
    .map((i) => ({
      factKey: i.key,
      value: i.value as number,
      confidence: 0.60,
      periodStart,
      periodEnd,
      provenance: makeProvenance(
        args.documentId,
        periodEnd,
        0.60,
        i.snippet,
        result.extractionPath,
      ),
    }));
  if (mapped.length === 0) return 0;
  const r = await writeFactsBatch({
    dealId: args.dealId,
    bankId: args.bankId,
    sourceDocumentId: args.documentId,
    factType: "TAX_RETURN_K1" as any,
    items: mapped,
  });
  return r.factsWritten;
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
