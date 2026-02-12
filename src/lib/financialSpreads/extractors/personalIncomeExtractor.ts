import "server-only";

import type { FinancialFactProvenance } from "@/lib/financialFacts/keys";
import {
  normalizePeriod,
  writeFactsBatch,
  type ExtractedLineItem,
  type ExtractionResult,
} from "./shared";

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

const SYSTEM_PROMPT = `You are a financial data extraction expert for commercial real estate lending.

Given a PERSONAL tax return (IRS Form 1040) or related personal income documents, extract all personal income line items.

For EACH line item, provide:
- "line_key": One of these canonical keys: WAGES_W2, SCHED_C_NET, SCHED_E_NET, K1_ORDINARY_INCOME, INTEREST_INCOME, DIVIDEND_INCOME, CAPITAL_GAINS, SOCIAL_SECURITY, IRA_DISTRIBUTIONS, OTHER_INCOME, TOTAL_PERSONAL_INCOME, ADJUSTED_GROSS_INCOME
- "period": The tax year (e.g. "2023", "FY2022")
- "value": The dollar amount as a number (no dollar signs or commas). Use positive for income, negative for losses.
- "confidence": 0.0-1.0 how confident you are in this value
- "snippet": The relevant text snippet from the document

Mapping guidance:
- W-2 wages/salaries → WAGES_W2
- Schedule C net profit/loss → SCHED_C_NET
- Schedule E net rental/royalty income → SCHED_E_NET
- K-1 ordinary business income → K1_ORDINARY_INCOME
- Interest income (Schedule B or line 2b) → INTEREST_INCOME
- Dividend income (Schedule B or line 3b) → DIVIDEND_INCOME
- Capital gains (Schedule D or line 7) → CAPITAL_GAINS
- Social security benefits (taxable) → SOCIAL_SECURITY
- IRA/pension distributions (taxable) → IRA_DISTRIBUTIONS
- Any other income → OTHER_INCOME
- Total income (line 9 or similar) → TOTAL_PERSONAL_INCOME
- Adjusted Gross Income (line 11 or similar) → ADJUSTED_GROSS_INCOME

Respond with a JSON object:
{
  "tax_year": "2023",
  "filer_name": "John Smith" or null,
  "filing_status": "married_filing_jointly" or null,
  "line_items": [
    {
      "line_key": "WAGES_W2",
      "period": "2023",
      "value": 125000,
      "confidence": 0.95,
      "snippet": "Wages, salaries, tips ... $125,000"
    }
  ]
}

Rules:
- Extract ALL income categories present in the document
- If multiple years are present, extract each year separately
- Expense values from Schedule C/E should be NET (income minus expenses)
- Always try to extract TOTAL_PERSONAL_INCOME and ADJUSTED_GROSS_INCOME`;

export async function extractPersonalIncome(_args: {
  dealId: string;
  bankId: string;
  documentId: string;
  ocrText: string;
  ownerEntityId?: string | null;
}): Promise<ExtractionResult> {
  return { ok: false, factsWritten: 0, skipped: true, skipReason: "legacy_llm_extractor_disabled" };
}
