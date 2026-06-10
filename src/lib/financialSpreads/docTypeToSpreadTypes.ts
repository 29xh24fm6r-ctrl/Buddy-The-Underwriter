import type { SpreadType } from "@/lib/financialSpreads/types";

/**
 * Canonical mapping from document type → spread types that should be recomputed.
 * Single source of truth — replaces duplicates in classifyProcessor, processArtifact, re-extract.
 */
export function spreadsForDocType(docTypeRaw: string): SpreadType[] {
  const dt = String(docTypeRaw || "").trim().toUpperCase();
  if (!dt) return [];

  // SPEC-CREDIT-MEMO-NON-T12-FINANCIAL-PATH-INTEGRITY-1: T12 (trailing-twelve) is a
  // CRE/monthly-operating-statement spread — it must NOT be enqueued from annual
  // financial-statement or tax-return documents (which produced errored T12 spreads
  // and polluted the memo). Annual figures already materialize as canonical facts
  // via document EXTRACTION (not a spread), so:
  //   • operating/financial/income statements enqueue NO spread (facts → snapshot);
  //   • business tax returns drive only GLOBAL_CASH_FLOW (repayment support);
  //   • balance-sheet docs drive BALANCE_SHEET.
  // (STANDARD is intentionally NOT used — it has no render template and the
  // "no doc type maps to STANDARD" invariant forbids it.) RENT_ROLL deals still
  // drive the CRE/monthly path via RENT_ROLL.
  if (["FINANCIAL_STATEMENT", "INCOME_STATEMENT", "OPERATING_STATEMENT"].includes(dt)) return [];
  if (dt === "BALANCE_SHEET") return ["BALANCE_SHEET"];
  if (dt === "RENT_ROLL") return ["RENT_ROLL"];
  if (["IRS_1065", "IRS_1120", "IRS_1120S", "IRS_BUSINESS", "K1", "BUSINESS_TAX_RETURN", "TAX_RETURN"].includes(dt)) return ["GLOBAL_CASH_FLOW"];
  if (["IRS_1040", "IRS_PERSONAL", "PERSONAL_TAX_RETURN"].includes(dt)) return ["PERSONAL_INCOME", "GLOBAL_CASH_FLOW"];
  if (["PFS", "PERSONAL_FINANCIAL_STATEMENT", "SBA_413"].includes(dt)) return ["PERSONAL_FINANCIAL_STATEMENT", "GLOBAL_CASH_FLOW"];

  if (dt === "COMMERCIAL_LEASE") return ["RENT_ROLL"];
  // Credit memo facts feed GLOBAL_CASH_FLOW via PRIOR_TOTAL_ANNUAL_DS
  if (dt === "CREDIT_MEMO") return ["GLOBAL_CASH_FLOW"];

  return [];
}
