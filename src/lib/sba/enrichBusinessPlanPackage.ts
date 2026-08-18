import "server-only";

/**
 * SPEC-M8 ARTIFACT-PIPELINE-1 (audit fix) — post-hoc verifier pass for an
 * already-persisted SBA business-plan package. Called AFTER
 * sbaPackageOrchestrator.ts's generateSBAPackage has already inserted the
 * buddy_sba_packages row — this only ever UPDATEs that same row,
 * sbaPackageOrchestrator.ts itself is untouched. Best-effort by design: the
 * caller must treat a failure here as non-fatal, since the package itself
 * already generated successfully.
 *
 * This was originally built in M8 (verifyBusinessPlanPackage.ts) but never
 * actually wired into the real generation flow — the business-plan artifact
 * shipped with zero AI fact-checking despite the spec's own intent. This
 * file closes that gap, mirroring enrichFeasibilityStudy.ts's pattern.
 */

import type { BusinessPlanPackageForVerify } from "./verifyBusinessPlanPackage";
import { finishInstitutionalArtifact } from "@/lib/ai/frontierArtifactFactory";
import { persistArtifactFlags } from "@/lib/ai/artifactVerification";
import type { FlaggedClaim } from "@/lib/ai/verify";

type SB = { from: (t: string) => any };

const PACKAGE_COLUMNS =
  "dscr_year1_base, dscr_year2_base, dscr_year3_base, dscr_year1_downside, dscr_below_threshold, " +
  "break_even_revenue, margin_of_safety_pct, use_of_proceeds, sources_and_uses, " +
  "projections_annual, projections_monthly, sensitivity_scenarios, balance_sheet_projections, " +
  "projections_assumptions_narrative, base_year_data, business_overview_narrative, " +
  "executive_summary, industry_analysis, marketing_strategy, operations_plan, swot_strengths, " +
  "swot_weaknesses, swot_opportunities, swot_threats, sensitivity_narrative, plan_thesis, " +
  // Audit fix (Borrower Intake Program review): franchise_section was
  // persisted by sbaPackageOrchestrator.ts but missing here, so it was
  // silently excluded from verifyBusinessPlanPackage.ts's fact-check.
  "franchise_section";

export async function enrichBusinessPlanPackage(args: {
  dealId: string;
  bankId: string;
  packageId: string;
  sb: SB;
}): Promise<{ verdict: "pass" | "flagged" | null; repaired: boolean; flaggedClaims: FlaggedClaim[] }> {
  const { dealId, bankId, packageId, sb } = args;

  const { data: pkg } = await sb
    .from("buddy_sba_packages")
    .select(PACKAGE_COLUMNS)
    .eq("id", packageId)
    .maybeSingle();

  if (!pkg) return { verdict: null, repaired: false, flaggedClaims: [] };

  // Narratives are composed from deterministic calculations plus inputs the
  // borrower explicitly confirmed. Review against that same evidence set so
  // legitimate management, staffing, and ramp facts are not misclassified as
  // hallucinations. Draft assumptions never enter the release evidence.
  const { data: assumptionsRow } = await sb
    .from("buddy_sba_assumptions")
    .select("revenue_streams,cost_assumptions,working_capital,loan_impact,management_team,status,confirmed_at")
    .eq("deal_id", dealId)
    .maybeSingle();
  const confirmedAssumptions = assumptionsRow?.status === "confirmed"
    ? {
        confirmed_at: assumptionsRow.confirmed_at,
        revenue_streams: assumptionsRow.revenue_streams,
        cost_assumptions: assumptionsRow.cost_assumptions,
        working_capital: assumptionsRow.working_capital,
        loan_impact: assumptionsRow.loan_impact,
        management_team: assumptionsRow.management_team,
      }
    : null;

  const typed = pkg as BusinessPlanPackageForVerify;
  const narrativeKeys = [
    "business_overview_narrative", "executive_summary", "industry_analysis",
    "marketing_strategy", "operations_plan", "swot_strengths", "swot_weaknesses",
    "swot_opportunities", "swot_threats", "sensitivity_narrative", "plan_thesis",
    "franchise_section",
  ];
  const sections = narrativeKeys.flatMap((key) => {
    const text = typed[key];
    return typeof text === "string" && text.trim() ? [{ key, text }] : [];
  });
  if (!sections.length) {
    await sb.from("buddy_sba_packages").update({
      verification_verdict: null,
      verification_flagged_claims: null,
    }).eq("id", packageId);
    return { verdict: null, repaired: false, flaggedClaims: [] };
  }

  const facts = {
    dscr_year1_base: typed.dscr_year1_base,
    dscr_year2_base: typed.dscr_year2_base,
    dscr_year3_base: typed.dscr_year3_base,
    dscr_year1_downside: typed.dscr_year1_downside,
    dscr_below_threshold: typed.dscr_below_threshold,
    break_even_revenue: typed.break_even_revenue,
    margin_of_safety_pct: typed.margin_of_safety_pct,
    use_of_proceeds: typed.use_of_proceeds,
    sources_and_uses: typed.sources_and_uses,
    projections_annual: typed.projections_annual,
    projections_monthly: typed.projections_monthly,
    sensitivity_scenarios: typed.sensitivity_scenarios,
    balance_sheet_projections: typed.balance_sheet_projections,
    projections_assumptions_narrative: typed.projections_assumptions_narrative,
    base_year_data: typed.base_year_data,
    borrower_confirmed_assumptions: confirmedAssumptions,
  };
  const finished = await finishInstitutionalArtifact({
    artifactType: "business_plan", facts, sections, dealId, npiTagged: true,
  });
  await persistArtifactFlags({
    dealId, bankId, artifactType: "business_plan", sectionKey: "narratives",
    flaggedClaims: finished.flaggedClaims, sb,
  });
  const repairedFields = Object.fromEntries(finished.sections.map((section) => [section.key, section.text]));

  await sb
    .from("buddy_sba_packages")
    .update({
      ...repairedFields,
      verification_verdict: finished.verdict,
      verification_flagged_claims: finished.flaggedClaims,
    })
    .eq("id", packageId);
  return {
    verdict: finished.verdict,
    repaired: finished.repaired,
    flaggedClaims: finished.flaggedClaims,
  };
}
