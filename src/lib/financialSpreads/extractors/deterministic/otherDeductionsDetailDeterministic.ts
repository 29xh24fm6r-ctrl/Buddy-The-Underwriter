/**
 * SPEC-TAX-RETURN-OTHER-DEDUCTIONS-STATEMENT-SPREADING-2
 *
 * Extracts line-level detail from "Other Deductions" attached statement
 * in business tax returns (Form 1120 line 26, 1120-S line 19, 1065 line 20).
 *
 * Uses OCR text pattern matching to find itemized deduction lines.
 * Falls back to Gemini structured assist form fields if available.
 *
 * Returns PureLineItem[] with OD_DETAIL_* prefixed keys + summary totals.
 */

import type { DeterministicExtractorArgs, PureDeterministicResult, PureLineItem } from "./types";
import { OD_CATEGORIES, OD_SUMMARY_KEYS, type OdCategory } from "../otherDeductionsDetailKeys";

// ── Category aliases: map raw OCR labels to normalized categories ──────────

const CATEGORY_ALIASES: Array<{ pattern: RegExp; category: OdCategory }> = [
  { pattern: /officer.?s?\s+comp|officers?\s+salary/i, category: "OFFICER_COMPENSATION" },
  { pattern: /wages|salaries|payroll|contract\s+labor/i, category: "WAGES_CONTRACT_LABOR" },
  { pattern: /\brent\b|lease\s+expense|office\s+rent/i, category: "RENT" },
  { pattern: /insurance|liability\s+ins|health\s+ins|workers?\s+comp/i, category: "INSURANCE" },
  { pattern: /legal|attorney|litigation/i, category: "LEGAL_PROFESSIONAL" },
  { pattern: /accounting|audit|bookkeep|cpa/i, category: "ACCOUNTING" },
  { pattern: /consult/i, category: "CONSULTING" },
  { pattern: /management\s+fee|admin\s+fee|advisory\s+fee/i, category: "MANAGEMENT_FEES" },
  { pattern: /related\s+party|intercompany|affiliated/i, category: "RELATED_PARTY_PAYMENTS" },
  { pattern: /meal|entertain|banquet|food/i, category: "MEALS_ENTERTAINMENT" },
  { pattern: /travel|auto|mileage|vehicle|gas|fuel/i, category: "TRAVEL_AUTO" },
  { pattern: /tax|license|permit|franchise\s+tax/i, category: "TAXES_LICENSES" },
  { pattern: /repair|maintenance|janitorial|cleaning/i, category: "REPAIRS_MAINTENANCE" },
  { pattern: /bad\s+debt|uncollect|write.?off/i, category: "BAD_DEBT" },
  { pattern: /deprec|amortiz/i, category: "DEPRECIATION_AMORTIZATION" },
  { pattern: /interest\s+expense|interest\s+paid|loan\s+interest/i, category: "INTEREST" },
  { pattern: /charit|donat|contribut/i, category: "CHARITABLE_CONTRIBUTIONS" },
  { pattern: /non.?recur|one.?time|extraordinary|settlement|lawsuit/i, category: "NON_RECURRING_OR_UNUSUAL" },
];

function normalizeCategory(rawLabel: string): OdCategory {
  for (const { pattern, category } of CATEGORY_ALIASES) {
    if (pattern.test(rawLabel)) return category;
  }
  return "OTHER_UNCATEGORIZED";
}

// ── Line extraction from OCR text ──────────────────────────────────────────

/**
 * Parse lines that look like "Description ... $1,234,567" or "Description 1234567"
 * from the "Other Deductions" statement section of a tax return.
 */
function extractLinesFromOcr(ocrText: string): Array<{ label: string; amount: number }> {
  const lines: Array<{ label: string; amount: number }> = [];

  // Find the "other deductions" statement section
  const sectionMatch = ocrText.match(
    /(?:other\s+deductions|statement\s+\d+[:\s]*other|line\s+(?:19|20|26)\s+(?:detail|other))[^\n]*\n([\s\S]*?)(?:\n\s*(?:total|form\s+\d|page\s+\d|schedule)|\z)/i,
  );

  const sectionText = sectionMatch ? sectionMatch[1] : ocrText;

  // Match lines with description + dollar amount
  // Patterns: "Some description ... $1,234" or "Some description 1,234.56"
  const linePattern = /^[ \t]*(.{5,60}?)\s+\$?\s*([\d,]+(?:\.\d{1,2})?)\s*$/gm;
  let match: RegExpExecArray | null;

  while ((match = linePattern.exec(sectionText)) !== null) {
    const label = match[1].trim();
    const amountStr = match[2].replace(/,/g, "");
    const amount = parseFloat(amountStr);

    // Filter noise: must be a reasonable dollar amount and label must have letters
    if (Number.isFinite(amount) && amount > 0 && /[a-zA-Z]/.test(label)) {
      lines.push({ label, amount });
    }
  }

  return lines;
}

// ── Structured JSON extraction ─────────────────────────────────────────────

function extractFromStructuredJson(
  structuredJson: Record<string, unknown> | null,
): Array<{ label: string; amount: number }> {
  if (!structuredJson) return [];

  const lines: Array<{ label: string; amount: number }> = [];

  // Gemini structured assist returns entities and formFields
  const formFields = (structuredJson as any)?.formFields ?? (structuredJson as any)?.form_fields ?? [];
  if (!Array.isArray(formFields)) return [];

  for (const field of formFields) {
    const name = String(field.name ?? field.field_name ?? "").trim();
    const rawValue = field.value ?? field.field_value;
    if (!name || !rawValue) continue;

    const amount = typeof rawValue === "number"
      ? rawValue
      : parseFloat(String(rawValue).replace(/[$,]/g, ""));

    if (Number.isFinite(amount) && amount > 0 && name.length > 2) {
      lines.push({ label: name, amount });
    }
  }

  return lines;
}

// ── Main extractor ─────────────────────────────────────────────────────────

export function extractOtherDeductionsDetail(
  args: DeterministicExtractorArgs,
): PureDeterministicResult {
  const items: PureLineItem[] = [];

  // Try structured JSON first, then OCR
  let rawLines = extractFromStructuredJson((args.structuredJson as Record<string, unknown>) ?? null);
  let extractionPath: "gemini_structured" | "ocr_regex" = "gemini_structured";

  if (rawLines.length === 0 && args.ocrText) {
    rawLines = extractLinesFromOcr(args.ocrText);
    extractionPath = "ocr_regex";
  }

  if (rawLines.length === 0) {
    return { ok: false, items: [], extractionPath: "ocr_regex", factsAttempted: 0 };
  }

  // Normalize and categorize
  const categoryTotals = new Map<OdCategory, number>();

  for (const line of rawLines) {
    const category = normalizeCategory(line.label);
    categoryTotals.set(category, (categoryTotals.get(category) ?? 0) + line.amount);
  }

  // Emit per-category facts
  const period = args.ocrText.match(/FY\d{4}/) ? args.ocrText.match(/FY(\d{4})/)![0] : null;

  for (const [category, total] of categoryTotals.entries()) {
    items.push({
      key: `OD_DETAIL_${category}`,
      value: total,
      period,
      snippet: `Other deductions: ${category} = ${total}`,
    });
  }

  // Emit summary facts
  const detailTotal = Array.from(categoryTotals.values()).reduce((a, b) => a + b, 0);

  items.push({
    key: OD_SUMMARY_KEYS.DETAIL_TOTAL,
    value: detailTotal,
    period,
    snippet: `Other deductions detail total = ${detailTotal}`,
  });

  const uncategorizedTotal = categoryTotals.get("OTHER_UNCATEGORIZED") ?? 0;
  items.push({
    key: OD_SUMMARY_KEYS.UNCATEGORIZED_TOTAL,
    value: uncategorizedTotal,
    period,
    snippet: `Other deductions uncategorized total = ${uncategorizedTotal}`,
  });

  const relatedPartyTotal = (categoryTotals.get("RELATED_PARTY_PAYMENTS") ?? 0)
    + (categoryTotals.get("MANAGEMENT_FEES") ?? 0);
  items.push({
    key: OD_SUMMARY_KEYS.RELATED_PARTY_TOTAL,
    value: relatedPartyTotal,
    period,
    snippet: `Other deductions related-party total = ${relatedPartyTotal}`,
  });

  // Potential add-backs
  let addbackTotal = 0;
  const addbackCategories: OdCategory[] = [
    "OFFICER_COMPENSATION", "RELATED_PARTY_PAYMENTS", "MANAGEMENT_FEES",
    "MEALS_ENTERTAINMENT", "NON_RECURRING_OR_UNUSUAL", "CHARITABLE_CONTRIBUTIONS",
  ];
  for (const cat of addbackCategories) {
    addbackTotal += categoryTotals.get(cat) ?? 0;
  }
  items.push({
    key: OD_SUMMARY_KEYS.POTENTIAL_ADDBACK_TOTAL,
    value: addbackTotal,
    period,
    snippet: `Other deductions potential add-back total = ${addbackTotal}`,
  });

  const nonRecurringTotal = categoryTotals.get("NON_RECURRING_OR_UNUSUAL") ?? 0;
  items.push({
    key: OD_SUMMARY_KEYS.NON_RECURRING_TOTAL,
    value: nonRecurringTotal,
    period,
    snippet: `Other deductions non-recurring total = ${nonRecurringTotal}`,
  });

  return {
    ok: items.length > 0,
    items,
    extractionPath,
    factsAttempted: rawLines.length,
  };
}
