/**
 * Pure function — maps research inferences to SpreadFlags.
 *
 * No DB access, no server imports. All persistence happens in persistResearchFlags.ts.
 */

import type { ResearchInference } from "./types";
import type { SpreadFlag } from "@/lib/flagEngine/types";
import { buildFlag } from "@/lib/flagEngine/flagHelpers";

// ---------------------------------------------------------------------------
// Inference type → flag trigger_type (only risk_indicator: true inferences)
// ---------------------------------------------------------------------------

const INFERENCE_TO_FLAG: Partial<Record<string, string>> = {
  adverse_event_risk: "research_adverse_event_risk",
  execution_risk_level: "research_execution_risk",
  cyclicality_risk: "research_cyclicality_risk",
  regulatory_burden: "research_regulatory_burden",
  headwind: "research_headwind",
  geographic_concentration: "research_geographic_concentration",
  competitive_intensity: "research_competitive_intensity",
  regulatory_risk_level: "research_regulatory_risk_level",
  expansion_constraint_risk: "research_expansion_constraint_risk",
  stress_resilience: "research_stress_resilience_low",
  downside_risk: "research_downside_risk",
  lender_program_fit: "research_lender_program_fit_low",
};

// Inference types that are always "elevated" when confidence >= 0.5
const ALWAYS_ELEVATED: ReadonlySet<string> = new Set([
  "adverse_event_risk",
  "execution_risk_level",
]);

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export function flagFromResearchInferences(
  dealId: string,
  inferences: ResearchInference[],
  missionType: string,
): SpreadFlag[] {
  const flags: SpreadFlag[] = [];

  for (const inference of inferences) {
    const triggerType = INFERENCE_TO_FLAG[inference.inference_type];
    if (!triggerType) continue;

    // Only flag high-confidence risk indicators (confidence >= 0.5)
    if (inference.confidence < 0.5) continue;

    // Severity: always-elevated types stay "elevated"; others use confidence threshold
    const severity = ALWAYS_ELEVATED.has(inference.inference_type)
      ? "elevated"
      : inference.confidence >= 0.8
        ? "elevated"
        : "watch";

    const flag = buildFlag({
      dealId,
      triggerType,
      category: "qualitative_risk",
      severity,
      canonicalKeys: [],
      observedValue: inference.confidence,
      yearObserved: undefined,
      bankerSummary: inference.conclusion,
      bankerDetail:
        inference.reasoning ??
        `Research mission (${missionType}) identified this risk with ${Math.round(inference.confidence * 100)}% confidence.`,
      bankerImplication:
        "This finding comes from Buddy's institutional research layer. Review the full research narrative for source citations and supporting evidence.",
      borrowerQuestion: null,
    });

    // Tag with research provenance
    flag.metadata = {
      source: "research_engine",
      mission_type: missionType,
      inference_id: inference.id,
      inference_confidence: inference.confidence,
      input_fact_ids: inference.input_fact_ids,
    };

    flags.push(flag);
  }

  return flags;
}
