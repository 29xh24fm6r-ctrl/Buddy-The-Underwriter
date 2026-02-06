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
// Canonical line item keys for balance sheets
// ---------------------------------------------------------------------------

const VALID_LINE_KEYS = new Set([
  // Current Assets
  "CASH_AND_EQUIVALENTS",
  "ACCOUNTS_RECEIVABLE",
  "INVENTORY",
  "PREPAID_EXPENSES",
  "OTHER_CURRENT_ASSETS",
  "TOTAL_CURRENT_ASSETS",

  // Non-Current Assets
  "PROPERTY_PLANT_EQUIPMENT",
  "ACCUMULATED_DEPRECIATION",
  "NET_FIXED_ASSETS",
  "INVESTMENT_PROPERTIES",
  "INTANGIBLE_ASSETS",
  "OTHER_NON_CURRENT_ASSETS",
  "TOTAL_NON_CURRENT_ASSETS",
  "TOTAL_ASSETS",

  // Current Liabilities
  "ACCOUNTS_PAYABLE",
  "ACCRUED_EXPENSES",
  "SHORT_TERM_DEBT",
  "CURRENT_PORTION_LTD",
  "OTHER_CURRENT_LIABILITIES",
  "TOTAL_CURRENT_LIABILITIES",

  // Non-Current Liabilities
  "LONG_TERM_DEBT",
  "MORTGAGE_PAYABLE",
  "DEFERRED_TAX_LIABILITY",
  "OTHER_NON_CURRENT_LIABILITIES",
  "TOTAL_NON_CURRENT_LIABILITIES",
  "TOTAL_LIABILITIES",

  // Equity
  "COMMON_STOCK",
  "RETAINED_EARNINGS",
  "PARTNERS_CAPITAL",
  "MEMBERS_EQUITY",
  "OTHER_EQUITY",
  "TOTAL_EQUITY",

  // Summary
  "TOTAL_LIABILITIES_AND_EQUITY",
]);

// ---------------------------------------------------------------------------
// Extraction prompt
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `You are a financial data extraction expert for commercial lending.

Given a balance sheet document, extract every line item you can identify.

For EACH line item, provide:
- "line_key": One of these canonical keys:
  Assets: CASH_AND_EQUIVALENTS, ACCOUNTS_RECEIVABLE, INVENTORY, PREPAID_EXPENSES, OTHER_CURRENT_ASSETS, TOTAL_CURRENT_ASSETS, PROPERTY_PLANT_EQUIPMENT, ACCUMULATED_DEPRECIATION, NET_FIXED_ASSETS, INVESTMENT_PROPERTIES, INTANGIBLE_ASSETS, OTHER_NON_CURRENT_ASSETS, TOTAL_NON_CURRENT_ASSETS, TOTAL_ASSETS
  Liabilities: ACCOUNTS_PAYABLE, ACCRUED_EXPENSES, SHORT_TERM_DEBT, CURRENT_PORTION_LTD, OTHER_CURRENT_LIABILITIES, TOTAL_CURRENT_LIABILITIES, LONG_TERM_DEBT, MORTGAGE_PAYABLE, DEFERRED_TAX_LIABILITY, OTHER_NON_CURRENT_LIABILITIES, TOTAL_NON_CURRENT_LIABILITIES, TOTAL_LIABILITIES
  Equity: COMMON_STOCK, RETAINED_EARNINGS, PARTNERS_CAPITAL, MEMBERS_EQUITY, OTHER_EQUITY, TOTAL_EQUITY
  Summary: TOTAL_LIABILITIES_AND_EQUITY
- "period": The as-of date or period (e.g. "2023-12-31", "FY2023", "2023")
- "value": The dollar amount as a number. Use positive values. Contra-accounts (like accumulated depreciation) should be positive — the system knows they're subtractive.
- "confidence": 0.0-1.0
- "snippet": The relevant text snippet

If the document has MULTIPLE periods (comparative balance sheet), extract each period separately.

Respond with JSON:
{
  "as_of_dates": ["2023-12-31", "2022-12-31"],
  "entity_name": "ABC Holdings LLC" or null,
  "line_items": [
    {
      "line_key": "CASH_AND_EQUIVALENTS",
      "period": "2023-12-31",
      "value": 125000,
      "confidence": 0.95,
      "snippet": "Cash and Cash Equivalents $125,000"
    }
  ]
}

Rules:
- Extract ALL periods shown (current year and prior year comparisons)
- Map document labels to the closest canonical line_key
- Values should always be positive
- If you can't determine the exact date, use FY + year (e.g. "FY2023")`;

// ---------------------------------------------------------------------------
// Extractor
// ---------------------------------------------------------------------------

export async function extractBalanceSheet(args: {
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
    console.error("[balanceSheetExtractor] Claude call failed:", msg);
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
      extractor: "balanceSheetExtractor:v1",
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
    factType: "BALANCE_SHEET",
    items,
  });
}
