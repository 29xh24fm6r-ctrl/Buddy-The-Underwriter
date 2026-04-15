import "server-only";
import { upsertDealFinancialFact } from "@/lib/financialFacts/writeFact";

/**
 * Credit Memo Extractor (Deterministic)
 *
 * Extracts structured facts from internal bank credit memos, loan worksheets,
 * and officer narratives. Designed specifically to handle prior-approved OGB
 * credit packages uploaded alongside new loan requests for the same borrower.
 *
 * Writes to deal_financial_facts with factType=CREDIT_MEMO.
 *
 * Key facts extracted:
 *   PRIOR_LOAN_AMOUNT_1        — first loan amount from prior memo ($)
 *   PRIOR_LOAN_RATE_1          — interest rate on prior loan 1 (decimal)
 *   PRIOR_LOAN_TERM_1          — term in years
 *   PRIOR_ANNUAL_DS_1          — annual debt service for loan 1 ($)
 *   PRIOR_LOAN_AMOUNT_2        — second loan amount (e.g. CDC tranche)
 *   PRIOR_LOAN_RATE_2          — interest rate on prior loan 2
 *   PRIOR_ANNUAL_DS_2          — annual debt service for loan 2 ($)
 *   PRIOR_TOTAL_ANNUAL_DS      — total combined annual debt service ($)
 *   PRIOR_DSCR                 — DSCR as stated in the prior memo (number)
 *   PRIOR_COLLATERAL_ADDRESS   — collateral property address (text)
 *   PRIOR_LOAN_PURPOSE         — purpose of loan (text)
 *   PRIOR_BORROWER_NAME        — borrower entity name (text)
 *   PRIOR_LENDER_NAME          — lender name (text)
 *   PRIOR_LTV                  — loan-to-value ratio (decimal, e.g. 0.90)
 *   PRIOR_LOAN_PROGRAM         — "SBA_504" | "CONVENTIONAL" | "SBA_7A" (text)
 *   EXISTING_RELATIONSHIP      — "true" | "false" — borrower has prior OGB loan (text)
 *
 * The PRIOR_TOTAL_ANNUAL_DS fact is the critical input for global cash flow
 * stacking when this borrower requests a new/additional loan.
 */

interface ExtractArgs {
  dealId: string;
  bankId: string;
  documentId: string;
  ocrText: string;
}

interface ExtractResult {
  factsWritten: number;
  extractionPath: string;
}

// ---------------------------------------------------------------------------
// Parsing helpers
// ---------------------------------------------------------------------------

function parseMoneyStr(raw: string): number | null {
  const clean = raw.replace(/[,$\s]/g, "");
  const n = parseFloat(clean);
  return isNaN(n) ? null : n;
}

function parseRateStr(raw: string): number | null {
  const clean = raw.replace(/[%\s]/g, "");
  const n = parseFloat(clean);
  if (isNaN(n)) return null;
  // Convert percentage to decimal if >1
  return n > 1 ? n / 100 : n;
}

/**
 * Extract the lender bank name from the document header/letterhead.
 * Handles "OLD GLORY BANK", "OGB", etc.
 */
function extractLenderName(text: string): string | null {
  const patterns = [
    /OLD\s+GLORY\s+BANK/i,
    /(?:prepared\s+(?:by|for)|lender)[:\s]+([A-Z][A-Za-z\s&,\.]{3,60}(?:Bank|Savings|Credit\s+Union|Financial))/i,
  ];
  for (const p of patterns) {
    const m = text.match(p);
    if (m) return m[0].trim().replace(/\s+/g, " ");
  }
  return null;
}

/**
 * Extract borrower entity name. Looks for "Borrower Name & Address" block.
 */
function extractBorrowerName(text: string): string | null {
  const patterns = [
    /borrower\s+name\s*(?:&\s*address)?[:\s]+([A-Z][A-Za-z0-9\s,\.]+(?:LLC|LP|LLP|Inc|Corp|P\.C\.|PC|Trust)?)/i,
    /loan\s+to[:\s]+([A-Z][A-Za-z0-9\s,\.]+(?:LLC|LP|LLP|Inc|Corp|P\.C\.|PC|Trust)?)/i,
  ];
  for (const p of patterns) {
    const m = text.match(p);
    if (m?.[1]?.trim()) return m[1].trim();
  }
  return null;
}

/**
 * Detect loan program: SBA 504, SBA 7(a), or conventional.
 */
function detectLoanProgram(text: string): string {
  if (/SBA\s+504|504\s+program/i.test(text)) return "SBA_504";
  if (/SBA\s+7\s*\(?\s*a\s*\)?|7a\s+loan/i.test(text)) return "SBA_7A";
  if (/SBA/i.test(text)) return "SBA_OTHER";
  return "CONVENTIONAL";
}

/**
 * Extract LTV as decimal. Handles "90%", "50%", "LTV: 90%".
 */
function extractLtv(text: string): number | null {
  const patterns = [
    /LTV[:\s]*(\d{1,3}(?:\.\d+)?)\s*%/i,
    /loan[\s-]to[\s-]value[:\s]*(\d{1,3}(?:\.\d+)?)\s*%/i,
  ];
  for (const p of patterns) {
    const m = text.match(p);
    if (m) {
      const n = parseFloat(m[1]);
      return isNaN(n) ? null : n / 100;
    }
  }
  return null;
}

/**
 * Extract DSCR value as stated in memo (e.g. "DSCR of 1.63x").
 */
function extractDscr(text: string): number | null {
  const patterns = [
    /DSCR\s+(?:of\s+)?(\d+\.\d+)\s*x?/i,
    /debt\s+service\s+coverage[^:]*:\s*(\d+\.\d+)/i,
    /coverage\s+ratio[^:]*:\s*(\d+\.\d+)/i,
  ];
  for (const p of patterns) {
    const m = text.match(p);
    if (m) {
      const n = parseFloat(m[1]);
      return isNaN(n) ? null : n;
    }
  }
  return null;
}

/**
 * Extract collateral address. Looks for suite/address patterns.
 */
function extractCollateralAddress(text: string): string | null {
  const patterns = [
    /collateral[^:]*:\s*([0-9]+[A-Za-z0-9\s,\.#]+(?:Lane|Drive|Street|Ave|Blvd|Road|Rd|Dr|Ln|St|Ct|Way|Pl)[^,\n]*(?:,\s*[A-Za-z\s]+,?\s*[A-Z]{2}\s*\d{5})?)/i,
    /secured\s+by[^:]*:\s*([0-9]+[A-Za-z0-9\s,\.#]+(?:Lane|Drive|Street|Ave|Blvd|Road|Rd|Dr|Ln|St|Ct|Way|Pl)[^,\n]*(?:,\s*[A-Za-z\s]+,?\s*[A-Z]{2}\s*\d{5})?)/i,
    /(\d{3,5}\s+[A-Za-z0-9\s]+(?:Lane|Drive|Street|Ave|Blvd|Road|Rd|Dr|Ln|St|Ct|Way|Pl)[^,\n]*,\s*[A-Za-z\s]+,\s*[A-Z]{2}\s*\d{5})/i,
  ];
  for (const p of patterns) {
    const m = text.match(p);
    if (m?.[1]?.trim()) return m[1].trim();
  }
  return null;
}

interface LoanTerms {
  amount: number | null;
  rate: number | null;
  termYears: number | null;
  annualDs: number | null;
}

/**
 * Extract terms for up to 2 loan tranches.
 * Handles SBA 504 structures with bank first mortgage + CDC second.
 *
 * Patterns:
 *   "Loan Amount $625,000 ... Rate 7.10% ... Annual Payment $57,394"
 *   "Term Loan 1 / Term Loan 2" blocks
 */
function extractLoanTranches(text: string): [LoanTerms, LoanTerms] {
  const tranche1: LoanTerms = { amount: null, rate: null, termYears: null, annualDs: null };
  const tranche2: LoanTerms = { amount: null, rate: null, termYears: null, annualDs: null };

  // Try to find the payment calculation table rows
  // "Loan Amount $612,149 ... Term 20 ... Rate 7.10% ... Annual Payment $57,394"
  // Then "Loan Amount $500,000 ... Term 25 ... Rate 6.25% ... Annual Payment $39,580"
  const loanBlocks = text.match(
    /Loan\s+Amount\s+\$([\d,]+).*?(?:Term\s+(\d+))?.*?Rate\s+([\d.]+)%.*?Annual\s+Payment\s+\$([\d,]+)/gi,
  );

  if (loanBlocks && loanBlocks.length >= 1) {
    const parseBlock = (block: string): LoanTerms => {
      const amt = (block.match(/Loan\s+Amount\s+\$([\d,]+)/i) ?? [])[1];
      const term = (block.match(/Term\s+(\d+)/i) ?? [])[1];
      const rate = (block.match(/Rate\s+([\d.]+)%/i) ?? [])[1];
      const ds = (block.match(/Annual\s+Payment\s+\$([\d,]+)/i) ?? [])[1];
      return {
        amount: amt ? parseMoneyStr(amt) : null,
        rate: rate ? parseRateStr(rate) : null,
        termYears: term ? parseInt(term) : null,
        annualDs: ds ? parseMoneyStr(ds) : null,
      };
    };
    Object.assign(tranche1, parseBlock(loanBlocks[0]));
    if (loanBlocks.length >= 2) Object.assign(tranche2, parseBlock(loanBlocks[1]));
  }

  // Fallback: "New Money: $1,101,867" style single loan amount
  if (tranche1.amount === null) {
    const nm = text.match(/(?:new\s+money|loan\s+amount|total\s+loan)[:\s]+\$([\d,]+)/i);
    if (nm) tranche1.amount = parseMoneyStr(nm[1]);
  }

  // Fallback: "Rate: 7.1% & 6.25%" dual-rate line
  if (tranche1.rate === null || tranche2.rate === null) {
    const dualRate = text.match(/Rate[:\s]+([\d.]+)%\s*&\s*([\d.]+)%/i);
    if (dualRate) {
      tranche1.rate = parseRateStr(dualRate[1]);
      tranche2.rate = parseRateStr(dualRate[2]);
    }
  }

  // Fallback: "annual payment of $93,060" combined
  // and "Est. Payment Amount: $4,457 & $3,298 Total $7,755"
  // Compute annualDs from monthly if missing
  if (tranche1.annualDs === null) {
    const monthly = text.match(/(?:est\.?\s*payment|monthly\s+payment)[:\s]+\$([\d,]+)[^&\n]*(?:&\s*\$([\d,]+))?/i);
    if (monthly?.[1]) {
      const m1 = parseMoneyStr(monthly[1]);
      if (m1) tranche1.annualDs = m1 * 12;
      if (monthly?.[2]) {
        const m2 = parseMoneyStr(monthly[2]);
        if (m2) tranche2.annualDs = m2 * 12;
      }
    }
  }

  return [tranche1, tranche2];
}

// ---------------------------------------------------------------------------
// Main extractor
// ---------------------------------------------------------------------------

export async function extractCreditMemoDeterministic(
  args: ExtractArgs,
): Promise<ExtractResult> {
  const { dealId, bankId, documentId, ocrText } = args;
  let factsWritten = 0;

  const writes: Promise<{ ok: boolean }>[] = [];

  const writeFact = (
    factKey: string,
    factValueNum: number | null,
    factValueText?: string | null,
    confidence = 0.85,
  ) => {
    writes.push(
      upsertDealFinancialFact({
        dealId,
        bankId,
        sourceDocumentId: documentId,
        factType: "CREDIT_MEMO",
        factKey,
        factValueNum,
        factValueText: factValueText ?? null,
        confidence,
        provenance: {
          source_type: "DOC_EXTRACT",
          source_ref: `deal_documents:${documentId}`,
          as_of_date: null,
          extractor: "creditMemoExtractor:v1:deterministic",
        },
      }),
    );
  };

  // --- Lender / borrower ---
  const lenderName = extractLenderName(ocrText);
  if (lenderName) writeFact("PRIOR_LENDER_NAME", null, lenderName, 0.9);

  const borrowerName = extractBorrowerName(ocrText);
  if (borrowerName) writeFact("PRIOR_BORROWER_NAME", null, borrowerName, 0.87);

  // --- Existing relationship flag ---
  // If "OLD GLORY BANK" is the lender in the memo, mark as existing OGB relationship
  const isOgbLender = /OLD\s+GLORY\s+BANK|OGB/i.test(ocrText);
  writeFact("EXISTING_RELATIONSHIP", null, isOgbLender ? "true" : "false", 0.88);

  // --- Loan program ---
  const program = detectLoanProgram(ocrText);
  writeFact("PRIOR_LOAN_PROGRAM", null, program, 0.87);

  // --- LTV ---
  const ltv = extractLtv(ocrText);
  if (ltv !== null) writeFact("PRIOR_LTV", ltv, null, 0.88);

  // --- DSCR as stated ---
  const dscr = extractDscr(ocrText);
  if (dscr !== null) writeFact("PRIOR_DSCR", dscr, null, 0.87);

  // --- Collateral address ---
  const collateralAddr = extractCollateralAddress(ocrText);
  if (collateralAddr) writeFact("PRIOR_COLLATERAL_ADDRESS", null, collateralAddr, 0.83);

  // --- Loan purpose ---
  const purposeMatch = ocrText.match(
    /purpose\s+of\s+loan[:\s]+([^\n]{5,120})/i,
  );
  if (purposeMatch?.[1]) writeFact("PRIOR_LOAN_PURPOSE", null, purposeMatch[1].trim(), 0.85);

  // --- Loan tranches (the critical debt service facts) ---
  const [t1, t2] = extractLoanTranches(ocrText);

  if (t1.amount !== null) writeFact("PRIOR_LOAN_AMOUNT_1", t1.amount, null, 0.88);
  if (t1.rate !== null) writeFact("PRIOR_LOAN_RATE_1", t1.rate, null, 0.88);
  if (t1.termYears !== null) writeFact("PRIOR_LOAN_TERM_1", t1.termYears, null, 0.85);
  if (t1.annualDs !== null) writeFact("PRIOR_ANNUAL_DS_1", t1.annualDs, null, 0.88);

  if (t2.amount !== null) writeFact("PRIOR_LOAN_AMOUNT_2", t2.amount, null, 0.87);
  if (t2.rate !== null) writeFact("PRIOR_LOAN_RATE_2", t2.rate, null, 0.87);
  if (t2.termYears !== null) writeFact("PRIOR_LOAN_TERM_2", t2.termYears, null, 0.85);
  if (t2.annualDs !== null) writeFact("PRIOR_ANNUAL_DS_2", t2.annualDs, null, 0.87);

  // --- Total combined annual debt service (the single most important fact) ---
  // Computed from tranches if available, else extracted from memo text
  const ds1 = t1.annualDs ?? 0;
  const ds2 = t2.annualDs ?? 0;
  const totalDs = ds1 + ds2;

  if (totalDs > 0) {
    writeFact("PRIOR_TOTAL_ANNUAL_DS", totalDs, null, 0.88);
  } else {
    // Fallback: "total monthly payment is $7,755 with annual payment of $93,060"
    const totalDsMatch = ocrText.match(
      /(?:total\s+annual\s+payment|annual\s+(?:debt\s+service|payment))[^\$]*\$([\d,]+)/i,
    );
    if (totalDsMatch) {
      const ds = parseMoneyStr(totalDsMatch[1]);
      if (ds !== null) writeFact("PRIOR_TOTAL_ANNUAL_DS", ds, null, 0.86);
    }
  }

  // Execute all writes
  const results = await Promise.all(writes);
  for (const r of results) {
    if (r.ok) factsWritten += 1;
  }

  return { factsWritten, extractionPath: "credit_memo_deterministic:v1" };
}
