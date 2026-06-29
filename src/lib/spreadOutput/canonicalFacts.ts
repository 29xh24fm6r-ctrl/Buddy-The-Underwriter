/**
 * SPEC-SPREAD-ENTITY-SCOPING-1 — pure canonical-fact flattening + derivation.
 *
 * Extracted verbatim from the spread-output route's loadCanonicalFacts so the
 * route and tests share one policy (principle #17). The ONLY behavioral addition
 * is the source guard: a PERSONAL_TAX_RETURN (guarantor) fact may never populate
 * or overwrite a business-operating-entity cell. This also makes the
 * GROSS_RECEIPTS ← TOTAL_INCOME alias safe (a personal TOTAL_INCOME can no longer
 * be in the namespace), so the alias chain is left as-is.
 *
 * Output contract is UNCHANGED: flat `{FACT_KEY}_{year}` map + sorted years.
 *
 * SPEC-EBITDA-BASE-INCOME-WIRE-1: the EBITDA derivation now uses the shared
 * resolveEbitdaBaseIncome resolver for base-income selection (adds the
 * M1_TAXABLE_INCOME / TAXABLE_INCOME fallback the inline path lacked) and writes
 * EBITDA_BASE_{year} so the spread row can show the resolved base.
 */

import { resolveEbitdaBaseIncome } from "@/lib/financialIntelligence/ebitdaBase";

export type CanonicalFactRow = {
  fact_key: string;
  fact_value_num: number | null;
  fact_value_text: string | null;
  fact_period_end: string | null;
  source_canonical_type: string | null;
};

// Sources that represent the business operating entity.
const BUSINESS_SOURCES = new Set([
  "BUSINESS_TAX_RETURN",
  "INCOME_STATEMENT",
  "BALANCE_SHEET",
]);

// Business operating-entity P&L / balance-sheet keys that a PERSONAL return
// (guarantor) fact must never populate or overwrite.
const BUSINESS_OWNED_KEYS = new Set([
  "GROSS_RECEIPTS", "TOTAL_REVENUE", "TOTAL_INCOME", "NET_INCOME",
  "ORDINARY_BUSINESS_INCOME", "OPERATING_INCOME", "NET_OPERATING_INCOME",
  "GROSS_PROFIT", "COGS", "COST_OF_GOODS_SOLD",
  "OFFICER_COMPENSATION", "SALARIES_WAGES", "SALARIES_WAGES_IS",
  "RENT_EXPENSE", "RENT_EXPENSE_IS", "DEPRECIATION", "INTEREST_EXPENSE",
  "EBITDA", "TOTAL_OPERATING_EXPENSES", "TOTAL_DEDUCTIONS",
  "M1_BOOK_INCOME", "M1_TAXABLE_INCOME", "M2_NET_INCOME",
]);

export function buildCanonicalFactsFromRows(
  rows: CanonicalFactRow[],
): { facts: Record<string, unknown>; years: number[] } {
  const facts: Record<string, unknown> = {};
  const yearsSet = new Set<number>();

  // PFS facts use a statement date (e.g. 2026-01-01), not a fiscal year-end.
  // They must not create spread columns.
  const PFS_KEY_PREFIXES = ["PFS_", "PERSONAL_FINANCIAL_STATEMENT"];

  function toNum(val: unknown): number | null {
    if (val === null || val === undefined) return null;
    const n = Number(val);
    return isFinite(n) ? n : null;
  }

  for (const row of rows) {
    const value = row.fact_value_num ?? row.fact_value_text ?? null;

    // SPEC-SPREAD-ENTITY-SCOPING-1: bar personal/other-source facts from
    // occupying a business-owned cell. Kills personal→business contamination.
    const src = row.source_canonical_type ?? "";
    const isBusinessSource = BUSINESS_SOURCES.has(src);
    if (!isBusinessSource && BUSINESS_OWNED_KEYS.has(row.fact_key)) {
      continue;
    }

    if (row.fact_period_end) {
      const year = new Date(row.fact_period_end).getFullYear();
      const isPfsKey = PFS_KEY_PREFIXES.some((p) => row.fact_key.startsWith(p));
      if (!isPfsKey && year >= 2000 && year <= 2100) {
        yearsSet.add(year);
      }
      if (year >= 2000 && year <= 2100) {
        facts[`${row.fact_key}_${year}`] = value;
      }
    }
  }

  // Revenue aliasing: income statements often extract as TOTAL_REVENUE,
  // but the spread template uses GROSS_RECEIPTS. Alias if missing.
  for (const year of Array.from(yearsSet)) {
    const grKey = `GROSS_RECEIPTS_${year}`;
    if (facts[grKey] == null) {
      const alias =
        toNum(facts[`TOTAL_REVENUE_${year}`]) ??
        toNum(facts[`TOTAL_INCOME_${year}`]);
      if (alias !== null) facts[grKey] = alias;
    }
  }

  // COGS aliasing: extractor writes COST_OF_GOODS_SOLD; template uses COGS
  for (const year of Array.from(yearsSet)) {
    const cogsKey = `COGS_${year}`;
    if (facts[cogsKey] == null) {
      const alias = toNum(facts[`COST_OF_GOODS_SOLD_${year}`]);
      if (alias !== null) facts[cogsKey] = alias;
    }
  }

  // Taxes aliasing: template uses TAXES; extractors write TAX_LIABILITY or TAXES_LICENSES
  for (const year of Array.from(yearsSet)) {
    const taxKey = `TAXES_${year}`;
    if (facts[taxKey] == null) {
      const alias =
        toNum(facts[`TAX_LIABILITY_${year}`]) ??
        toNum(facts[`TAXES_LICENSES_${year}`]) ??
        toNum(facts[`INCOME_TAX_EXPENSE_${year}`]) ??
        toNum(facts[`TAX_PROVISION_${year}`]);
      if (alias !== null) facts[taxKey] = alias;
    }
  }

  // Interest expense aliasing: handles alternate keys from different form types
  for (const year of Array.from(yearsSet)) {
    const ieKey = `INTEREST_EXPENSE_${year}`;
    if (facts[ieKey] == null) {
      const alias =
        toNum(facts[`DEBT_SERVICE_${year}`]) ??
        toNum(facts[`INTEREST_ON_BUSINESS_INDEBTEDNESS_${year}`]) ??
        toNum(facts[`INTEREST_PAID_${year}`]);
      if (alias !== null) facts[ieKey] = alias;
    }
  }

  // Gross Profit derivation: derive if not stored
  for (const year of Array.from(yearsSet)) {
    const gpKey = `GROSS_PROFIT_${year}`;
    if (facts[gpKey] == null) {
      const rev = toNum(facts[`GROSS_RECEIPTS_${year}`]);
      const cogs = toNum(facts[`COGS_${year}`]) ?? toNum(facts[`COST_OF_GOODS_SOLD_${year}`]);
      if (rev !== null) {
        facts[gpKey] = rev - (cogs ?? 0);
      }
    }
  }

  // TOTAL_OPERATING_EXPENSES derivation for BTR-only years.
  // For partnership/S-corp returns without a standalone IS:
  //   TOTAL_DEDUCTIONS (IRS line 22) = total operating expenses
  //   Fallback: GROSS_PROFIT - ORDINARY_BUSINESS_INCOME when TOTAL_DEDUCTIONS absent
  for (const year of Array.from(yearsSet)) {
    const totalOpExKey = `TOTAL_OPERATING_EXPENSES_${year}`;
    if (facts[totalOpExKey] == null) {
      const totalDeductions = toNum(facts[`TOTAL_DEDUCTIONS_${year}`]);
      if (totalDeductions !== null) {
        facts[totalOpExKey] = totalDeductions;
      } else {
        const gp = toNum(facts[`GROSS_PROFIT_${year}`]);
        const obi =
          toNum(facts[`ORDINARY_BUSINESS_INCOME_${year}`]) ??
          toNum(facts[`NET_INCOME_${year}`]);
        if (gp !== null && obi !== null) {
          facts[totalOpExKey] = gp - obi;
        }
      }
    }
  }

  // OPERATING_INCOME derivation: alias ORDINARY_BUSINESS_INCOME for BTR years.
  // OPERATING_INCOME is a completeness-checked key. For BTR-only deals it is never
  // extracted as a standalone fact — OBI is the nearest equivalent.
  for (const year of Array.from(yearsSet)) {
    const opIncomeKey = `OPERATING_INCOME_${year}`;
    if (facts[opIncomeKey] == null) {
      const obi =
        toNum(facts[`ORDINARY_BUSINESS_INCOME_${year}`]) ??
        toNum(facts[`NET_INCOME_${year}`]);
      if (obi !== null) facts[opIncomeKey] = obi;
    }
  }

  // Net Operating Profit derivation: GP - Total OpEx
  for (const year of Array.from(yearsSet)) {
    const nopKey = `NET_OPERATING_PROFIT_${year}`;
    if (facts[nopKey] == null) {
      const grossProfit = toNum(facts[`GROSS_PROFIT_${year}`]);
      const totalOpEx =
        toNum(facts[`TOTAL_OPERATING_EXPENSES_${year}`]) ??
        toNum(facts[`TOTAL_DEDUCTIONS_${year}`]);
      if (grossProfit !== null && totalOpEx !== null) {
        facts[nopKey] = grossProfit - totalOpEx;
      }
    }
  }

  // EBITDA derivation: not stored as a fact — derive per year.
  // Base income via the shared industry-standard resolver
  // (ORDINARY_BUSINESS_INCOME → TAXABLE_INCOME → M1_TAXABLE_INCOME → NET_INCOME),
  // then + DEPRECIATION + INTEREST_EXPENSE + SK_SECTION_179_DEDUCTION.
  for (const year of Array.from(yearsSet)) {
    const ebitdaKey = `EBITDA_${year}`;
    if (facts[ebitdaKey] == null) {
      const base = resolveEbitdaBaseIncome({
        ORDINARY_BUSINESS_INCOME: toNum(facts[`ORDINARY_BUSINESS_INCOME_${year}`]),
        TAXABLE_INCOME: toNum(facts[`TAXABLE_INCOME_${year}`]),
        M1_TAXABLE_INCOME: toNum(facts[`M1_TAXABLE_INCOME_${year}`]),
        NET_INCOME: toNum(facts[`NET_INCOME_${year}`]),
        TOTAL_TAX: toNum(facts[`TOTAL_TAX_${year}`]),
        M1_FEDERAL_TAX_BOOK: toNum(facts[`M1_FEDERAL_TAX_BOOK_${year}`]),
      });
      const dep  = toNum(facts[`DEPRECIATION_${year}`]) ?? 0;
      const ie   = toNum(facts[`INTEREST_EXPENSE_${year}`]) ?? 0;
      const s179 = toNum(facts[`SK_SECTION_179_DEDUCTION_${year}`]) ?? 0;
      if (base.baseValue !== null) {
        // Resolved base income drives the "Net Income / OBI" display row.
        facts[`EBITDA_BASE_${year}`] = base.baseValue;
        // EBITDA reconstructs the pre-tax figure (base + tax add-back when present).
        const ebitdaBase = base.baseValue + (base.taxAddBack?.value ?? 0);
        facts[ebitdaKey] = ebitdaBase + dep + ie + s179;
      }
    }
  }

  // cf_ncads derivation: EBITDA as simplified NCADS (Phase 1)
  // QoE and owner add-backs are $0 until QoE engine runs
  for (const year of Array.from(yearsSet)) {
    const ncadsKey = `cf_ncads_${year}`;
    if (facts[ncadsKey] == null) {
      const alias = toNum(facts[`CASH_FLOW_AVAILABLE_${year}`]);
      if (alias !== null) {
        facts[ncadsKey] = alias;
      } else {
        // Fallback: use EBITDA as simplified NCADS
        const ebitda = toNum(facts[`EBITDA_${year}`]);
        const rental = toNum(facts[`RENTAL_INCOME_SCHED_E_${year}`]) ?? 0;
        if (ebitda !== null) facts[ncadsKey] = ebitda + rental;
      }
    }
  }

  // cf_ebitda_adjusted: EBITDA + QoE adjustments (seed as EBITDA base)
  for (const year of Array.from(yearsSet)) {
    const adjKey = `cf_ebitda_adjusted_${year}`;
    if (facts[adjKey] == null) {
      const ebitda = toNum(facts[`EBITDA_${year}`]);
      if (ebitda !== null) facts[adjKey] = ebitda;
    }
  }

  // PFS bare-key aliasing: map PFS_*_year facts to bare keys used by collateral/narrative generators
  const pfsNetWorthKey = Object.keys(facts).filter((k) => k.startsWith("PFS_NET_WORTH_")).sort().pop();
  if (pfsNetWorthKey) {
    const pfsYear = parseInt(pfsNetWorthKey.replace("PFS_NET_WORTH_", ""), 10);
    if (!isNaN(pfsYear)) {
      const pfsAliasMap: Record<string, string> = {
        [`PFS_NET_WORTH_${pfsYear}`]:          "personal_net_worth",
        [`PFS_LIQUID_ASSETS_${pfsYear}`]:       "personal_liquidity",
        [`PFS_TOTAL_ASSETS_${pfsYear}`]:        "personal_total_assets",
        [`PFS_TOTAL_LIABILITIES_${pfsYear}`]:   "personal_total_liabilities",
        [`PFS_REAL_ESTATE_MV_${pfsYear}`]:      "personal_real_estate_value",
        [`PFS_MORTGAGE_BALANCE_${pfsYear}`]:    "personal_mortgage_balance",
        [`PFS_STOCKS_BONDS_${pfsYear}`]:        "personal_stocks_bonds",
        [`PFS_TOTAL_ANNUAL_INCOME_${pfsYear}`]: "personal_annual_income",
        [`PFS_REAL_ESTATE_INCOME_${pfsYear}`]:  "personal_real_estate_income",
      };
      for (const [src, dest] of Object.entries(pfsAliasMap)) {
        if (facts[src] != null && facts[dest] == null) facts[dest] = facts[src];
      }
    }
  }

  // ── Derive CURRENT_ASSETS from SL_ components (for Current Ratio + Working Capital) ──
  // Intelligence tab reads CURRENT_ASSETS / CURRENT_LIABILITIES bare keys.
  // These never exist as direct facts — must be derived from SL_ balance sheet components.
  for (const year of Array.from(yearsSet)) {
    const caKey = `CURRENT_ASSETS_${year}`;
    if (facts[caKey] == null) {
      const cash = toNum(facts[`SL_CASH_${year}`]);
      const arGross = toNum(facts[`SL_AR_GROSS_${year}`]);
      const arAllow = toNum(facts[`SL_AR_ALLOWANCE_${year}`]) ?? 0;
      const netAr = arGross != null ? arGross - arAllow : null;
      const inventory = toNum(facts[`SL_INVENTORY_${year}`]);
      const usGov = toNum(facts[`SL_US_GOV_OBLIGATIONS_${year}`]);
      const taxExempt = toNum(facts[`SL_TAX_EXEMPT_SECURITIES_${year}`]);
      const otherCA = toNum(facts[`SL_OTHER_CURRENT_ASSETS_${year}`]);
      // Also check direct SL_ materialized value
      const directTCA = toNum(facts[`SL_TOTAL_CURRENT_ASSETS_${year}`]);
      if (directTCA != null) {
        facts[caKey] = directTCA;
      } else {
        const components = [cash, netAr, inventory, usGov, taxExempt, otherCA].filter(
          (v): v is number => v != null,
        );
        if (components.length > 0) {
          facts[caKey] = components.reduce((a, b) => a + b, 0);
        }
      }
    }
  }

  // ── Derive CURRENT_LIABILITIES from SL_ components ──
  for (const year of Array.from(yearsSet)) {
    const clKey = `CURRENT_LIABILITIES_${year}`;
    if (facts[clKey] == null) {
      const directTCL = toNum(facts[`SL_TOTAL_CURRENT_LIABILITIES_${year}`]);
      if (directTCL != null) {
        facts[clKey] = directTCL;
      } else {
        const ap = toNum(facts[`SL_ACCOUNTS_PAYABLE_${year}`]);
        const wages = toNum(facts[`SL_WAGES_PAYABLE_${year}`]);
        const stDebt = toNum(facts[`SL_SHORT_TERM_DEBT_${year}`]);
        const operCL = toNum(facts[`SL_OPERATING_CURRENT_LIABILITIES_${year}`]);
        const components = [ap, wages, stDebt, operCL].filter(
          (v): v is number => v != null,
        );
        if (components.length > 0) {
          facts[clKey] = components.reduce((a, b) => a + b, 0);
        }
      }
    }
  }

  return { facts, years: Array.from(yearsSet).sort((a, b) => a - b) };
}
