import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";
import { validateSBAAssumptions } from "./sbaAssumptionsValidator";
import {
  buildBaseYear,
  buildAnnualProjections,
  buildMonthlyProjections,
  computeBreakEven,
  buildSensitivityScenarios,
  buildUseOfProceeds,
} from "./sbaForwardModelBuilder";
import { calculateSBAGuarantee, detectSBAProgram } from "./sbaGuarantee";
import {
  generateBusinessOverviewNarrative,
  generateSensitivityNarrative,
} from "./sbaPackageNarrative";
import { renderSBAPackagePDF } from "./sbaPackageRenderer";
import type { SBAAssumptions } from "./sbaReadinessTypes";

const SBA_DSCR_THRESHOLD = 1.25;

export async function generateSBAPackage(
  dealId: string,
): Promise<
  | {
      ok: true;
      packageId: string;
      dscrBelowThreshold: boolean;
      dscrYear1Base: number;
      pdfUrl: string | null;
    }
  | { ok: false; error: string; blockers?: string[] }
> {
  const sb = supabaseAdmin();

  // Gate 1: Validation Pass must not be FAIL
  const { data: latestValidation } = await sb
    .from("buddy_validation_reports")
    .select("overall_status")
    .eq("deal_id", dealId)
    .order("run_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (latestValidation?.overall_status === "FAIL") {
    return {
      ok: false,
      error:
        "Cannot generate SBA package: Validation Pass is FAIL. Resolve data integrity issues first.",
    };
  }

  // Gate 2: Assumptions must be confirmed
  const { data: assumptionsRow } = await sb
    .from("buddy_sba_assumptions")
    .select("*")
    .eq("deal_id", dealId)
    .maybeSingle();

  if (!assumptionsRow || assumptionsRow.status !== "confirmed") {
    return {
      ok: false,
      error: "Assumptions must be confirmed before generating the SBA package.",
    };
  }

  const assumptions: SBAAssumptions = {
    dealId,
    status: assumptionsRow.status,
    confirmedAt: assumptionsRow.confirmed_at ?? undefined,
    revenueStreams: assumptionsRow.revenue_streams,
    costAssumptions: assumptionsRow.cost_assumptions,
    workingCapital: assumptionsRow.working_capital,
    loanImpact: assumptionsRow.loan_impact,
    managementTeam: assumptionsRow.management_team,
  };

  // Gate 3: Validate assumption completeness
  const validation = validateSBAAssumptions(assumptions);
  if (!validation.ok) {
    return {
      ok: false,
      error: "Assumption validation failed",
      blockers: validation.blockers,
    };
  }

  // Pull base year facts
  const { data: facts } = await sb
    .from("deal_financial_facts")
    .select("fact_key, value_numeric")
    .eq("deal_id", dealId)
    .in("fact_key", [
      "TOTAL_REVENUE_IS",
      "TOTAL_COGS_IS",
      "NET_INCOME",
      "EBITDA",
      "DEPRECIATION_IS",
      "TOTAL_OPERATING_EXPENSES_IS",
      "ADS",
    ])
    .order("created_at", { ascending: false });

  const getFact = (key: string) =>
    (facts ?? []).find((f: { fact_key: string }) => f.fact_key === key)
      ?.value_numeric ?? 0;

  const baseYear = buildBaseYear({
    revenue: getFact("TOTAL_REVENUE_IS"),
    cogs: getFact("TOTAL_COGS_IS"),
    operatingExpenses: getFact("TOTAL_OPERATING_EXPENSES_IS"),
    ebitda: getFact("EBITDA"),
    depreciation: getFact("DEPRECIATION_IS"),
    netIncome: getFact("NET_INCOME"),
    existingDebtServiceAnnual: getFact("ADS"),
  });

  // Run model passes
  const annualProjections = buildAnnualProjections(assumptions, baseYear);
  const monthlyProjections = buildMonthlyProjections(
    assumptions,
    annualProjections[0],
  );
  const breakEven = computeBreakEven(assumptions, annualProjections[0]);
  const sensitivityScenarios = buildSensitivityScenarios(
    assumptions,
    annualProjections,
  );

  // Use of proceeds
  const { data: proceedsItems } = await sb
    .from("deal_proceeds_items")
    .select("category, description, amount")
    .eq("deal_id", dealId);

  const useOfProceeds = buildUseOfProceeds(
    proceedsItems ?? [],
    assumptions.loanImpact.loanAmount,
  );

  // DSCR thresholds
  const dscrYear1Base = annualProjections[0]?.dscr ?? 0;
  const dscrYear2Base = annualProjections[1]?.dscr ?? 0;
  const dscrYear3Base = annualProjections[2]?.dscr ?? 0;
  const dscrYear1Downside =
    sensitivityScenarios.find((s) => s.name === "downside")?.dscrYear1 ?? 0;
  const dscrBelowThreshold =
    dscrYear1Base < SBA_DSCR_THRESHOLD ||
    dscrYear2Base < SBA_DSCR_THRESHOLD ||
    dscrYear3Base < SBA_DSCR_THRESHOLD;

  // Deal and research context for Gemini
  const { data: deal } = await sb
    .from("deals")
    .select("name, deal_type, loan_amount")
    .eq("id", dealId)
    .single();

  const { data: researchRow } = await sb
    .from("buddy_research_narratives")
    .select("sections")
    .eq("deal_id", dealId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const researchSummary = researchRow?.sections
    ? JSON.stringify(researchRow.sections).slice(0, 2000)
    : undefined;

  const proceedsDescription =
    useOfProceeds.length > 0
      ? useOfProceeds
          .map(
            (p) =>
              `${p.category}: $${Math.round(p.amount).toLocaleString()}`,
          )
          .join(", ")
      : "General business purposes";

  // Gemini Call 1
  const businessOverviewNarrative = await generateBusinessOverviewNarrative({
    dealName: deal?.name ?? "Borrower",
    loanType: deal?.deal_type ?? "SBA",
    loanAmount: assumptions.loanImpact.loanAmount,
    managementTeam: assumptions.managementTeam,
    revenueStreamNames: assumptions.revenueStreams.map((s) => s.name),
    useOfProceedsDescription: proceedsDescription,
    researchSummary,
  });

  // Gemini Call 2
  const year1MinCumulativeCash = Math.min(
    ...monthlyProjections.map((m) => m.cumulativeCash),
  );
  const sensitivityNarrative = await generateSensitivityNarrative({
    scenarios: sensitivityScenarios,
    breakEvenMarginOfSafetyPct: breakEven.marginOfSafetyPct,
    year1MinCumulativeCash,
    loanType: deal?.deal_type ?? "SBA",
  });

  // Render PDF
  let pdfUrl: string | null = null;
  try {
    const pdfBuffer = await renderSBAPackagePDF({
      dealName: deal?.name ?? "Borrower",
      loanType: deal?.deal_type ?? "SBA",
      loanAmount: assumptions.loanImpact.loanAmount,
      baseYear,
      annualProjections,
      monthlyProjections,
      breakEven,
      sensitivityScenarios,
      useOfProceeds,
      businessOverviewNarrative,
      sensitivityNarrative,
      managementTeam: assumptions.managementTeam,
    });

    const pdfPath = `sba-packages/${dealId}/${Date.now()}.pdf`;
    const { error: uploadError } = await sb.storage
      .from("deal-documents")
      .upload(pdfPath, pdfBuffer, {
        contentType: "application/pdf",
        upsert: true,
      });

    if (!uploadError) {
      pdfUrl = pdfPath;
    } else {
      console.error("[sbaPackageOrchestrator] PDF upload error:", uploadError);
    }
  } catch (pdfErr) {
    console.error("[sbaPackageOrchestrator] PDF render error:", pdfErr);
    // Non-fatal: proceed without PDF
  }

  // Compute SBA guarantee
  const sbaProgram = detectSBAProgram(deal?.deal_type ?? null);
  const guarantee = calculateSBAGuarantee(
    assumptions.loanImpact.loanAmount,
    sbaProgram,
  );

  // Store package record
  const { data: pkg } = await sb
    .from("buddy_sba_packages")
    .insert({
      deal_id: dealId,
      assumptions_id: assumptionsRow.id,
      base_year_data: baseYear,
      projections_annual: annualProjections,
      projections_monthly: monthlyProjections,
      break_even: breakEven,
      sensitivity_scenarios: sensitivityScenarios,
      use_of_proceeds: useOfProceeds,
      dscr_year1_base: dscrYear1Base,
      dscr_year2_base: dscrYear2Base,
      dscr_year3_base: dscrYear3Base,
      dscr_year1_downside: dscrYear1Downside,
      dscr_below_threshold: dscrBelowThreshold,
      break_even_revenue: breakEven.breakEvenRevenue,
      margin_of_safety_pct: breakEven.marginOfSafetyPct,
      business_overview_narrative: businessOverviewNarrative,
      sensitivity_narrative: sensitivityNarrative,
      pdf_url: pdfUrl,
      sba_guarantee_pct: guarantee.guaranteePct,
      sba_guarantee_amount: guarantee.guaranteeAmount,
      sba_bank_exposure: guarantee.bankExposure,
      sba_bank_exposure_pct: guarantee.bankExposurePct,
      status: "draft",
    })
    .select("id")
    .single();

  return {
    ok: true,
    packageId: pkg?.id ?? "",
    dscrBelowThreshold,
    dscrYear1Base,
    pdfUrl,
  };
}
