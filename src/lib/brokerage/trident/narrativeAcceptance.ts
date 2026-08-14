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

export function assessBusinessPlanNarratives(
  pkg: Record<string, unknown> | null,
): { ok: boolean; substantive: number; total: number } {
  const substantive = BUSINESS_PLAN_FIELDS.filter(
    (field) => wordCount(pkg?.[field]) >= 45,
  ).length;
  return {
    ok: substantive >= 5,
    substantive,
    total: BUSINESS_PLAN_FIELDS.length,
  };
}

export function assessFeasibilityNarratives(
  narratives: Record<string, unknown> | null,
): { ok: boolean; substantive: number; required: number } {
  const substantive = Object.values(narratives ?? {}).filter(
    (value) => wordCount(value) >= 45,
  ).length;
  return { ok: substantive >= 5, substantive, required: 5 };
}
