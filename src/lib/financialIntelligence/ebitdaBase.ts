/**
 * Financial Intelligence Layer — EBITDA base-income resolver.
 *
 * SPEC-EBITDA-BASE-INCOME-WIRE-1: the industry-standard base-income selection
 * ladder, extracted VERBATIM from computeEbitda so the canonical EBITDA engine
 * and the live financials spread share one policy (principle #17).
 *
 * Commercial/SBA underwriting spreads the tax return, not the books: the base
 * income line is entity-appropriate — ORDINARY_BUSINESS_INCOME (1120S/1065) or
 * pre-NOL TAXABLE_INCOME (1120 line 28 ≈ Schedule M-1 line 10) — then
 * depreciation, interest, and amortization are added back to reach cash flow.
 *
 * Pure function — no DB, no server-only.
 */

export type EbitdaBaseKey =
  | "ORDINARY_BUSINESS_INCOME"
  | "TAXABLE_INCOME"
  | "M1_TAXABLE_INCOME"
  | "NET_INCOME"
  | null;

export type EbitdaBaseResult = {
  baseKey: EbitdaBaseKey;
  baseLabel: string;
  baseValue: number | null;
  /**
   * When the base falls through to after-tax NET_INCOME and a tax provision is
   * available, the provision is added back to reconstruct the pre-tax base.
   * `key` records which fact the provision came from.
   */
  taxAddBack: { value: number; key: "TOTAL_TAX" | "M1_FEDERAL_TAX_BOOK" } | null;
  warning: string | null;
};

type FactMap = Record<string, number | null>;

function val(facts: FactMap, key: string): number | null {
  const v = facts[key];
  return v === undefined ? null : v;
}

/**
 * SPEC-CANONICAL-DSCR-NCADS-PERFECTION-PROGRAM-1 Phase 1: EBITDA base selection.
 * Pass-throughs (1120S/1065) report ORDINARY_BUSINESS_INCOME. C-corps (Form 1120)
 * do NOT — they report pre-tax TAXABLE_INCOME (line 30; tax is line 31). Since
 * EBITDA is a pre-tax figure (base + interest + D&A), TAXABLE_INCOME is the correct
 * C-corp base with NO tax add-back — symmetric with the pass-through path. Only if
 * TAXABLE_INCOME is absent do we reconstruct from after-tax NET_INCOME by adding the
 * tax provision back.
 */
export function resolveEbitdaBaseIncome(facts: FactMap): EbitdaBaseResult {
  const reportedOBI = val(facts, "ORDINARY_BUSINESS_INCOME");
  let baseKey: EbitdaBaseKey = reportedOBI !== null ? "ORDINARY_BUSINESS_INCOME" : null;
  let baseLabel = "OBI";
  let baseValue: number | null = reportedOBI;
  let taxAddBack: EbitdaBaseResult["taxAddBack"] = null;
  let warning: string | null = null;

  if (reportedOBI === null) {
    const taxable = val(facts, "TAXABLE_INCOME");
    // Schedule M-1 "income per return" reconciles book income to taxable income —
    // it IS pre-tax taxable income (same basis as line-30 TAXABLE_INCOME). When the
    // plain TAXABLE_INCOME line was not extracted but the M-1 bridge was, M1 is the
    // correct pre-tax base. Without it, a C-corp with only M1 falls through to
    // after-tax NET_INCOME and EBITDA is silently understated by the full pre-tax
    // income (SPEC-FINENGINE-LIVE-SPREAD-1 Phase 3 finding: −$200,925 on OmniCare).
    const m1Taxable = val(facts, "M1_TAXABLE_INCOME");
    const netIncome = val(facts, "NET_INCOME");
    const totalTax = val(facts, "TOTAL_TAX");
    const taxProvision = totalTax ?? val(facts, "M1_FEDERAL_TAX_BOOK");
    if (taxable !== null) {
      baseKey = "TAXABLE_INCOME";
      baseLabel = "Taxable income (pre-tax)";
      baseValue = taxable;
    } else if (m1Taxable !== null) {
      baseKey = "M1_TAXABLE_INCOME";
      baseLabel = "Schedule M-1 taxable income (pre-tax)";
      baseValue = m1Taxable;
    } else if (netIncome !== null) {
      baseKey = "NET_INCOME";
      baseLabel = "Net income (after-tax, reconstructed to pre-tax)";
      baseValue = netIncome;
      if (taxProvision !== null && taxProvision !== 0) {
        taxAddBack = {
          value: taxProvision,
          key: totalTax !== null ? "TOTAL_TAX" : "M1_FEDERAL_TAX_BOOK",
        };
      } else {
        warning =
          "C-corp NET_INCOME used as the EBITDA base but no tax provision (TOTAL_TAX / M1_FEDERAL_TAX_BOOK) is available — EBITDA likely understates pre-tax earnings.";
      }
    } else {
      warning =
        "C-corp (Form 1120) EBITDA base unavailable — no ORDINARY_BUSINESS_INCOME, TAXABLE_INCOME, or NET_INCOME fact on file.";
    }
  }

  return { baseKey, baseLabel, baseValue, taxAddBack, warning };
}
