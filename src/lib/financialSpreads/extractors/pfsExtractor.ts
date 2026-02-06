import "server-only";

import type { FinancialFactProvenance } from "@/lib/financialFacts/keys";
import {
  callClaudeForExtraction,
  normalizePeriod,
  writeFactsBatch,
  type ExtractedLineItem,
  type ExtractionResult,
} from "./shared";

const VALID_LINE_KEYS = new Set([
  // Assets
  "PFS_CASH",
  "PFS_SECURITIES",
  "PFS_REAL_ESTATE",
  "PFS_BUSINESS_INTERESTS",
  "PFS_RETIREMENT",
  "PFS_OTHER_ASSETS",
  "PFS_TOTAL_ASSETS",
  // Liabilities
  "PFS_MORTGAGES",
  "PFS_INSTALLMENT_DEBT",
  "PFS_CREDIT_CARDS",
  "PFS_CONTINGENT",
  "PFS_OTHER_LIABILITIES",
  "PFS_TOTAL_LIABILITIES",
  // Equity
  "PFS_NET_WORTH",
  // Annual obligations (critical for GCF)
  "PFS_ANNUAL_DEBT_SERVICE",
  "PFS_LIVING_EXPENSES",
]);

const SYSTEM_PROMPT = `You are a financial data extraction expert for commercial real estate lending.

Given a Personal Financial Statement (PFS), extract all asset, liability, and equity line items. PFS documents vary wildly between banks — SBA Form 413 is one common variant, but there are many others.

Your job is to NORMALIZE CONCEPTS, not match layouts. Different banks organize PFS differently.

For EACH line item, provide:
- "line_key": One of these canonical keys:
  Assets: PFS_CASH, PFS_SECURITIES, PFS_REAL_ESTATE, PFS_BUSINESS_INTERESTS, PFS_RETIREMENT, PFS_OTHER_ASSETS, PFS_TOTAL_ASSETS
  Liabilities: PFS_MORTGAGES, PFS_INSTALLMENT_DEBT, PFS_CREDIT_CARDS, PFS_CONTINGENT, PFS_OTHER_LIABILITIES, PFS_TOTAL_LIABILITIES
  Equity: PFS_NET_WORTH
  Obligations: PFS_ANNUAL_DEBT_SERVICE, PFS_LIVING_EXPENSES
- "period": The as-of date or statement date (e.g. "2024-01-15", "2024", "Jan 2024")
- "value": The dollar amount as a number (no dollar signs or commas). Always positive.
- "confidence": 0.0-1.0 how confident you are in this value
- "snippet": The relevant text snippet from the document

Mapping guidance:
- Cash, checking, savings accounts → PFS_CASH
- Stocks, bonds, mutual funds, brokerage accounts → PFS_SECURITIES
- Real estate (market value of all properties) → PFS_REAL_ESTATE
- Business ownership interests, partnership equity → PFS_BUSINESS_INTERESTS
- 401(k), IRA, pension, retirement accounts → PFS_RETIREMENT
- Automobiles, life insurance cash value, other → PFS_OTHER_ASSETS
- Home mortgages, investment property mortgages → PFS_MORTGAGES
- Auto loans, student loans, installment loans → PFS_INSTALLMENT_DEBT
- Credit card balances → PFS_CREDIT_CARDS
- Guarantees, co-signed obligations → PFS_CONTINGENT
- Any other liabilities → PFS_OTHER_LIABILITIES
- Total annual debt payments (all loan payments per year) → PFS_ANNUAL_DEBT_SERVICE
- Total annual living/household expenses → PFS_LIVING_EXPENSES

Respond with a JSON object:
{
  "as_of_date": "2024-01-15",
  "filer_name": "John Smith" or null,
  "joint_filing": true or false,
  "line_items": [
    {
      "line_key": "PFS_CASH",
      "period": "2024-01-15",
      "value": 50000,
      "confidence": 0.9,
      "snippet": "Cash in banks ... $50,000"
    }
  ]
}

Rules:
- ALWAYS try to extract PFS_TOTAL_ASSETS, PFS_TOTAL_LIABILITIES, and PFS_NET_WORTH
- PFS_ANNUAL_DEBT_SERVICE and PFS_LIVING_EXPENSES are critical for global cash flow — extract if present
- If totals don't reconcile with individual items, extract both but lower confidence
- Use the statement date as the period, not the filing date`;

export async function extractPfs(args: {
  dealId: string;
  bankId: string;
  documentId: string;
  ocrText: string;
  ownerEntityId?: string | null;
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
    console.error("[pfsExtractor] Claude call failed:", msg);
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
      extractor: "pfsExtractor:v1",
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
    factType: "PERSONAL_FINANCIAL_STATEMENT",
    items,
    ownerType: "PERSONAL",
    ownerEntityId: args.ownerEntityId ?? null,
  });
}
