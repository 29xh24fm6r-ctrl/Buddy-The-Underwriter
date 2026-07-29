/**
 * SPEC-M8 ARTIFACT-PIPELINE-1 — section-level provenance for the SBA
 * business-plan narrative sections that draw on the borrower's own words
 * (BorrowerStory, sbaBorrowerStory.ts).
 *
 * `buddy_borrower_stories` captures ONE `captured_at`/`captured_via` per
 * deal-record, not per field or per sentence (§0 research confirmed this).
 * Provenance here is therefore necessarily section-level — "this section
 * drew on: growth strategy, stated via chat on <date>" — not true per-claim
 * attribution, because the underlying data was never captured at that
 * granularity. The section→field map below is derived directly from
 * sbaPackageNarrative.ts's actual prompt-construction code (which fields
 * each generator weaves in), NOT recomputed by inspecting narrative text —
 * this is metadata about what the generator was given, never a claim about
 * what the output says (Invariant #1: never treat AI output as ground truth).
 *
 * No DB access, no side effects — pure function over an already-loaded
 * BorrowerStory, so it's safe to call from read paths without duplicating
 * the load.
 */

import type { BorrowerStory } from "./sbaBorrowerStory";

export type BusinessPlanSectionKey =
  | "business_overview_narrative"
  | "executive_summary"
  | "industry_analysis"
  | "marketing_strategy"
  | "operations_plan"
  | "swot_strengths"
  | "swot_weaknesses"
  | "swot_opportunities"
  | "swot_threats"
  | "sensitivity_narrative"
  | "plan_thesis";

/**
 * Which BorrowerStory fields each section's generator weaves into its
 * prompt, per sbaPackageNarrative.ts's actual generator functions.
 * `franchise_section` is deliberately absent — generateFranchiseSection
 * takes no `story` param at all.
 */
export const BUSINESS_PLAN_PROVENANCE_MAP: Record<
  BusinessPlanSectionKey,
  Array<keyof BorrowerStory>
> = {
  business_overview_narrative: ["originStory", "competitiveInsight", "idealCustomer"],
  executive_summary: [
    "originStory",
    "competitiveInsight",
    "idealCustomer",
    "growthStrategy",
    "biggestRisk",
    "personalVision",
  ],
  industry_analysis: ["competitiveInsight"],
  marketing_strategy: ["growthStrategy", "idealCustomer"],
  operations_plan: ["growthStrategy", "idealCustomer"],
  swot_strengths: ["competitiveInsight"],
  swot_weaknesses: [],
  swot_opportunities: ["growthStrategy"],
  swot_threats: ["biggestRisk"],
  sensitivity_narrative: ["biggestRisk"],
  plan_thesis: [
    "originStory",
    "competitiveInsight",
    "idealCustomer",
    "growthStrategy",
    "biggestRisk",
    "personalVision",
  ],
};

export type SectionProvenance = {
  storyFields: string[];
  capturedVia: BorrowerStory["capturedVia"];
  capturedAt: string;
} | null;

function isNonEmpty(v: string | null): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

/**
 * Builds a per-section provenance map for display to a borrower/banker.
 * A section gets a non-null entry only when the story actually had
 * substance in at least one of that section's mapped fields — an entirely
 * empty story produced no real influence on generation, so there's nothing
 * true to attribute.
 */
export function buildBusinessPlanProvenance(
  story: BorrowerStory | null,
): Record<BusinessPlanSectionKey, SectionProvenance> {
  const result = {} as Record<BusinessPlanSectionKey, SectionProvenance>;

  for (const sectionKey of Object.keys(BUSINESS_PLAN_PROVENANCE_MAP) as BusinessPlanSectionKey[]) {
    const fields = BUSINESS_PLAN_PROVENANCE_MAP[sectionKey];
    const usedFields = story
      ? fields.filter((f) => isNonEmpty(story[f] as string | null))
      : [];

    result[sectionKey] =
      story && usedFields.length > 0
        ? { storyFields: usedFields, capturedVia: story.capturedVia, capturedAt: story.capturedAt }
        : null;
  }

  return result;
}
