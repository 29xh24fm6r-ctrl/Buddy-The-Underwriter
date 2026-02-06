import "server-only";

import type { FinancialFactProvenance } from "@/lib/financialFacts/keys";
import {
  callClaudeForExtraction,
  normalizePeriod,
  writeFactsBatch,
  type ExtractedLineItem,
  type ExtractionResult,
} from "./shared";

// ---------------------------------------------------------------------------
// Canonical line item keys for income statements / T12 / P&L
// ---------------------------------------------------------------------------

const VALID_LINE_KEYS = new Set([
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
  // Totals (derived by AI from the document)
  "EFFECTIVE_GROSS_INCOME",
  "TOTAL_OPERATING_EXPENSES",
  "NET_OPERATING_INCOME",
  "NET_INCOME",
]);

// ---------------------------------------------------------------------------
// Extraction prompt
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `You are a financial data extraction expert for commercial real estate lending.

Given an operating statement, trailing 12-month (T12), or income/expense report, extract every line item you can identify.

For EACH line item, provide:
- "line_key": One of these canonical keys: GROSS_RENTAL_INCOME, VACANCY_CONCESSIONS, OTHER_INCOME, REPAIRS_MAINTENANCE, UTILITIES, PROPERTY_MANAGEMENT, REAL_ESTATE_TAXES, INSURANCE, PAYROLL, MARKETING, PROFESSIONAL_FEES, OTHER_OPEX, DEPRECIATION, AMORTIZATION, DEBT_SERVICE, CAPITAL_EXPENDITURES, EFFECTIVE_GROSS_INCOME, TOTAL_OPERATING_EXPENSES, NET_OPERATING_INCOME, NET_INCOME
- "period": The period label (e.g. "2024-01", "Jan 2024", "FY2023", "TTM", "Q3 2024", "2023")
- "value": The dollar amount as a number (no dollar signs or commas). Use positive for income/assets, negative for losses.
- "confidence": 0.0-1.0 how confident you are in this value
- "snippet": The relevant text snippet from the document

If the document has MONTHLY columns, extract EACH month separately.
If it has annual/TTM totals, also extract those.

Respond with a JSON object:
{
  "document_period_description": "Trailing 12-month operating statement, Jan 2023 - Dec 2023",
  "property_name": "Sunset Apartments" or null,
  "line_items": [
    {
      "line_key": "GROSS_RENTAL_INCOME",
      "period": "2023-01",
      "value": 45000,
      "confidence": 0.92,
      "snippet": "Gross Rental Income ... $45,000"
    }
  ]
}

Rules:
- Extract ALL periods present in the document (monthly, quarterly, annual, YTD, TTM)
- Map document labels to the closest canonical line_key
- If unsure which key, use OTHER_INCOME (for income) or OTHER_OPEX (for expenses)
- Expense values should be POSITIVE (they represent costs, not losses)
- Use the period format that best matches what the document shows
- If no period can be determined, use the tax year or fiscal year (e.g. "FY2023")`;

// ---------------------------------------------------------------------------
// Extractor
// ---------------------------------------------------------------------------

export async function extractIncomeStatement(args: {
  dealId: string;
  bankId: string;
  documentId: string;
  ocrText: string;
}): Promise<ExtractionResult> {
  if (!args.ocrText.trim()) {
    return { ok: true, factsWritten: 0 };
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = await callClaudeForExtraction({
      systemPrompt: SYSTEM_PROMPT,
      ocrText: args.ocrText,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[incomeStatementExtractor] Claude call failed:", msg);
    return { ok: false, factsWritten: 0, error: msg };
  }

  const rawItems = Array.isArray(parsed.line_items) ? parsed.line_items : [];
  const items: ExtractedLineItem[] = [];

  for (const raw of rawItems) {
    const lineKey = String(raw.line_key ?? "").toUpperCase();
    if (!VALID_LINE_KEYS.has(lineKey)) continue;

    const value = Number(raw.value);
    if (!Number.isFinite(value)) continue;

    const confidence = Math.min(1, Math.max(0, Number(raw.confidence) || 0.5));
    const { start, end } = normalizePeriod(raw.period);

    const provenance: FinancialFactProvenance = {
      source_type: "DOC_EXTRACT",
      source_ref: `deal_documents:${args.documentId}`,
      as_of_date: end,
      extractor: "incomeStatementExtractor:v1",
      confidence,
      citations: raw.snippet ? [{ page: null, snippet: String(raw.snippet) }] : [],
      raw_snippets: raw.snippet ? [String(raw.snippet)] : [],
    };

    items.push({
      factKey: lineKey,
      value,
      confidence,
      periodStart: start,
      periodEnd: end,
      provenance,
    });
  }

  if (!items.length) {
    return { ok: true, factsWritten: 0 };
  }

  return writeFactsBatch({
    dealId: args.dealId,
    bankId: args.bankId,
    sourceDocumentId: args.documentId,
    factType: "INCOME_STATEMENT",
    items,
  });
}
