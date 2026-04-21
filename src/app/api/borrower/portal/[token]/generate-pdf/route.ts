// src/app/api/borrower/portal/[token]/generate-pdf/route.ts
// Phase 85-BPG-EXPERIENCE — Borrower-facing projection PDF generation.
// Portal-token gated. Loads confirmed assumptions, runs the forward model,
// generates an actionable roadmap (single Gemini call), renders a 6-page
// borrower PDF, uploads to storage, and returns a 1-hour signed URL.

import { NextRequest, NextResponse } from "next/server";
import { resolvePortalContext } from "@/lib/borrower/resolvePortalContext";
import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  buildBaseYear,
  buildAnnualProjections,
  buildMonthlyProjections,
  computeBreakEven,
  buildSensitivityScenarios,
} from "@/lib/sba/sbaForwardModelBuilder";
import { renderBorrowerProjectionPDF } from "@/lib/sba/sbaBorrowerPDFRenderer";
import { generateActionableRoadmap } from "@/lib/sba/sbaActionableRoadmap";
import type { SBAAssumptions } from "@/lib/sba/sbaReadinessTypes";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

type FactRow = { fact_key: string; fact_value_num: number | string | null };

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;

  let ctx: { dealId: string; bankId: string };
  try {
    ctx = await resolvePortalContext(token);
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid token" },
      { status: 401 },
    );
  }

  const sb = supabaseAdmin();

  const { data: row } = await sb
    .from("buddy_sba_assumptions")
    .select(
      "revenue_streams, cost_assumptions, working_capital, loan_impact, management_team, status",
    )
    .eq("deal_id", ctx.dealId)
    .maybeSingle();

  if (!row) {
    return NextResponse.json(
      { ok: false, error: "No assumptions found" },
      { status: 404 },
    );
  }

  const { data: deal } = await sb
    .from("deals")
    .select("name, deal_type, loan_amount")
    .eq("id", ctx.dealId)
    .maybeSingle();

  const { data: facts } = await sb
    .from("deal_financial_facts")
    .select("fact_key, fact_value_num")
    .eq("deal_id", ctx.dealId)
    .in("fact_key", [
      "TOTAL_REVENUE_IS",
      "TOTAL_REVENUE",
      "TOTAL_COGS_IS",
      "COST_OF_GOODS_SOLD",
      "COGS",
      "TOTAL_OPERATING_EXPENSES_IS",
      "TOTAL_OPERATING_EXPENSES",
      "NET_INCOME",
      "EBITDA",
      "DEPRECIATION_IS",
      "DEPRECIATION",
      "INTEREST_EXPENSE",
      "TOTAL_TAX",
      "ADS",
    ])
    .order("created_at", { ascending: false });

  const factRows: FactRow[] = (facts as FactRow[] | null) ?? [];
  const getFact = (...keys: string[]): number => {
    for (const key of keys) {
      const f = factRows.find((r) => r.fact_key === key);
      if (f?.fact_value_num != null) return Number(f.fact_value_num);
    }
    return 0;
  };

  const revenue = getFact("TOTAL_REVENUE_IS", "TOTAL_REVENUE");
  const cogs = getFact("TOTAL_COGS_IS", "COST_OF_GOODS_SOLD", "COGS");
  const opex = getFact(
    "TOTAL_OPERATING_EXPENSES_IS",
    "TOTAL_OPERATING_EXPENSES",
  );
  const depreciation = getFact("DEPRECIATION_IS", "DEPRECIATION");
  const netIncome = getFact("NET_INCOME");
  const interestExpense = getFact("INTEREST_EXPENSE");
  const totalTax = getFact("TOTAL_TAX");
  let ebitda = getFact("EBITDA");
  if (ebitda === 0 && netIncome !== 0) {
    ebitda = netIncome + interestExpense + depreciation + totalTax;
  }
  const ads = getFact("ADS");

  const loanImpactRaw = (row.loan_impact ?? {}) as Partial<
    SBAAssumptions["loanImpact"]
  >;
  const assumptions: SBAAssumptions = {
    dealId: ctx.dealId,
    status: (row.status as SBAAssumptions["status"]) ?? "draft",
    revenueStreams: (row.revenue_streams ?? []) as SBAAssumptions["revenueStreams"],
    costAssumptions: (row.cost_assumptions ?? {
      cogsPercentYear1: 0.5,
      cogsPercentYear2: 0.5,
      cogsPercentYear3: 0.5,
      fixedCostCategories: [],
      plannedHires: [],
      plannedCapex: [],
    }) as SBAAssumptions["costAssumptions"],
    workingCapital: (row.working_capital ?? {
      targetDSO: 45,
      targetDPO: 30,
      inventoryTurns: null,
    }) as SBAAssumptions["workingCapital"],
    loanImpact: {
      loanAmount: loanImpactRaw.loanAmount ?? 0,
      termMonths: loanImpactRaw.termMonths ?? 120,
      interestRate: loanImpactRaw.interestRate ?? 0.0725,
      existingDebt: loanImpactRaw.existingDebt ?? [],
      equityInjectionAmount: loanImpactRaw.equityInjectionAmount ?? 0,
      equityInjectionSource: loanImpactRaw.equityInjectionSource ?? "cash_savings",
      sellerFinancingAmount: loanImpactRaw.sellerFinancingAmount ?? 0,
      sellerFinancingTermMonths: loanImpactRaw.sellerFinancingTermMonths ?? 0,
      sellerFinancingRate: loanImpactRaw.sellerFinancingRate ?? 0,
      otherSources: loanImpactRaw.otherSources ?? [],
    },
    managementTeam: (row.management_team ?? []) as SBAAssumptions["managementTeam"],
  };

  const baseYear = buildBaseYear({
    revenue,
    cogs,
    operatingExpenses: opex,
    ebitda,
    depreciation,
    netIncome,
    existingDebtServiceAnnual: ads,
  });

  const annual = buildAnnualProjections(assumptions, baseYear);
  const year1 = annual[0];
  if (!year1) {
    return NextResponse.json(
      { ok: false, error: "Unable to build Year 1 projection" },
      { status: 500 },
    );
  }
  const monthly = buildMonthlyProjections(assumptions, year1);
  const breakEven = computeBreakEven(assumptions, year1);
  const scenarios = buildSensitivityScenarios(assumptions, [
    baseYear,
    ...annual,
  ]);

  // Reconstruct a briefing from the most recent compiled research narrative.
  let researchBriefing = "";
  const { data: mission } = await sb
    .from("buddy_research_missions")
    .select("id")
    .eq("deal_id", ctx.dealId)
    .eq("status", "complete")
    .order("completed_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (mission?.id) {
    const { data: narrative } = await sb
      .from("buddy_research_narratives")
      .select("sections")
      .eq("mission_id", mission.id)
      .order("compiled_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (narrative?.sections && Array.isArray(narrative.sections)) {
      const sections = narrative.sections as Array<{
        title?: string;
        body?: string;
      }>;
      researchBriefing = sections
        .slice(0, 4)
        .map((sec) => `${sec.title ?? ""}\n\n${sec.body ?? ""}`.trim())
        .filter(Boolean)
        .join("\n\n")
        .trim();
    }
  }

  const downsideScenario = scenarios.find((s) => s.name === "downside");
  const dscrDownside = downsideScenario?.dscrYear1 ?? year1.dscr;

  const roadmap = await generateActionableRoadmap({
    businessName: deal?.name ?? "Your Business",
    loanAmount: assumptions.loanImpact.loanAmount || deal?.loan_amount || 0,
    revenue: year1.revenue,
    breakEvenRevenue: breakEven.breakEvenRevenue,
    marginOfSafetyPct: breakEven.marginOfSafetyPct,
    dscrYear1: year1.dscr,
    dscrDownside,
    monthlyDebtService: year1.totalDebtService / 12,
    grossMarginPct: year1.grossMarginPct,
    cogsPercent: assumptions.costAssumptions.cogsPercentYear1 ?? 0.3,
    revenueGrowthY1:
      assumptions.revenueStreams[0]?.growthRateYear1 ?? 0.05,
  });

  const pdfBuffer = await renderBorrowerProjectionPDF({
    businessName: deal?.name ?? "Your Business",
    loanAmount: assumptions.loanImpact.loanAmount || deal?.loan_amount || 0,
    loanType: deal?.deal_type ?? "SBA",
    baseYear,
    annualProjections: annual,
    monthlyProjections: monthly,
    breakEven,
    sensitivityScenarios: scenarios,
    researchBriefing,
    actionableRoadmap: roadmap,
    generatedDate: new Date().toLocaleDateString("en-US", {
      month: "long",
      day: "numeric",
      year: "numeric",
    }),
  });

  const pdfPath = `borrower-projections/${ctx.dealId}/${Date.now()}.pdf`;
  const { error: uploadError } = await sb.storage
    .from("deal-documents")
    .upload(pdfPath, pdfBuffer, {
      contentType: "application/pdf",
      upsert: true,
    });

  if (uploadError) {
    console.error("[generate-pdf] upload error:", uploadError);
    return NextResponse.json(
      { ok: false, error: "Failed to save PDF" },
      { status: 500 },
    );
  }

  const { data: signed } = await sb.storage
    .from("deal-documents")
    .createSignedUrl(pdfPath, 3600);

  return NextResponse.json({
    ok: true,
    pdfUrl: signed?.signedUrl ?? null,
    pdfPath,
  });
}
