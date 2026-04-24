/**
 * Deterministic narrative builder for Buddy SBA Score.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * NO LLM. NO AI. NO callGeminiJSON. NO getOpenAI.
 * Narrative = templated prose from component facts. That is the entire
 * intent. The CI grep in the PR checks this file + the rest of /score/
 * for any LLM/AI call and fails the build if one is introduced.
 * ═══════════════════════════════════════════════════════════════════════
 */

import type { ComponentScore, ScoreBand } from "./types";

const BAND_LABEL: Record<ScoreBand, string> = {
  institutional_prime: "Institutional prime",
  strong_fit: "Strong fit for most lenders",
  selective_fit: "Selective fit — specific lender appetites",
  specialty_lender: "Specialty lender territory",
  not_eligible: "Not marketplace-eligible",
};

export type NarrativeResult = {
  narrative: string;
  strengths: string[];
  weaknesses: string[];
};

export function buildScoreNarrative(params: {
  score: number;
  band: ScoreBand;
  borrower: ComponentScore;
  business: ComponentScore;
  structure: ComponentScore;
  repayment: ComponentScore;
  franchise: ComponentScore | null;
}): NarrativeResult {
  const { score, band, borrower, business, structure, repayment, franchise } = params;

  const components = [borrower, business, structure, repayment];
  if (franchise) components.push(franchise);

  const strengths = components
    .filter((c) => c.rawScore >= 4 && !c.insufficientData)
    .sort((a, b) => b.rawScore - a.rawScore)
    .slice(0, 3)
    .map((c) => formatStrength(c));

  const weaknesses = components
    .filter((c) => (c.rawScore <= 2.5 || c.insufficientData) && c.rawScore < 4)
    .sort((a, b) => a.rawScore - b.rawScore)
    .slice(0, 3)
    .map((c) => formatWeakness(c));

  const heading = `Buddy SBA Score: ${score}/100 — ${BAND_LABEL[band]}.`;
  const componentLine = components
    .map((c) => `${humanizeComponent(c.componentName)} ${c.rawScore.toFixed(1)}/5.0 (${(c.weight * 100).toFixed(0)}% weight)`)
    .join("; ");

  const strengthLine = strengths.length > 0
    ? `Strengths: ${strengths.join(" ")}`
    : "No component reached a strength threshold.";

  const weaknessLine = weaknesses.length > 0
    ? `Attention: ${weaknesses.join(" ")}`
    : "No component flagged as a weakness.";

  const narrative = [
    heading,
    `Component breakdown: ${componentLine}.`,
    strengthLine,
    weaknessLine,
  ].join("\n\n");

  return { narrative, strengths, weaknesses };
}

export function buildNotEligibleNarrative(
  failures: Array<{ reason: string }>,
): NarrativeResult {
  const reasons = failures.map((f) => f.reason);
  const narrative = [
    "Buddy SBA Score: 0/100 — Not marketplace-eligible.",
    "This deal failed one or more SBA SOP 50 10 7.1 eligibility checks:",
    ...reasons.map((r) => `• ${r}`),
    "Marketplace listing is blocked until eligibility is remediated.",
  ].join("\n\n");
  return {
    narrative,
    strengths: [],
    weaknesses: reasons.slice(0, 3),
  };
}

function formatStrength(c: ComponentScore): string {
  return `${humanizeComponent(c.componentName)} is strong (${c.rawScore.toFixed(1)}/5.0) — ${c.narrative}`;
}

function formatWeakness(c: ComponentScore): string {
  if (c.insufficientData) {
    return `${humanizeComponent(c.componentName)} has insufficient data (${c.missingInputs.join(", ") || "multiple inputs missing"}).`;
  }
  return `${humanizeComponent(c.componentName)} is weak (${c.rawScore.toFixed(1)}/5.0) — ${c.narrative}`;
}

function humanizeComponent(name: string): string {
  return name
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
