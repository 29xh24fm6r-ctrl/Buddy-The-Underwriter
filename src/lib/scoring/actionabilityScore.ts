/**
 * Scores recommendations by actionability.
 * Pure function, no DB or server deps.
 */

export type ActionabilityInput = {
  feasibility: "high" | "medium" | "low";
  urgency: "immediate" | "soon" | "eventually";
  impact: "high" | "medium" | "low";
  reversibility: "easily" | "with_effort" | "irreversible";
  documentationDependency: "none" | "some" | "heavy";
};

export type ActionabilityTier = "do_now" | "plan_soon" | "consider" | "defer";

export type ActionabilityResult = {
  score: number; // 0-100
  tier: ActionabilityTier;
  rationale: string;
};

const FEASIBILITY_SCORES: Record<ActionabilityInput["feasibility"], number> = {
  high: 30,
  medium: 15,
  low: 5,
};

const URGENCY_SCORES: Record<ActionabilityInput["urgency"], number> = {
  immediate: 25,
  soon: 15,
  eventually: 5,
};

const IMPACT_SCORES: Record<ActionabilityInput["impact"], number> = {
  high: 25,
  medium: 15,
  low: 5,
};

const REVERSIBILITY_SCORES: Record<
  ActionabilityInput["reversibility"],
  number
> = {
  easily: 10,
  with_effort: 5,
  irreversible: 2,
};

const DOCUMENTATION_SCORES: Record<
  ActionabilityInput["documentationDependency"],
  number
> = {
  none: 10,
  some: 5,
  heavy: 2,
};

function tierFromScore(score: number): ActionabilityTier {
  if (score >= 75) return "do_now";
  if (score >= 50) return "plan_soon";
  if (score >= 30) return "consider";
  return "defer";
}

function buildRationale(input: ActionabilityInput, tier: ActionabilityTier): string {
  const tierLabels: Record<ActionabilityTier, string> = {
    do_now: "Act immediately",
    plan_soon: "Plan for near-term execution",
    consider: "Evaluate when capacity allows",
    defer: "Deprioritize for now",
  };

  const parts: string[] = [tierLabels[tier] + "."];

  if (input.feasibility === "high" && input.impact === "high") {
    parts.push("High feasibility and high impact make this a clear priority.");
  } else if (input.feasibility === "low") {
    parts.push("Low feasibility limits near-term actionability.");
  }

  if (input.urgency === "immediate") {
    parts.push("Time-sensitive.");
  }

  if (input.documentationDependency === "heavy") {
    parts.push("Heavy documentation dependency may slow execution.");
  }

  if (input.reversibility === "irreversible") {
    parts.push("Irreversible — proceed with care.");
  }

  return parts.join(" ");
}

export function computeActionabilityScore(
  input: ActionabilityInput,
): ActionabilityResult {
  const score =
    FEASIBILITY_SCORES[input.feasibility] +
    URGENCY_SCORES[input.urgency] +
    IMPACT_SCORES[input.impact] +
    REVERSIBILITY_SCORES[input.reversibility] +
    DOCUMENTATION_SCORES[input.documentationDependency];

  const tier = tierFromScore(score);
  const rationale = buildRationale(input, tier);

  return { score, tier, rationale };
}
