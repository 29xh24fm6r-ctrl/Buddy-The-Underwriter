import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";

export const runtime = "nodejs";

type Params = Promise<{ dealId: string }>;

const SBA_TYPES = ["SBA", "sba_7a", "sba_504", "sba_express"];

async function ensureSbaDealOrReturn403(dealId: string): Promise<Response | null> {
  const sb = supabaseAdmin();
  const { data: deal } = await sb
    .from("deals")
    .select("deal_type")
    .eq("id", dealId)
    .single();
  if (!deal || !SBA_TYPES.includes(deal.deal_type ?? "")) {
    return NextResponse.json(
      { error: "SBA Package is not available for this deal type." },
      { status: 403 },
    );
  }
  return null;
}

export async function GET(
  _req: NextRequest,
  ctx: { params: Params },
) {
  try {
    const { dealId } = await ctx.params;

    const access = await ensureDealBankAccess(dealId);
    if (!access.ok) {
      return NextResponse.json({ ok: false, error: access.error }, { status: 403 });
    }

    const sbaGate = await ensureSbaDealOrReturn403(dealId);
    if (sbaGate) return sbaGate;

    const sb = supabaseAdmin();

    const { data: row } = await sb
      .from("buddy_sba_packages")
      .select("*")
      .eq("deal_id", dealId)
      .order("generated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!row) {
      return NextResponse.json({ package: null });
    }

    return NextResponse.json({
      package: {
        // Phase 3 — expose id + all narrative columns so the viewer can
        // wire section-level refinement. refine-section requires packageId.
        id: row.id,
        dealId: row.deal_id,
        assumptionsId: row.assumptions_id,
        generatedAt: row.generated_at,
        baseYearData: row.base_year_data,
        projectionsAnnual: row.projections_annual,
        projectionsMonthly: row.projections_monthly,
        breakEven: row.break_even,
        sensitivityScenarios: row.sensitivity_scenarios,
        useOfProceeds: row.use_of_proceeds,
        dscrYear1Base: row.dscr_year1_base,
        dscrYear2Base: row.dscr_year2_base,
        dscrYear3Base: row.dscr_year3_base,
        dscrYear1Downside: row.dscr_year1_downside,
        dscrBelowThreshold: row.dscr_below_threshold,
        businessOverviewNarrative: row.business_overview_narrative,
        sensitivityNarrative: row.sensitivity_narrative,
        executiveSummary: row.executive_summary,
        industryAnalysis: row.industry_analysis,
        marketingStrategy: row.marketing_strategy,
        operationsPlan: row.operations_plan,
        swotStrengths: row.swot_strengths,
        swotWeaknesses: row.swot_weaknesses,
        swotOpportunities: row.swot_opportunities,
        swotThreats: row.swot_threats,
        franchiseSection: row.franchise_section,
        pdfUrl: row.pdf_url,
        status: row.status,
      },
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
