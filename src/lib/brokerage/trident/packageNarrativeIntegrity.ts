import { auditFundingNarrative, auditProjectionNarrative } from "@/lib/ai/projectionNarrativeAudit";
import type { PackageFinancialOutput } from "@/lib/modelEngine/packageFinancialComputation";
import { BUSINESS_PLAN_REQUIREMENTS, narrativeCompletenessFindings } from "./narrativeAcceptance";

/** Recheck the persisted business plan at publication, including resumed jobs. */
export function assertPackageNarrativeIntegrity(pkg: Record<string, unknown>, financial: PackageFinancialOutput): void {
  const keys = ["business_overview_narrative", "executive_summary", "industry_analysis", "marketing_strategy", "operations_plan", "swot_strengths", "swot_weaknesses", "swot_opportunities", "swot_threats", "sensitivity_narrative", "plan_thesis", "franchise_section", "projections_assumptions_narrative"];
  const sections = keys.flatMap(key => typeof pkg[key] === "string" ? [{ key, text: pkg[key] as string }] : []);
  const facts = { authoritativeFinancials: financial };
  const issues = [...auditFundingNarrative(facts, sections), ...auditProjectionNarrative(facts, sections)];
  if (issues.length) throw new Error(`release blocked: persisted narrative conflicts with the authoritative financial output (${[...new Set(issues.map(i => i.sectionKey))].join(", ")})`);
  const incomplete = narrativeCompletenessFindings(sections, BUSINESS_PLAN_REQUIREMENTS);
  if (incomplete.length) throw new Error(`release blocked: persisted narrative sections are incomplete (${incomplete.map(finding => finding.key).join(", ")})`);
}
