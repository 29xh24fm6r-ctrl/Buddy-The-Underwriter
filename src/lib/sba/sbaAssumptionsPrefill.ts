import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";
import type { SBAAssumptions, PrefillMeta } from "./sbaReadinessTypes";
import { findBenchmarkByNaics } from "./sbaAssumptionBenchmarks";

export type PrefilledAssumptions = Partial<SBAAssumptions> & {
  _prefillMeta?: PrefillMeta;
};

/**
 * Phase BPG — Franchise enrichment hook.
 *
 * Currently a no-op: deals has no franchise_brand_id / franchise_brand_name
 * column and there is no FK or relationship table linking deals to
 * franchise_brands. The franchise_brands table itself (and FDD / Item 19
 * intelligence) is preserved and unaffected by this stub — only the
 * dead deal-side reads have been removed.
 *
 * TODO: Future franchise feature should link deals to franchise_brands
 * through a real FK or relationship table.
 */
async function loadFranchiseContext(
  _dealId: string,
): Promise<{
  franchiseBrandId: string | null;
  franchiseBrandName: string | null;
  fddItem7Min: number | null;
  fddItem7Max: number | null;
  fddItem19Avg: number | null;
} | null> {
  return null;
}

export async function loadSBAAssumptionsPrefill(
  dealId: string,
): Promise<PrefilledAssumptions> {
  const sb = supabaseAdmin();

  // Phase BPG — best-effort franchise enrichment (gracefully null today).
  await loadFranchiseContext(dealId);

  // Phase 2 — NAICS-driven smart prefill: pull naics/industry from the
  // borrower application to replace hardcoded defaults with industry medians.
  const { data: app } = await sb
    .from("borrower_applications")
    .select("naics, industry")
    .eq("deal_id", dealId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const naicsCode = (app?.naics as string | null) ?? null;
  const industryLabel = (app?.industry as string | null) ?? null;
  const bench = findBenchmarkByNaics(naicsCode);

  // Management team auto-fill from ownership entities
  const { data: owners } = await sb
    .from("deal_ownership_entities")
    .select("id, display_name, entity_type")
    .eq("deal_id", dealId)
    .eq("entity_type", "individual");

  const { data: interests } = await sb
    .from("deal_ownership_interests")
    .select("owner_entity_id, ownership_pct")
    .eq("deal_id", dealId);

  const managementTeam = (owners ?? []).map(
    (owner: { id: string; display_name: string | null }) => {
      const interest = (interests ?? []).find(
        (i: { owner_entity_id: string }) => i.owner_entity_id === owner.id,
      );
      const pct = Number(interest?.ownership_pct ?? 0);
      return {
        name: owner.display_name ?? "",
        title: pct >= 50 ? "Owner / CEO" : "Partner",
        ownershipPct: pct,
        yearsInIndustry: 0,
        bio: "",
      };
    },
  );

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

  // Phase 2 — NAICS-driven defaults replace 10/8/6 / 45 / 30 / 0.5 generics
  const defaultGrowthY1 = bench?.revenueGrowthMedian ?? 0.1;
  const defaultGrowthY2 = bench
    ? bench.revenueGrowthMedian * 0.8
    : 0.08;
  const defaultGrowthY3 = bench
    ? bench.revenueGrowthMedian * 0.6
    : 0.06;
  const defaultDSO = bench?.dsoMedian ?? 45;
  const defaultDPO = bench?.dpoMedian ?? 30;
  const cogsPercent =
    revenue > 0 ? Math.min(0.95, cogs / revenue) : (bench?.cogsMedian ?? 0.5);
  const streamName = industryLabel
    ? `${industryLabel} Revenue`
    : "Primary Revenue";

  const meta: PrefillMeta = {
    naicsCode,
    naicsLabel: bench?.label ?? null,
    industryLabel,
    benchmarkApplied: bench !== null,
  };

  return {
    revenueStreams:
      revenue > 0
        ? [
            {
              id: "stream_primary",
              name: streamName,
              baseAnnualRevenue: revenue,
              growthRateYear1: defaultGrowthY1,
              growthRateYear2: defaultGrowthY2,
              growthRateYear3: defaultGrowthY3,
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
      targetDSO: defaultDSO,
      targetDPO: defaultDPO,
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
    managementTeam,
    _prefillMeta: meta,
  };
}
