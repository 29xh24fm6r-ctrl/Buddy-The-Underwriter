/**
 * SPEC-CANONICAL-NCADS-WATERFALL-WIRING-1 (Step 1) — pure mapping from extracted
 * facts to the institutional cashFlowWaterfall input.
 *
 * Single-truth reuse:
 *   • EBITDA base = ebitdaEngine.computeEbitda base selection (PR-517): pre-tax
 *     ORDINARY_BUSINESS_INCOME (pass-through) or TAXABLE_INCOME (C-corp). The
 *     waterfall then re-adds D&A + interest to reach EBITDA, so we feed the PRE-TAX
 *     BASE (not adjustedEbitda) to avoid double-counting.
 *   • Owner-comp excess add-back = entityTaxForm.ownerCompTreatment (PR-518) — excess
 *     over replacement only, never 100%.
 *
 * No DB, no server imports. NCADS period selection prefers the most recent COMPLETE
 * fiscal year and never an interim/stub period.
 */

import type { MethodologySlate } from "@/lib/methodology/types";
import type { CashFlowWaterfallInput } from "@/lib/spreads/cashFlowWaterfall";
import { computeEbitda } from "@/lib/financialIntelligence/ebitdaEngine";
import {
  classifyEntityTaxForm,
  ownerCompTreatment,
  toEngineFormType,
  type EntityTaxForm,
} from "@/lib/financialIntelligence/entityTaxForm";

type FactMap = Record<string, number | null>;

/** A fact reduced to the fields needed for period selection. */
export type PeriodFact = { fact_key: string; fact_value_num: number | null; fact_period_end: string | null };

/** Annual income-base keys that mark a usable fiscal-year period. */
const BASE_INCOME_KEYS = ["ORDINARY_BUSINESS_INCOME", "TAXABLE_INCOME", "NET_INCOME"] as const;

/** A complete fiscal year ends on a calendar/fiscal year-end (month 12), not an interim quarter. */
function isFiscalYearEnd(periodEnd: string): boolean {
  // YYYY-12-31 (calendar) — interim stubs are -03-31 / -06-30 / -09-30.
  return /^\d{4}-12-31$/.test(periodEnd);
}

/**
 * Select the most recent COMPLETE fiscal-year period that carries an annual income
 * base fact. Interim periods (e.g. 2026-03-31 Q1) are excluded so canonical NCADS is
 * never derived from a stub quarter. Returns null when no complete FY is on file
 * (caller emits a labeled diagnostic — no fabricated precision).
 */
export function selectCompleteFiscalYearPeriod(facts: PeriodFact[]): string | null {
  const candidates = new Set<string>();
  for (const f of facts) {
    if (!f.fact_period_end || f.fact_value_num === null) continue;
    if (!isFiscalYearEnd(f.fact_period_end)) continue;
    if ((BASE_INCOME_KEYS as readonly string[]).includes(f.fact_key)) {
      candidates.add(f.fact_period_end);
    }
  }
  if (candidates.size === 0) return null;
  return [...candidates].sort().reverse()[0];
}

export type WaterfallInputBuild = {
  input: CashFlowWaterfallInput;
  form: EntityTaxForm;
  provenance: {
    base_key: string | null;
    base_value: number | null;
    noncash_addbacks: number | null;
    interest_addback: number | null;
    qoe_net: number | null;
    owner_benefit_excess_comp: number | null;
    owner_comp_note: string;
    tax_provision: number | null;
    maintenance_capex: number | null;
    is_pass_through: boolean;
    source_fact_keys: string[];
  };
};

const num = (m: FactMap, k: string): number | null => {
  const v = m[k];
  return v === undefined || v === null ? null : Number(v);
};

/**
 * Map a period's fact map to the waterfall input. DSCR is owned downstream
 * (computeTotalDebtService), so annualDebtServiceTotal is left null here — this
 * writer is responsible only for NCADS / CASH_FLOW_AVAILABLE.
 */
export function buildWaterfallInputFromFacts(
  factMap: FactMap,
  slate?: MethodologySlate,
): WaterfallInputBuild {
  const form = classifyEntityTaxForm(factMap);
  const ebitda = computeEbitda(factMap, toEngineFormType(form), slate);
  const comp = ownerCompTreatment(factMap, form, slate);

  const depreciation = num(factMap, "DEPRECIATION");
  const amortization = num(factMap, "AMORTIZATION");
  const sec179 = num(factMap, "SECTION_179_EXPENSE");
  const bonusDepr = num(factMap, "BONUS_DEPRECIATION");
  const interest = num(factMap, "INTEREST_EXPENSE");
  const nrIncome = num(factMap, "NON_RECURRING_INCOME");
  const nrExpense = num(factMap, "NON_RECURRING_EXPENSE");
  const taxProvision = form === "C_CORP" ? (num(factMap, "TOTAL_TAX") ?? num(factMap, "M1_FEDERAL_TAX_BOOK")) : null;
  const maintenanceCapex = num(factMap, "MAINTENANCE_CAPEX");
  const isPassThrough = form !== "C_CORP";

  const input: CashFlowWaterfallInput = {
    netIncomeBase: ebitda.baseValue,
    depreciation,
    amortization,
    sec179Normalized: sec179,
    bonusDepreciationNormalized: bonusDepr,
    interestExpense: interest,
    qoeNonRecurringIncomeTotal: nrIncome,
    qoeNonRecurringExpenseTotal: nrExpense,
    addbackExcessCompensation: comp.addback > 0 ? comp.addback : null,
    addbackOwnerInsurance: null,
    addbackAutoPersonalUse: null,
    addbackHomeOffice: null,
    addbackPersonalTravelMeals: null,
    addbackFamilyCompensation: null,
    addbackRentNormalization: null,
    normalizedTaxProvision: taxProvision,
    maintenanceCapex,
    annualDebtServiceTotal: null,
    isPassThrough,
  };

  const sourceFactKeys = Object.keys(factMap).filter((k) => factMap[k] !== null && factMap[k] !== undefined);

  return {
    input,
    form,
    provenance: {
      base_key: ebitda.baseKey,
      base_value: ebitda.baseValue,
      noncash_addbacks: [depreciation, amortization, sec179, bonusDepr].some((v) => v !== null)
        ? [depreciation, amortization, sec179, bonusDepr].reduce((a: number, b) => a + (b ?? 0), 0)
        : null,
      interest_addback: interest,
      qoe_net:
        nrIncome !== null || nrExpense !== null ? (nrExpense ?? 0) - (nrIncome ?? 0) : null,
      owner_benefit_excess_comp: comp.addback > 0 ? comp.addback : null,
      owner_comp_note: comp.note,
      tax_provision: taxProvision,
      maintenance_capex: maintenanceCapex,
      is_pass_through: isPassThrough,
      source_fact_keys: sourceFactKeys,
    },
  };
}
