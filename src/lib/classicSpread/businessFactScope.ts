/**
 * SPEC-CLASSIC-SPREAD-SYSTEM-HARDENING-AUDIT-2 #2 — business vs personal fact scoping (pure).
 *
 * The business balance sheet / income statement / ratios / cash flow may consume ONLY business
 * statement facts. Personal-return facts — even when written under owner_type=DEAL (e.g. OmniCare's
 * PERSONAL_TAX_RETURN-sourced TOTAL_INCOME) — must never feed business revenue/totals; they belong
 * to the Personal Income and GCF sponsor sections. Null canonical types are kept (legacy business
 * facts) to avoid over-restricting established deals.
 */

export const PERSONAL_CANONICAL_TYPES = new Set([
  "PERSONAL_TAX_RETURN",
  "PERSONAL_FINANCIAL_STATEMENT",
  "PFS",
  "FORM_1040",
]);

export type ScopableFact = {
  owner_type?: string | null;
  source_canonical_type?: string | null;
};

export function isBusinessStatementFact(f: ScopableFact): boolean {
  if (f.owner_type === "PERSONAL") return false;
  if (f.source_canonical_type && PERSONAL_CANONICAL_TYPES.has(f.source_canonical_type)) return false;
  return true;
}
