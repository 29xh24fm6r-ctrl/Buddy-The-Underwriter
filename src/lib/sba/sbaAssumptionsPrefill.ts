import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";
import type { SBAAssumptions } from "./sbaReadinessTypes";

export async function loadSBAAssumptionsPrefill(
  dealId: string,
): Promise<Partial<SBAAssumptions>> {
  const sb = supabaseAdmin();

  // 1. Deal scalar fields
  const { data: deal } = await sb
    .from("deals")
    .select("loan_amount, deal_type")
    .eq("id", dealId)
    .single();

  // 2. Loan structure from builder sections (term, rate if captured)
  const { data: structureSection } = await sb
    .from("deal_builder_sections")
    .select("data")
    .eq("deal_id", dealId)
    .eq("section_key", "structure")
    .maybeSingle();

  // 3. Base revenue from financial facts (most recent)
  // T-85-PROBE-1: column is fact_value_num (not value_numeric); fact keys in DB
  // are bare (TOTAL_REVENUE, not TOTAL_REVENUE_IS). Query both for fallback.
  const { data: revFact } = await sb
    .from("deal_financial_facts")
    .select("fact_value_num")
    .eq("deal_id", dealId)
    .in("fact_key", ["TOTAL_REVENUE_IS", "TOTAL_REVENUE"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  // 4. COGS from financial facts
  const { data: cogsFact } = await sb
    .from("deal_financial_facts")
    .select("fact_value_num")
    .eq("deal_id", dealId)
    .in("fact_key", ["TOTAL_COGS_IS", "COST_OF_GOODS_SOLD", "COGS"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  // 5. Annual debt service (existing) from financial facts
  const { data: adsFact } = await sb
    .from("deal_financial_facts")
    .select("fact_value_num")
    .eq("deal_id", dealId)
    .eq("fact_key", "ADS")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const structure = structureSection?.data as Record<string, unknown> | null;
  const revenue = Number(revFact?.fact_value_num ?? 0);
  const cogs = Number(cogsFact?.fact_value_num ?? 0);
  const adsValue = Number(adsFact?.fact_value_num ?? 0);
  const cogsPercent = revenue > 0 ? Math.min(0.95, cogs / revenue) : 0.5;

  return {
    revenueStreams:
      revenue > 0
        ? [
            {
              id: "stream_primary",
              name: "Primary Revenue",
              baseAnnualRevenue: revenue,
              growthRateYear1: 0.1,
              growthRateYear2: 0.08,
              growthRateYear3: 0.06,
              pricingModel: "flat",
              seasonalityProfile: null,
            },
          ]
        : [],
    costAssumptions: {
      cogsPercentYear1: cogsPercent,
      cogsPercentYear2: cogsPercent,
      cogsPercentYear3: cogsPercent,
      fixedCostCategories: [],
      plannedHires: [],
      plannedCapex: [],
    },
    workingCapital: {
      targetDSO: 45,
      targetDPO: 30,
      inventoryTurns: null,
    },
    loanImpact: {
      loanAmount: deal?.loan_amount ?? 0,
      termMonths:
        (structure?.desired_term_months as number | undefined) ?? 120,
      interestRate: 0.0725, // SBA prime + 2.75 default; banker must confirm
      existingDebt: adsValue
        ? [
            {
              description: "Existing debt obligations (from spread)",
              currentBalance: 0,
              monthlyPayment: adsValue / 12,
              remainingTermMonths: 60,
            },
          ]
        : [],
      // Phase BPG — sources-of-funds defaults; banker/borrower fills in
      equityInjectionAmount: 0,
      equityInjectionSource: "cash_savings",
      sellerFinancingAmount: 0,
      sellerFinancingTermMonths: 0,
      sellerFinancingRate: 0,
      otherSources: [],
    },
    managementTeam: [],
  };
}
