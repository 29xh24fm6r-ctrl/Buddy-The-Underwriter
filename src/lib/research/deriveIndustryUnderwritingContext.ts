/**
 * Derive Industry Underwriting Context
 *
 * This is the "Holy Shit" moment - where research converges with underwriting.
 * It synthesizes research inferences with underwriting state to produce
 * Buddy's authoritative take on the deal.
 *
 * Output: 1-3 citation-backed sentences that bankers will remember.
 */

import type { ResearchInference, ResearchFact, Citation } from "./types";

// ============================================================================
// Types
// ============================================================================

export type UnderwritingContext = {
  /** The underwriting stance from file analysis */
  stance: string;
  /** Checklist completion percentage */
  checklist_completion_pct?: number;
  /** Key risk flags from underwriting */
  risk_flags?: string[];
  /** Scenario breakpoint if stress testing was done */
  scenario_breakpoint?: number;
};

export type IndustryUnderwritingInsight = {
  /** The insight text */
  text: string;
  /** Citations backing this insight */
  citations: Citation[];
  /** Confidence in this insight (0-1) */
  confidence: number;
};

export type DerivedContext = {
  ok: boolean;
  /** Buddy's authoritative take (1-3 insights) */
  insights: IndustryUnderwritingInsight[];
  /** Overall confidence score */
  overall_confidence: number;
  /** Recommended next action */
  recommended_action: RecommendedAction;
  /** Key risk factors identified */
  key_risks: string[];
  /** Key strengths identified */
  key_strengths: string[];
  error?: string;
};

export type RecommendedAction =
  | "proceed_to_committee"
  | "gather_more_documents"
  | "conduct_site_visit"
  | "verify_management_backgrounds"
  | "assess_collateral"
  | "request_stress_scenarios"
  | "decline_early";

// ============================================================================
// Main Function
// ============================================================================

/**
 * Derive industry underwriting context from research + underwriting state.
 * This is the convergence point that creates the "wow" moment.
 */
export function deriveIndustryUnderwritingContext(
  inferences: ResearchInference[],
  facts: ResearchFact[],
  underwritingContext: UnderwritingContext
): DerivedContext {
  const insights: IndustryUnderwritingInsight[] = [];
  const keyRisks: string[] = [];
  const keyStrengths: string[] = [];

  // 1. Analyze research inferences for key signals
  const growthInference = inferences.find((i) => i.inference_type === "growth_trajectory");
  const competitiveInference = inferences.find((i) => i.inference_type === "competitive_intensity");
  const demandStabilityInference = inferences.find(
    (i) => i.inference_type === "demand_stability" ||
           (i.inference_type === "other" && i.conclusion.toLowerCase().includes("demand"))
  );
  const regulatoryInference = inferences.find((i) => i.inference_type === "regulatory_risk_level");
  const lenderFitInference = inferences.find((i) => i.inference_type === "lender_program_fit");
  const stressInference = inferences.find((i) => i.inference_type === "stress_resilience");
  const executionRiskInference = inferences.find((i) => i.inference_type === "execution_risk_level");

  // 2. Extract signals and categorize
  const signals = extractSignals(inferences);

  // 3. Build primary insight based on stance + research
  const primaryInsight = buildPrimaryInsight(
    underwritingContext,
    signals,
    growthInference,
    competitiveInference,
    demandStabilityInference
  );
  if (primaryInsight) {
    insights.push(primaryInsight);
  }

  // 4. Build risk/opportunity insight
  const riskInsight = buildRiskInsight(
    regulatoryInference,
    stressInference,
    executionRiskInference,
    keyRisks
  );
  if (riskInsight) {
    insights.push(riskInsight);
  }

  // 5. Build lender fit insight if available
  const lenderInsight = buildLenderFitInsight(lenderFitInference, keyStrengths);
  if (lenderInsight && insights.length < 3) {
    insights.push(lenderInsight);
  }

  // 6. Extract key risks and strengths
  extractKeyRisksAndStrengths(inferences, keyRisks, keyStrengths);

  // 7. Determine recommended action
  const recommendedAction = determineRecommendedAction(
    underwritingContext,
    signals,
    insights
  );

  // 8. Calculate overall confidence
  const overallConfidence = calculateOverallConfidence(insights, inferences);

  return {
    ok: insights.length > 0,
    insights,
    overall_confidence: overallConfidence,
    recommended_action: recommendedAction,
    key_risks: [...new Set(keyRisks)],
    key_strengths: [...new Set(keyStrengths)],
  };
}

// ============================================================================
// Signal Extraction
// ============================================================================

type Signals = {
  hasGrowth: boolean;
  hasDemandStability: boolean;
  hasLowCompetition: boolean;
  hasHighRegulation: boolean;
  hasLenderFit: boolean;
  hasStressResilience: boolean;
  hasManagementRisk: boolean;
};

function extractSignals(inferences: ResearchInference[]): Signals {
  const signals: Signals = {
    hasGrowth: false,
    hasDemandStability: false,
    hasLowCompetition: false,
    hasHighRegulation: false,
    hasLenderFit: false,
    hasStressResilience: false,
    hasManagementRisk: false,
  };

  for (const inference of inferences) {
    const conclusion = inference.conclusion.toLowerCase();

    if (inference.inference_type === "growth_trajectory") {
      signals.hasGrowth = conclusion.includes("growing") || conclusion.includes("positive") || conclusion.includes("high");
    }
    if (inference.inference_type === "demand_stability" || conclusion.includes("demand")) {
      signals.hasDemandStability = !conclusion.includes("volatile") && !conclusion.includes("declining");
    }
    if (inference.inference_type === "competitive_intensity") {
      signals.hasLowCompetition = conclusion.includes("low") || conclusion.includes("moderate");
    }
    if (inference.inference_type === "regulatory_risk_level") {
      signals.hasHighRegulation = conclusion.includes("high") || conclusion.includes("elevated");
    }
    if (inference.inference_type === "lender_program_fit") {
      signals.hasLenderFit = conclusion.includes("strong") || conclusion.includes("moderate");
    }
    if (inference.inference_type === "stress_resilience") {
      signals.hasStressResilience = conclusion.includes("high") || conclusion.includes("moderate");
    }
    if (inference.inference_type === "execution_risk_level") {
      signals.hasManagementRisk = conclusion.includes("high") || conclusion.includes("elevated");
    }
  }

  return signals;
}

// ============================================================================
// Insight Builders
// ============================================================================

function buildPrimaryInsight(
  context: UnderwritingContext,
  signals: Signals,
  growthInference?: ResearchInference,
  competitiveInference?: ResearchInference,
  demandInference?: ResearchInference
): IndustryUnderwritingInsight | null {
  const citations: Citation[] = [];
  const parts: string[] = [];

  // Start with stance context
  if (context.stance === "favorable" || context.stance === "approved") {
    parts.push("File analysis supports creditworthiness");
  } else if (context.stance === "cautious" || context.stance === "conditional") {
    parts.push("File analysis shows conditional strength");
  } else if (context.stance === "insufficient_information") {
    parts.push("Awaiting key documents");
  }

  // Add research context
  if (growthInference && signals.hasGrowth) {
    parts.push("industry shows growth trajectory");
    citations.push({ type: "inference", id: growthInference.id });
  }

  if (demandInference && signals.hasDemandStability) {
    parts.push("demand fundamentals are stable");
    citations.push({ type: "inference", id: demandInference.id });
  }

  if (competitiveInference) {
    if (signals.hasLowCompetition) {
      parts.push("competitive environment is manageable");
    } else {
      parts.push("competitive intensity requires differentiation strategy");
    }
    citations.push({ type: "inference", id: competitiveInference.id });
  }

  if (parts.length === 0) {
    return null;
  }

  // Combine into a flowing sentence
  const text = parts.length === 1
    ? parts[0] + "."
    : parts.slice(0, -1).join(", ") + ", and " + parts.slice(-1) + ".";

  return {
    text: text.charAt(0).toUpperCase() + text.slice(1),
    citations,
    confidence: citations.length > 0 ? 0.8 : 0.6,
  };
}

function buildRiskInsight(
  regulatoryInference?: ResearchInference,
  stressInference?: ResearchInference,
  executionInference?: ResearchInference,
  keyRisks: string[] = []
): IndustryUnderwritingInsight | null {
  const citations: Citation[] = [];
  const risks: string[] = [];

  if (regulatoryInference) {
    const conclusion = regulatoryInference.conclusion.toLowerCase();
    if (conclusion.includes("high") || conclusion.includes("elevated")) {
      risks.push("elevated regulatory burden");
      keyRisks.push("Regulatory compliance costs");
    }
    citations.push({ type: "inference", id: regulatoryInference.id });
  }

  if (stressInference) {
    const conclusion = stressInference.conclusion.toLowerCase();
    if (conclusion.includes("low")) {
      risks.push("economic sensitivity");
      keyRisks.push("Interest rate sensitivity");
    } else if (conclusion.includes("high") || conclusion.includes("moderate")) {
      // This is actually a strength, not a risk
    }
    citations.push({ type: "inference", id: stressInference.id });
  }

  if (executionInference) {
    const conclusion = executionInference.conclusion.toLowerCase();
    if (conclusion.includes("high") || conclusion.includes("elevated")) {
      risks.push("management execution risk");
      keyRisks.push("Management track record");
    }
    citations.push({ type: "inference", id: executionInference.id });
  }

  if (risks.length === 0) {
    return null;
  }

  const text = risks.length === 1
    ? `Key consideration: ${risks[0]}.`
    : `Key considerations: ${risks.join(" and ")}.`;

  return {
    text,
    citations,
    confidence: 0.75,
  };
}

function buildLenderFitInsight(
  lenderFitInference?: ResearchInference,
  keyStrengths: string[] = []
): IndustryUnderwritingInsight | null {
  if (!lenderFitInference) {
    return null;
  }

  const conclusion = lenderFitInference.conclusion.toLowerCase();
  let text: string;

  if (conclusion.includes("strong")) {
    text = "Strong lender program fit identified - multiple financing options available.";
    keyStrengths.push("SBA/USDA program eligibility");
  } else if (conclusion.includes("moderate")) {
    text = "Moderate lender program alignment - standard financing pathways accessible.";
    keyStrengths.push("Standard lending programs");
  } else {
    text = "Limited specialized program fit - may require conventional financing.";
  }

  return {
    text,
    citations: [{ type: "inference", id: lenderFitInference.id }],
    confidence: 0.7,
  };
}

function extractKeyRisksAndStrengths(
  inferences: ResearchInference[],
  keyRisks: string[],
  keyStrengths: string[]
): void {
  for (const inference of inferences) {
    const conclusion = inference.conclusion.toLowerCase();

    // Growth trajectory
    if (inference.inference_type === "growth_trajectory") {
      if (conclusion.includes("declining") || conclusion.includes("negative")) {
        keyRisks.push("Industry in decline");
      } else if (conclusion.includes("growing") || conclusion.includes("positive")) {
        keyStrengths.push("Growing industry");
      }
    }

    // Market attractiveness
    if (inference.inference_type === "market_attractiveness") {
      if (conclusion.includes("high") || conclusion.includes("attractive")) {
        keyStrengths.push("Attractive market fundamentals");
      }
    }

    // Geographic concentration
    if (inference.inference_type === "geographic_concentration") {
      if (conclusion.includes("high") || conclusion.includes("concentrated")) {
        keyRisks.push("Geographic concentration risk");
      } else {
        keyStrengths.push("Diversified geographic exposure");
      }
    }

    // Barrier to entry
    if (inference.inference_type === "barrier_to_entry") {
      if (conclusion.includes("high") || conclusion.includes("significant")) {
        keyStrengths.push("High barriers to entry");
      } else if (conclusion.includes("low")) {
        keyRisks.push("Low barriers to entry");
      }
    }
  }
}

// ============================================================================
// Action Recommendation
// ============================================================================

function determineRecommendedAction(
  context: UnderwritingContext,
  signals: Signals,
  insights: IndustryUnderwritingInsight[]
): RecommendedAction {
  // Check if we have enough information
  if (context.stance === "insufficient_information") {
    return "gather_more_documents";
  }

  // Check checklist completion
  if (context.checklist_completion_pct !== undefined && context.checklist_completion_pct < 60) {
    return "gather_more_documents";
  }

  // Check for management risk
  if (signals.hasManagementRisk) {
    return "verify_management_backgrounds";
  }

  // Check for stress testing needs
  if (!signals.hasStressResilience && context.scenario_breakpoint === undefined) {
    return "request_stress_scenarios";
  }

  // Check for favorable conditions
  if (
    context.stance === "favorable" &&
    signals.hasGrowth &&
    signals.hasDemandStability &&
    !signals.hasHighRegulation
  ) {
    return "proceed_to_committee";
  }

  // Check for concerning signals
  if (signals.hasHighRegulation && !signals.hasGrowth) {
    return "assess_collateral";
  }

  // Default: more investigation needed
  if (context.checklist_completion_pct && context.checklist_completion_pct >= 80) {
    return "conduct_site_visit";
  }

  return "gather_more_documents";
}

// ============================================================================
// Confidence Calculation
// ============================================================================

function calculateOverallConfidence(
  insights: IndustryUnderwritingInsight[],
  inferences: ResearchInference[]
): number {
  if (insights.length === 0) {
    return 0;
  }

  // Average insight confidence
  const avgInsightConfidence =
    insights.reduce((sum, i) => sum + i.confidence, 0) / insights.length;

  // Average inference confidence
  const avgInferenceConfidence =
    inferences.length > 0
      ? inferences.reduce((sum, i) => sum + i.confidence, 0) / inferences.length
      : 0.5;

  // Weight: 60% insights, 40% inferences
  return avgInsightConfidence * 0.6 + avgInferenceConfidence * 0.4;
}
