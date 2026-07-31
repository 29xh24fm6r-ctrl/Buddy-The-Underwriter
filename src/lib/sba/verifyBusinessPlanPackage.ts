import "server-only";

/**
 * SPEC-M8 ARTIFACT-PIPELINE-1 — verifier pass for the EXISTING SBA
 * business-plan narrative pipeline (sbaPackageNarrative.ts /
 * sbaPackageOrchestrator.ts). Those generators are untouched — each still
 * makes its own single legacy `callGeminiJSON` call per section (tracked
 * allowlisted debt, not migrated to the gateway by this spec). This adds
 * the "at most one verifier per artifact" half via the shared helper,
 * across the whole narrative bundle in one call (Invariant #4), using only
 * the deterministic numeric facts the package itself computed — never the
 * borrower's own free-text story, which is the borrower's own words, not a
 * claim to fact-check.
 */

import { verifyArtifactAndFlag, type VerifyArtifactAndFlagResult } from "@/lib/ai/artifactVerification";

type SB = { from: (t: string) => any };

const NARRATIVE_SECTION_LABELS: Record<string, string> = {
  business_overview_narrative: "Business Overview",
  executive_summary: "Executive Summary",
  industry_analysis: "Industry Analysis",
  marketing_strategy: "Marketing Strategy",
  operations_plan: "Operations Plan",
  swot_strengths: "SWOT — Strengths",
  swot_weaknesses: "SWOT — Weaknesses",
  swot_opportunities: "SWOT — Opportunities",
  swot_threats: "SWOT — Threats",
  sensitivity_narrative: "Sensitivity Analysis",
  plan_thesis: "Plan Thesis",
  // Audit fix (Borrower Intake Program review): franchise_section
  // (sbaPackageOrchestrator.ts, generateFranchiseSection) was persisted
  // but never included here, so franchise investment/Item 19 performance
  // claims went unverified for every franchise deal.
  franchise_section: "Franchise Section",
};

/**
 * Per-section "not available" fallback literals sbaPackageNarrative.ts
 * returns on a per-section generation failure (each section is generated
 * via an independent `Promise.allSettled` slot or its own try/catch, so
 * partial failure across the ~10 sections is realistic — unlike the
 * credit-memo generator, which is one all-or-nothing call). A section
 * matching its fallback exactly must be excluded from the draft text the
 * same way credit-memo's FALLBACK_NARRATIVES exact-match does — otherwise
 * a placeholder like "Strengths not available." gets fact-checked as if it
 * were real generated content, which is meaningless and can produce a
 * spurious flag. plan_thesis has no fallback string (its failure mode is a
 * `null` return, already excluded by the `typeof text === "string"` check).
 */
const SECTION_FALLBACKS: Record<string, string> = {
  business_overview_narrative: "Business overview not available.",
  executive_summary: "Executive summary not available.",
  industry_analysis: "Industry analysis not available.",
  marketing_strategy: "Marketing strategy not available.",
  operations_plan: "Operations plan not available.",
  swot_strengths: "Strengths not available.",
  swot_weaknesses: "Weaknesses not available.",
  swot_opportunities: "Opportunities not available.",
  swot_threats: "Threats not available.",
  sensitivity_narrative: "Sensitivity analysis not available.",
  franchise_section: "Franchise section not available.",
};

export type BusinessPlanPackageForVerify = {
  dscr_year1_base: number | null;
  dscr_year2_base: number | null;
  dscr_year3_base: number | null;
  dscr_year1_downside: number | null;
  dscr_below_threshold: boolean | null;
  break_even_revenue: number | null;
  margin_of_safety_pct: number | null;
  use_of_proceeds: unknown;
} & Record<string, unknown>;

function buildDraftText(pkg: BusinessPlanPackageForVerify): string {
  return Object.keys(NARRATIVE_SECTION_LABELS)
    .map((key) => {
      const text = pkg[key];
      if (typeof text !== "string" || text.trim().length === 0) return null;
      if (text === SECTION_FALLBACKS[key]) return null;
      return `${NARRATIVE_SECTION_LABELS[key]}:\n${text}`;
    })
    .filter((s): s is string => Boolean(s))
    .join("\n\n");
}

export async function verifyBusinessPlanPackage(args: {
  dealId: string;
  bankId: string;
  pkg: BusinessPlanPackageForVerify;
  sb: SB;
}): Promise<VerifyArtifactAndFlagResult | null> {
  const { dealId, bankId, pkg, sb } = args;

  const draftText = buildDraftText(pkg);
  if (!draftText) return null;

  const facts = {
    dscr_year1_base: pkg.dscr_year1_base,
    dscr_year2_base: pkg.dscr_year2_base,
    dscr_year3_base: pkg.dscr_year3_base,
    dscr_year1_downside: pkg.dscr_year1_downside,
    dscr_below_threshold: pkg.dscr_below_threshold,
    break_even_revenue: pkg.break_even_revenue,
    margin_of_safety_pct: pkg.margin_of_safety_pct,
    use_of_proceeds: pkg.use_of_proceeds,
  };

  return verifyArtifactAndFlag({
    dealId,
    bankId,
    artifactType: "business_plan",
    sectionKey: "narratives",
    facts,
    draftText,
    npiTagged: true,
    sb,
  });
}
