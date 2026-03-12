import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";

export type PersonalIncomeYear = {
  year: number;
  periodEnd: string;
  wagesW2: number | null;
  schedCNet: number | null;
  schedENet: number | null;
  k1OrdinaryIncome: number | null;
  taxableInterest: number | null;
  ordinaryDividends: number | null;
  capitalGains: number | null;
  pensionAnnuity: number | null;
  socialSecurity: number | null;
  otherIncome: number | null;
  adjustmentsToIncome: number | null;
  adjustedGrossIncome: number | null;
  standardDeduction: number | null;
  qbiDeduction: number | null;
  taxableIncome: number | null;
  totalTax: number | null;
  schEGrossRents: number | null;
  schEMortgageInterest: number | null;
  schEDepreciation: number | null;
  schETotalExpenses: number | null;
  f4562Sec179: number | null;
  f4562BonusDepreciation: number | null;
  f4562TotalDepreciation: number | null;
  f8825NetIncomeLoss: number | null;
};

export type PersonalIncomeSection = {
  ownerName: string | null;
  years: PersonalIncomeYear[];
};

/**
 * Load personal income facts from deal_financial_facts for all PERSONAL_INCOME
 * type rows. Groups by tax year. Returns years in ascending order.
 *
 * If ownerEntityId is provided, filters to that owner. Otherwise returns all
 * PERSONAL_INCOME facts for the deal (first guarantor found).
 */
export async function loadPersonalIncome(
  dealId: string,
  bankId: string,
  ownerEntityId?: string | null,
): Promise<PersonalIncomeSection> {
  const sb = supabaseAdmin();

  let query = (sb as ReturnType<typeof supabaseAdmin>)
    .from("deal_financial_facts")
    .select("fact_key, fact_value_num, fact_period_end, owner_entity_id")
    .eq("deal_id", dealId)
    .eq("bank_id", bankId)
    .eq("fact_type", "PERSONAL_INCOME")
    .not("fact_value_num", "is", null)
    .order("fact_period_end", { ascending: true });

  if (ownerEntityId) {
    query = query.eq("owner_entity_id", ownerEntityId);
  }

  const { data, error } = await query;
  if (error || !data || data.length === 0) {
    return { ownerName: null, years: [] };
  }

  // Group facts by tax year (derived from fact_period_end)
  const byYear = new Map<number, Record<string, number>>();

  for (const row of data as Array<{ fact_key: string; fact_value_num: number; fact_period_end: string }>) {
    if (!row.fact_period_end) continue;
    const year = new Date(row.fact_period_end).getFullYear();
    if (!byYear.has(year)) byYear.set(year, {});
    const bucket = byYear.get(year)!;
    bucket[row.fact_key] = row.fact_value_num;
  }

  const helper = (bucket: Record<string, number>, ...keys: string[]): number | null => {
    for (const k of keys) {
      if (bucket[k] != null) return bucket[k];
    }
    return null;
  };

  const years: PersonalIncomeYear[] = Array.from(byYear.entries())
    .sort(([a], [b]) => a - b)
    .map(([year, b]) => ({
      year,
      periodEnd: `${year}-12-31`,
      wagesW2: helper(b, "WAGES_W2"),
      schedCNet: helper(b, "SCHED_C_NET"),
      schedENet: helper(b, "SCHED_E_NET", "SCH_E_NET", "SCH_E_RENTAL_TOTAL"),
      k1OrdinaryIncome: helper(b, "K1_ORDINARY_INCOME", "SCH_E_K1_NET_TOTAL"),
      taxableInterest: helper(b, "TAXABLE_INTEREST", "INTEREST_INCOME"),
      ordinaryDividends: helper(b, "ORDINARY_DIVIDENDS", "DIVIDEND_INCOME"),
      capitalGains: helper(b, "CAPITAL_GAINS"),
      pensionAnnuity: helper(b, "PENSION_ANNUITY"),
      socialSecurity: helper(b, "SOCIAL_SECURITY"),
      otherIncome: helper(b, "OTHER_INCOME"),
      adjustmentsToIncome: helper(b, "ADJUSTMENTS_TO_INCOME"),
      adjustedGrossIncome: helper(b, "ADJUSTED_GROSS_INCOME"),
      standardDeduction: helper(b, "STANDARD_DEDUCTION"),
      qbiDeduction: helper(b, "QBI_DEDUCTION"),
      taxableIncome: helper(b, "TAXABLE_INCOME"),
      totalTax: helper(b, "TOTAL_TAX"),
      schEGrossRents: helper(b, "SCH_E_GROSS_RENTS_RECEIVED"),
      schEMortgageInterest: helper(b, "SCH_E_MORTGAGE_INTEREST"),
      schEDepreciation: helper(b, "SCH_E_DEPRECIATION"),
      schETotalExpenses: helper(b, "SCH_E_TOTAL_EXPENSES"),
      f4562Sec179: helper(b, "F4562_SEC179_ELECTED"),
      f4562BonusDepreciation: helper(b, "F4562_BONUS_DEPRECIATION"),
      f4562TotalDepreciation: helper(b, "F4562_TOTAL_DEPRECIATION"),
      f8825NetIncomeLoss: helper(b, "F8825_NET_INCOME_LOSS"),
    }));

  return { ownerName: null, years };
}
