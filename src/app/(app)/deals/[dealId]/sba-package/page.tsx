import { redirect } from "next/navigation";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import { loadSBAAssumptionsPrefill } from "@/lib/sba/sbaAssumptionsPrefill";
import SBAPackageTab from "@/components/sba/SBAPackageTab";
import type { SBAAssumptions, SBAPackageData } from "@/lib/sba/sbaReadinessTypes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SBA_TYPES = ["SBA", "sba_7a", "sba_504", "sba_express"];

export default async function SBAPackagePage({
  params,
}: {
  params: Promise<{ dealId: string }>;
}) {
  const { dealId } = await params;

  const access = await ensureDealBankAccess(dealId);
  if (!access.ok) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <p className="text-white/50">Access denied</p>
      </div>
    );
  }

  const sb = supabaseAdmin();

  // Check deal is SBA type
  const { data: deal } = await sb
    .from("deals")
    .select("deal_type, loan_amount")
    .eq("id", dealId)
    .maybeSingle();

  if (!deal || !SBA_TYPES.includes(deal.deal_type ?? "")) {
    redirect(`/deals/${dealId}/cockpit`);
  }

  // Parallel fetches
  const [assumptionsResult, packageResult, prefilled] = await Promise.all([
    sb
      .from("buddy_sba_assumptions")
      .select("*")
      .eq("deal_id", dealId)
      .maybeSingle(),
    sb
      .from("buddy_sba_packages")
      .select("*")
      .eq("deal_id", dealId)
      .order("generated_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    loadSBAAssumptionsPrefill(dealId),
  ]);

  const assumptions: SBAAssumptions | null = assumptionsResult.data
    ? {
        dealId,
        status: assumptionsResult.data.status,
        confirmedAt: assumptionsResult.data.confirmed_at ?? undefined,
        revenueStreams: assumptionsResult.data.revenue_streams,
        costAssumptions: assumptionsResult.data.cost_assumptions,
        workingCapital: assumptionsResult.data.working_capital,
        loanImpact: assumptionsResult.data.loan_impact,
        managementTeam: assumptionsResult.data.management_team,
      }
    : null;

  const packageRow = packageResult.data;
  const packageData: SBAPackageData | null = packageRow
    ? {
        dealId: packageRow.deal_id,
        assumptionsId: packageRow.assumptions_id,
        generatedAt: packageRow.generated_at,
        baseYearData: packageRow.base_year_data,
        projectionsAnnual: packageRow.projections_annual,
        projectionsMonthly: packageRow.projections_monthly,
        breakEven: packageRow.break_even,
        sensitivityScenarios: packageRow.sensitivity_scenarios,
        useOfProceeds: packageRow.use_of_proceeds,
        dscrYear1Base: packageRow.dscr_year1_base,
        dscrYear2Base: packageRow.dscr_year2_base,
        dscrYear3Base: packageRow.dscr_year3_base,
        dscrYear1Downside: packageRow.dscr_year1_downside,
        dscrBelowThreshold: packageRow.dscr_below_threshold,
        businessOverviewNarrative: packageRow.business_overview_narrative,
        sensitivityNarrative: packageRow.sensitivity_narrative,
        pdfUrl: packageRow.pdf_url,
        status: packageRow.status,
      }
    : null;

  // Phase 2 — peel off the _prefillMeta sibling for prop cleanliness.
  const { _prefillMeta: prefillMeta, ...prefilledClean } = prefilled;

  return (
    <SBAPackageTab
      dealId={dealId}
      loanAmount={Number((deal as any).loan_amount) || 0}
      dealType={(deal as any).deal_type ?? null}
      initialAssumptions={assumptions}
      initialPackage={packageData}
      prefilled={prefilledClean}
      prefillMeta={prefillMeta ?? null}
    />
  );
}
