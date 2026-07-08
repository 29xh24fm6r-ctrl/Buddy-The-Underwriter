/**
 * SPEC-TIER5-FINANCIAL-DEFINITION-UNIFICATION-1 — classic-spread EBITDA, reconciled to canonical.
 *
 * The classic spread previously computed EBITDA as NET_INCOME + interest + D&A. For a C-corp (Form
 * 1120), NET_INCOME is AFTER tax, so that omitted the income-tax add-back the canonical EBITDA engine
 * applies — the printed PDF/classic EBITDA disagreed with the canonical fact and the /financials panel
 * for the same period/entity. This helper routes the classic EBITDA base through the SAME canonical
 * resolver (resolveEbitdaBaseIncome: OBI → pre-tax TAXABLE_INCOME/M1 → NET_INCOME + tax provision),
 * then adds the traditional interest + depreciation + amortization add-backs. With no §179/non-recurring
 * facts (which the classic spread intentionally does not apply) this equals computeEbitda's output, so
 * canonical EBITDA and rendered EBITDA reconcile for the same period/entity.
 *
 * Pure — no DB, safe for both the server-only loader and the pure ratios module.
 */

import { resolveEbitdaBaseIncome } from "@/lib/financialIntelligence/ebitdaBase";

/** Fact keys the canonical base resolver reads (C-corp tax reconstruction). */
const EBITDA_BASE_KEYS = [
  "ORDINARY_BUSINESS_INCOME",
  "TAXABLE_INCOME",
  "M1_TAXABLE_INCOME",
  "NET_INCOME",
  "TOTAL_TAX",
  "M1_FEDERAL_TAX_BOOK",
] as const;

/**
 * Traditional EBITDA (pre-tax base + interest + depreciation + amortization), consistent with the
 * canonical EBITDA base resolver's C-corp income-tax treatment.
 *
 * @param get - resolves a fact value by canonical fact key for the period/entity (null when absent).
 * @returns EBITDA, or null when the base income is unavailable.
 */
export function classicTraditionalEbitda(get: (key: string) => number | null): number | null {
  const facts: Record<string, number | null> = {};
  for (const k of EBITDA_BASE_KEYS) facts[k] = get(k);

  const base = resolveEbitdaBaseIncome(facts);
  if (base.baseValue == null) return null;

  // Reconstruct the PRE-TAX base (adds the C-corp tax provision back when the base fell through to
  // after-tax NET_INCOME) — identical to computeEbitda's base handling.
  const preTaxBase = base.baseValue + (base.taxAddBack?.value ?? 0);

  const interest = get("INTEREST_EXPENSE") ?? 0;
  const depreciation = get("DEPRECIATION") ?? 0;
  const amortization = get("AMORTIZATION") ?? 0;
  return preTaxBase + interest + depreciation + amortization;
}
