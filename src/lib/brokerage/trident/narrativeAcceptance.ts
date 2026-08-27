/**
 * Fail-closed acceptance checks for lender-facing narrative artifacts.
 *
 * The model prompts intentionally return different JSON property names for
 * each section, so acceptance belongs after parsing/persistence rather than
 * in one shared response schema. These checks catch the catastrophic case
 * where a renderer produced a real PDF around placeholder text.
 */

const BUSINESS_PLAN_FIELDS = [
  "business_overview_narrative",
  "executive_summary",
  "industry_analysis",
  "marketing_strategy",
  "operations_plan",
  "swot_strengths",
  "swot_weaknesses",
  "swot_opportunities",
  "swot_threats",
  "sensitivity_narrative",
] as const;

function wordCount(value: unknown): number {
  return typeof value === "string"
    ? value.trim().split(/\s+/).filter(Boolean).length
    : 0;
}

function isPresentationSafe(value: unknown): boolean {
  if (typeof value !== "string") return false;
  return !/```(?:json)?|^\s*[\[{]\s*["']/im.test(value);
}

export function assessBusinessPlanNarratives(
  pkg: Record<string, unknown> | null,
): { ok: boolean; substantive: number; total: number } {
  const substantive = BUSINESS_PLAN_FIELDS.filter(
    (field) => wordCount(pkg?.[field]) >= 45 && isPresentationSafe(pkg?.[field]),
  ).length;
  return {
    // A lender-facing final plan is one document, not a collection where half
    // the core analysis may silently be absent. Preview remains permissive;
    // final Golden Trident generation uses this fail-closed contract.
    ok: substantive === BUSINESS_PLAN_FIELDS.length,
    substantive,
    total: BUSINESS_PLAN_FIELDS.length,
  };
}

/**
 * The five sections a lender-facing feasibility study must actually contain:
 * the executive summary plus one narrative per scored dimension.
 *
 * Deliberately excludes riskAssessment, recommendation, and the nullable
 * franchiseComparisonNarrative. The check used to count ANY five narrative
 * values over the word threshold, so those three could stand in for missing
 * dimension analysis — a study could pass with three of the four scored
 * dimensions blank, and the renderer prints each dimension narrative in its
 * own section, so the committee PDF shipped with visible gaps.
 */
const FEASIBILITY_REQUIRED_NARRATIVES = [
  "executiveSummary",
  "marketDemandNarrative",
  "financialViabilityNarrative",
  "operationalReadinessNarrative",
  "locationSuitabilityNarrative",
] as const;

export function assessFeasibilityNarratives(
  narratives: Record<string, unknown> | null,
): { ok: boolean; substantive: number; required: number } {
  const substantive = FEASIBILITY_REQUIRED_NARRATIVES.filter(
    // isPresentationSafe applies here for the same reason it applies to the
    // business plan: both are model output rendered verbatim into a
    // lender-facing PDF, and this module exists to catch "a real PDF around
    // placeholder text". Only the plan was checked, so a feasibility section
    // returned as a fenced JSON blob cleared the word count and shipped to
    // the committee (audit F-20).
    (field) =>
      wordCount(narratives?.[field]) >= 45 && isPresentationSafe(narratives?.[field]),
  ).length;
  const required = FEASIBILITY_REQUIRED_NARRATIVES.length;
  // Same threshold as before — five substantive sections — but they must now
  // be the five that matter rather than any five keys on the object.
  return { ok: substantive === required, substantive, required };
}
