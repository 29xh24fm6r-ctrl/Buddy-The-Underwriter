import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

export type ArtifactQuality = {
  key: "businessPlan" | "projections" | "feasibility" | "spreads" | "creditMemo";
  label: string;
  score: number;
  status: "pass" | "review" | "fail" | "missing";
  passed: string[];
  findings: string[];
};

export type GoldenTridentQualityReport = {
  generatedAt: string;
  overallScore: number;
  artifacts: ArtifactQuality[];
};

function words(value: unknown): number {
  return typeof value === "string" ? value.trim().split(/\s+/).filter(Boolean).length : 0;
}

function qualityStatus(score: number, exists: boolean): ArtifactQuality["status"] {
  if (!exists) return "missing";
  if (score >= 85) return "pass";
  if (score >= 65) return "review";
  return "fail";
}

function artifact(
  key: ArtifactQuality["key"],
  label: string,
  score: number,
  exists: boolean,
  passed: string[],
  findings: string[],
  requiredGatePassed = true,
): ArtifactQuality {
  const bounded = Math.max(0, Math.min(100, Math.round(score)));
  const structuralStatus = qualityStatus(bounded, exists);
  const status = !requiredGatePassed && structuralStatus === "pass" ? "review" : structuralStatus;
  return { key, label, score: bounded, status, passed, findings };
}

/** Structural, deterministic grading. It intentionally does not pretend to
 * judge prose elegance; it identifies missing, thin, placeholder, internally
 * incomplete, or unverified outputs before a lender performs qualitative UAT.
 */
export async function gradeGoldenTrident(args: {
  sb: SupabaseClient;
  dealId: string;
  bankId: string;
}): Promise<GoldenTridentQualityReport> {
  const { sb, dealId, bankId } = args;
  const { data: bundle } = await sb
    .from("buddy_trident_bundles")
    .select("id,status,business_plan_pdf_path,projections_pdf_path,projections_xlsx_path,feasibility_pdf_path,source_sba_package_id,source_feasibility_id,generation_error")
    .eq("deal_id", dealId)
    .eq("bank_id", bankId)
    .eq("mode", "final")
    .is("superseded_at", null)
    .order("generated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const packageId = bundle?.source_sba_package_id ?? null;
  const feasibilityId = bundle?.source_feasibility_id ?? null;
  const [{ data: pkg }, { data: feasibility }, { data: spread }, { data: memo }] = await Promise.all([
    packageId
      ? sb.from("buddy_sba_packages").select(
          "id,business_overview_narrative,executive_summary,industry_analysis,marketing_strategy,operations_plan,swot_strengths,swot_weaknesses,swot_opportunities,swot_threats,sensitivity_narrative,plan_thesis,milestone_timeline,kpi_dashboard,risk_contingency_matrix,projections_annual,projections_monthly,sensitivity_scenarios,sources_and_uses,balance_sheet_projections,projections_assumptions_narrative,verification_verdict,verification_flagged_claims",
        ).eq("id", packageId).maybeSingle()
      : Promise.resolve({ data: null }),
    feasibilityId
      ? sb.from("buddy_feasibility_studies").select(
          "id,composite_score,market_demand_score,financial_viability_score,operational_readiness_score,location_suitability_score,data_completeness,narratives,narrative_citations,verification_verdict,verification_flagged_claims,pdf_url",
        ).eq("id", feasibilityId).maybeSingle()
      : Promise.resolve({ data: null }),
    sb.from("deal_spreads").select("id,status,rendered_json,error,updated_at")
      .eq("deal_id", dealId).eq("bank_id", bankId).eq("spread_type", "CLASSIC_PDF")
      .order("updated_at", { ascending: false }).limit(1).maybeSingle(),
    sb.from("canonical_memo_narratives").select("id,narratives,model,research_trust_grade,generated_at")
      .eq("deal_id", dealId).eq("bank_id", bankId)
      .order("generated_at", { ascending: false }).limit(1).maybeSingle(),
  ]);

  const artifacts: ArtifactQuality[] = [];

  {
    const passed: string[] = [];
    const findings: string[] = [];
    let score = 0;
    const exists = bundle?.status === "succeeded" && Boolean(pkg);
    if (bundle?.business_plan_pdf_path) { score += 15; passed.push("Final business-plan PDF exists."); }
    else findings.push("Final business-plan PDF is missing.");
    const narrativeFields = [
      "business_overview_narrative", "executive_summary", "industry_analysis", "marketing_strategy", "operations_plan",
      "swot_strengths", "swot_weaknesses", "swot_opportunities", "swot_threats", "sensitivity_narrative",
    ] as const;
    const substantive = narrativeFields.filter((field) => {
      const value = pkg?.[field];
      return words(value) >= 45 &&
        typeof value === "string" &&
        !/```(?:json)?|^\s*[\[{]\s*["']/im.test(value);
    }).length;
    score += substantive * 5;
    if (substantive === narrativeFields.length) passed.push("All ten core narrative sections are substantive.");
    else findings.push(`${narrativeFields.length - substantive} of 10 narrative sections are missing, thin (<45 words), or contain serialized model output.`);
    if (words(pkg?.plan_thesis) >= 35) { score += 10; passed.push("Plan thesis is substantive."); }
    else findings.push("Plan thesis is missing or thin.");
    const roadmap = [pkg?.milestone_timeline, pkg?.kpi_dashboard, pkg?.risk_contingency_matrix].filter(Boolean).length;
    score += roadmap * 5;
    if (roadmap === 3) passed.push("Milestones, KPI dashboard, and contingency matrix are present.");
    else findings.push(`${3 - roadmap} roadmap section(s) are missing.`);
    if (pkg?.verification_verdict === "pass") { score += 10; passed.push("Business-plan verifier passed."); }
    else findings.push(`Business-plan verification is ${String(pkg?.verification_verdict ?? "missing")}.`);
    artifacts.push(artifact(
      "businessPlan",
      "Business plan",
      score,
      exists,
      passed,
      findings,
      pkg?.verification_verdict === "pass",
    ));
  }

  {
    const passed: string[] = [];
    const findings: string[] = [];
    let score = 0;
    const annual = Array.isArray(pkg?.projections_annual) ? pkg.projections_annual : [];
    const monthly = Array.isArray(pkg?.projections_monthly) ? pkg.projections_monthly : [];
    const sensitivity = Array.isArray(pkg?.sensitivity_scenarios) ? pkg.sensitivity_scenarios : [];
    const balance = Array.isArray(pkg?.balance_sheet_projections) ? pkg.balance_sheet_projections : [];
    const exists = Boolean(pkg);
    if (bundle?.projections_xlsx_path) { score += 15; passed.push("Final Excel workbook exists."); }
    else findings.push("Final projections workbook is missing.");
    if (annual.length >= 3) { score += 25; passed.push("Three annual projection years are present."); }
    else findings.push(`Only ${annual.length} annual projection year(s) found.`);
    if (monthly.length === 12) { score += 20; passed.push("Twelve monthly cash-flow periods are present."); }
    else findings.push(`Expected 12 monthly periods; found ${monthly.length}.`);
    if (sensitivity.length >= 3) { score += 15; passed.push("Base, upside, and downside sensitivity cases are present."); }
    else findings.push(`Expected 3 sensitivity cases; found ${sensitivity.length}.`);
    const sourcesUses = pkg?.sources_and_uses as Record<string, unknown> | null;
    if (sourcesUses && Object.keys(sourcesUses).length > 0) { score += 10; passed.push("Sources and uses are populated."); }
    else findings.push("Sources and uses are missing.");
    if (balance.length >= 3) { score += 10; passed.push("Balance-sheet projections are populated."); }
    else findings.push("Balance-sheet projections are incomplete.");
    const negativeCashYears = balance.filter((row) => {
      if (!row || typeof row !== "object") return false;
      const record = row as Record<string, unknown>;
      const cash = Number(record.cash ?? record.cashAndEquivalents ?? record.cash_and_equivalents);
      return Number.isFinite(cash) && cash < 0;
    }).length;
    if (negativeCashYears > 0) findings.push(`${negativeCashYears} projected year(s) end with negative cash; institutional release is blocked.`);
    else if (balance.length > 0) passed.push("Projected cash remains non-negative in every balance-sheet year.");
    if (words(pkg?.projections_assumptions_narrative) >= 35) { score += 5; passed.push("Projection assumptions narrative is substantive."); }
    else findings.push("Projection assumptions narrative is missing or thin.");
    artifacts.push(artifact(
      "projections",
      "Projections and assumptions",
      score,
      exists,
      passed,
      findings,
      negativeCashYears === 0,
    ));
  }

  {
    const passed: string[] = [];
    const findings: string[] = [];
    let score = 0;
    const exists = Boolean(feasibility);
    if (bundle?.feasibility_pdf_path && feasibility?.pdf_url) { score += 15; passed.push("Final feasibility PDF exists."); }
    else findings.push("Final feasibility PDF is missing.");
    const dimensionScores = [feasibility?.composite_score, feasibility?.market_demand_score, feasibility?.financial_viability_score, feasibility?.operational_readiness_score, feasibility?.location_suitability_score];
    if (dimensionScores.every((n) => typeof n === "number")) { score += 25; passed.push("Composite and four dimension scores are populated."); }
    else findings.push("One or more feasibility dimension scores are missing.");
    const completeness = Number(feasibility?.data_completeness ?? 0);
    if (completeness >= 0.7 || completeness >= 70) { score += 15; passed.push(`Data completeness is ${completeness}.`); }
    else findings.push(`Data completeness is low (${completeness}).`);
    const narratives = feasibility?.narratives && typeof feasibility.narratives === "object"
      ? Object.values(feasibility.narratives as Record<string, unknown>) : [];
    const substantive = narratives.filter((value) => words(value) >= 45).length;
    score += Math.min(25, substantive * 5);
    if (substantive >= 5) passed.push("Five substantive feasibility narratives are present.");
    else findings.push(`Only ${substantive} substantive feasibility narrative(s) found.`);
    const citationMap = feasibility?.narrative_citations && typeof feasibility.narrative_citations === "object"
      ? Object.values(feasibility.narrative_citations as Record<string, unknown>) : [];
    const citedSections = citationMap.filter((entry) => {
      if (!entry || typeof entry !== "object") return false;
      const citation = entry as { urls?: unknown; precise?: unknown };
      return citation.precise === true && Array.isArray(citation.urls) && citation.urls.length > 0;
    }).length;
    if (citedSections >= 3) { score += 10; passed.push("All research-backed narratives have precise citations."); }
    else findings.push(`Only ${citedSections} of 3 research-backed narratives have precise citations.`);
    if (feasibility?.verification_verdict === "pass") { score += 10; passed.push("Feasibility verifier passed."); }
    else findings.push(`Feasibility verification is ${String(feasibility?.verification_verdict ?? "missing")}.`);
    artifacts.push(artifact(
      "feasibility",
      "Feasibility study",
      score,
      exists,
      passed,
      findings,
      feasibility?.verification_verdict === "pass",
    ));
  }

  {
    const passed: string[] = [];
    const findings: string[] = [];
    let score = 0;
    const exists = Boolean(spread);
    if (spread?.status === "ready") { score += 35; passed.push("Canonical Classic Spread is ready."); }
    else findings.push(`Classic Spread status is ${String(spread?.status ?? "missing")}.`);
    const payload = spread?.rendered_json as Record<string, unknown> | null;
    if (payload && typeof payload.pdf_base64 === "string" && payload.pdf_base64.length > 1000) { score += 35; passed.push("Rendered PDF payload is populated."); }
    else findings.push("Rendered spread PDF payload is missing or too small.");
    if (payload?.pdf_sha256) { score += 15; passed.push("PDF integrity hash is present."); }
    else findings.push("PDF integrity hash is missing.");
    if (payload?.canonicalFactsTimestamp) { score += 15; passed.push("Canonical-facts timestamp is present."); }
    else findings.push("Canonical-facts provenance timestamp is missing.");
    artifacts.push(artifact("spreads", "Financial spreads", score, exists, passed, findings));
  }

  {
    const passed: string[] = [];
    const findings: string[] = [];
    let score = 0;
    const exists = Boolean(memo);
    const sections = Array.isArray((memo?.narratives as { sections?: unknown[] } | null)?.sections)
      ? (memo?.narratives as { sections: Array<{ content?: unknown }> }).sections : [];
    const substantiveSections = sections.filter((section) => words(section?.content) >= 35).length;
    if (substantiveSections >= 6) { score += 50; passed.push(`${substantiveSections} substantive memo narrative sections are present.`); }
    else findings.push(`Credit memo has ${substantiveSections} substantive narrative section(s); expected at least 6.`);
    if (memo?.model) { score += 15; passed.push(`Generation model recorded (${memo.model}).`); }
    else findings.push("Memo model provenance is missing.");
    if (memo?.research_trust_grade) { score += 20; passed.push(`Research trust grade recorded (${memo.research_trust_grade}).`); }
    else findings.push("Research trust grade is missing.");
    if (memo?.generated_at) { score += 15; passed.push("Generation timestamp is present."); }
    else findings.push("Generation timestamp is missing.");
    artifacts.push(artifact("creditMemo", "Credit memo", score, exists, passed, findings));
  }

  return {
    generatedAt: new Date().toISOString(),
    overallScore: Math.round(artifacts.reduce((sum, item) => sum + item.score, 0) / artifacts.length),
    artifacts,
  };
}
