import type { SpreadType } from "@/lib/financialSpreads/types";

/**
 * Canonical mapping from document type → spread types that should be recomputed.
 * Single source of truth — replaces duplicates in classifyProcessor, processArtifact, re-extract.
 */
export function spreadsForDocType(docTypeRaw: string): SpreadType[] {
  const dt = String(docTypeRaw || "").trim().toUpperCase();
  if (!dt) return [];

  if (["FINANCIAL_STATEMENT", "T12", "INCOME_STATEMENT", "TRAILING_12", "OPERATING_STATEMENT"].includes(dt)) return ["T12"];
  if (dt === "BALANCE_SHEET") return ["BALANCE_SHEET"];
  if (dt === "RENT_ROLL") return ["RENT_ROLL"];
  if (["IRS_1065", "IRS_1120", "IRS_1120S", "IRS_BUSINESS", "K1", "BUSINESS_TAX_RETURN", "TAX_RETURN"].includes(dt)) return ["T12", "GLOBAL_CASH_FLOW"];
  if (["IRS_1040", "IRS_PERSONAL", "PERSONAL_TAX_RETURN"].includes(dt)) return ["PERSONAL_INCOME", "GLOBAL_CASH_FLOW"];
  if (["PFS", "PERSONAL_FINANCIAL_STATEMENT", "SBA_413"].includes(dt)) return ["PERSONAL_FINANCIAL_STATEMENT", "GLOBAL_CASH_FLOW"];

  return [];
}
