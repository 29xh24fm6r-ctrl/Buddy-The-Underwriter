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

import { verifyBusinessPlanPackage, type BusinessPlanPackageForVerify } from "./verifyBusinessPlanPackage";

type SB = { from: (t: string) => any };

const PACKAGE_COLUMNS =
  "dscr_year1_base, dscr_year2_base, dscr_year3_base, dscr_year1_downside, dscr_below_threshold, " +
  "break_even_revenue, margin_of_safety_pct, use_of_proceeds, business_overview_narrative, " +
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
}): Promise<void> {
  const { dealId, bankId, packageId, sb } = args;

  const { data: pkg } = await sb
    .from("buddy_sba_packages")
    .select(PACKAGE_COLUMNS)
    .eq("id", packageId)
    .maybeSingle();

  if (!pkg) return;

  const verification = await verifyBusinessPlanPackage({
    dealId,
    bankId,
    pkg: pkg as BusinessPlanPackageForVerify,
    sb,
  });

  await sb
    .from("buddy_sba_packages")
    .update({
      verification_verdict: verification?.verdict ?? null,
      verification_flagged_claims: verification?.flaggedClaims ?? null,
    })
    .eq("id", packageId);
}
