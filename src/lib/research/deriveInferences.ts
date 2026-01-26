/**
 * Inference Derivation Engine
 *
 * Derives conclusions from extracted facts.
 * Every inference MUST trace to input facts.
 * No hallucinations. Only explicit reasoning.
 */

import type {
  ResearchFact,
  ResearchInference,
  InferenceType,
  InferenceDerivationResult,
  EmploymentValue,
  CompetitorValue,
  NumericValue,
} from "./types";

type DerivedInference = Omit<ResearchInference, "id" | "mission_id" | "created_at">;

/**
 * Derive competitive intensity from competitor and employment facts.
 *
 * Scoring:
 * - Low: < 5 public competitors, stable employment
 * - Medium: 5-20 public competitors, moderate growth
 * - High: > 20 public competitors OR declining employment
 */
function deriveCompetitiveIntensity(facts: ResearchFact[]): DerivedInference | null {
  // Count competitor facts
  const competitorFacts = facts.filter((f) => f.fact_type === "competitor_name");
  const competitorCount = competitorFacts.length;

  // Get employment growth facts
  const employmentGrowthFacts = facts.filter((f) => f.fact_type === "employment_growth");
  const employmentFacts = facts.filter((f) => f.fact_type === "employment_count");

  // Need at least some data to make an inference
  if (competitorCount === 0 && employmentFacts.length === 0) {
    return null;
  }

  // Determine growth direction
  let growthPct: number | null = null;
  if (employmentGrowthFacts.length > 0) {
    const latestGrowth = employmentGrowthFacts[0];
    const value = latestGrowth.value as EmploymentValue;
    growthPct = value.change_pct ?? null;
  }

  // Score competitive intensity
  let intensity: "low" | "medium" | "high";
  let reasoning: string;

  if (competitorCount > 20 || (growthPct !== null && growthPct < -5)) {
    intensity = "high";
    reasoning = `High competitive intensity: ${competitorCount} public competitors identified`;
    if (growthPct !== null && growthPct < 0) {
      reasoning += `, employment declining ${Math.abs(growthPct).toFixed(1)}%`;
    }
  } else if (competitorCount >= 5 || (growthPct !== null && growthPct > 5)) {
    intensity = "medium";
    reasoning = `Moderate competitive intensity: ${competitorCount} public competitors`;
    if (growthPct !== null) {
      reasoning += `, employment ${growthPct > 0 ? "growing" : "stable"} at ${Math.abs(growthPct).toFixed(1)}%`;
    }
  } else {
    intensity = "low";
    reasoning = `Low competitive intensity: only ${competitorCount} public competitors identified`;
    if (growthPct !== null && growthPct >= 0) {
      reasoning += `, stable employment`;
    }
  }

  // Collect input fact IDs
  const inputFactIds = [
    ...competitorFacts.map((f) => f.id),
    ...employmentGrowthFacts.map((f) => f.id),
    ...employmentFacts.slice(0, 3).map((f) => f.id), // Limit to avoid huge arrays
  ];

  return {
    inference_type: "competitive_intensity",
    conclusion: `${intensity.toUpperCase()} competitive intensity in this industry.`,
    input_fact_ids: inputFactIds,
    confidence: competitorCount > 10 ? 0.85 : 0.7,
    reasoning,
  };
}

/**
 * Derive market attractiveness from market size and growth facts.
 */
function deriveMarketAttractiveness(facts: ResearchFact[]): DerivedInference | null {
  const marketSizeFacts = facts.filter((f) => f.fact_type === "market_size");
  const establishmentFacts = facts.filter((f) => f.fact_type === "establishment_count");
  const employmentFacts = facts.filter((f) => f.fact_type === "employment_count");

  // Need some data
  if (marketSizeFacts.length === 0 && establishmentFacts.length === 0 && employmentFacts.length === 0) {
    return null;
  }

  // Calculate market size (if available)
  let marketSizeUsd: number | null = null;
  if (marketSizeFacts.length > 0) {
    const sizeFact = marketSizeFacts[0];
    const value = sizeFact.value as { amount: number; currency: string };
    if (value.currency === "USD") {
      marketSizeUsd = value.amount;
    }
  }

  // Get establishment count
  let totalEstablishments = 0;
  for (const fact of establishmentFacts) {
    const value = fact.value as NumericValue;
    totalEstablishments += value.value;
  }

  // Get employment count
  let totalEmployment = 0;
  for (const fact of employmentFacts) {
    const value = fact.value as EmploymentValue;
    totalEmployment += value.count;
  }

  // Determine attractiveness
  let attractiveness: "high" | "medium" | "low";
  let reasoning = "";

  if (marketSizeUsd !== null && marketSizeUsd > 100_000_000_000) {
    // > $100B market
    attractiveness = "high";
    reasoning = `Large market: $${(marketSizeUsd / 1_000_000_000).toFixed(1)}B total receipts`;
  } else if (totalEmployment > 1_000_000) {
    attractiveness = "high";
    reasoning = `Significant employment base: ${(totalEmployment / 1_000_000).toFixed(2)}M workers`;
  } else if (totalEstablishments > 50_000 || totalEmployment > 500_000) {
    attractiveness = "medium";
    reasoning = `Moderate market: ${totalEstablishments.toLocaleString()} establishments, ${totalEmployment.toLocaleString()} workers`;
  } else {
    attractiveness = "low";
    reasoning = `Smaller market segment: ${totalEstablishments.toLocaleString()} establishments`;
  }

  const inputFactIds = [
    ...marketSizeFacts.map((f) => f.id),
    ...establishmentFacts.slice(0, 3).map((f) => f.id),
    ...employmentFacts.slice(0, 3).map((f) => f.id),
  ];

  return {
    inference_type: "market_attractiveness",
    conclusion: `${attractiveness.toUpperCase()} market attractiveness.`,
    input_fact_ids: inputFactIds,
    confidence: marketSizeUsd !== null ? 0.85 : 0.7,
    reasoning,
  };
}

/**
 * Derive growth trajectory from employment and wage trends.
 */
function deriveGrowthTrajectory(facts: ResearchFact[]): DerivedInference | null {
  const employmentGrowthFacts = facts.filter((f) => f.fact_type === "employment_growth");
  const wageFacts = facts.filter((f) => f.fact_type === "average_wage");

  if (employmentGrowthFacts.length === 0 && wageFacts.length === 0) {
    return null;
  }

  // Get employment growth
  let growthPct: number | null = null;
  if (employmentGrowthFacts.length > 0) {
    const value = employmentGrowthFacts[0].value as EmploymentValue;
    growthPct = value.change_pct ?? null;
  }

  // Get average wage
  let avgWage: number | null = null;
  if (wageFacts.length > 0) {
    const value = wageFacts[0].value as NumericValue;
    avgWage = value.value;
  }

  // Determine trajectory
  let trajectory: "expanding" | "stable" | "contracting";
  let reasoning = "";

  if (growthPct !== null) {
    if (growthPct > 5) {
      trajectory = "expanding";
      reasoning = `Employment growing ${growthPct.toFixed(1)}% over 5 years`;
    } else if (growthPct < -5) {
      trajectory = "contracting";
      reasoning = `Employment declining ${Math.abs(growthPct).toFixed(1)}% over 5 years`;
    } else {
      trajectory = "stable";
      reasoning = `Employment relatively stable (${growthPct > 0 ? "+" : ""}${growthPct.toFixed(1)}% over 5 years)`;
    }

    if (avgWage !== null) {
      reasoning += `. Average wage: $${avgWage.toLocaleString()}/year`;
    }
  } else if (avgWage !== null) {
    // Only wage data available
    trajectory = "stable";
    reasoning = `Industry average wage: $${avgWage.toLocaleString()}/year`;
  } else {
    return null;
  }

  const inputFactIds = [
    ...employmentGrowthFacts.map((f) => f.id),
    ...wageFacts.map((f) => f.id),
  ];

  return {
    inference_type: "growth_trajectory",
    conclusion: `Industry is ${trajectory.toUpperCase()}.`,
    input_fact_ids: inputFactIds,
    confidence: growthPct !== null ? 0.85 : 0.6,
    reasoning,
  };
}

/**
 * Derive tailwinds and headwinds from growth and market data.
 */
function deriveTailwindsHeadwinds(facts: ResearchFact[]): DerivedInference[] {
  const inferences: DerivedInference[] = [];

  const employmentGrowthFacts = facts.filter((f) => f.fact_type === "employment_growth");
  const marketSizeFacts = facts.filter((f) => f.fact_type === "market_size");
  const wageFacts = facts.filter((f) => f.fact_type === "average_wage");

  // Check for tailwinds
  if (employmentGrowthFacts.length > 0) {
    const value = employmentGrowthFacts[0].value as EmploymentValue;
    const growthPct = value.change_pct;

    if (growthPct !== undefined && growthPct > 5) {
      inferences.push({
        inference_type: "tailwind",
        conclusion: `Strong employment growth (+${growthPct.toFixed(1)}% over 5 years) indicates favorable industry dynamics.`,
        input_fact_ids: [employmentGrowthFacts[0].id],
        confidence: 0.8,
        reasoning: "Employment growth above 5% over 5 years suggests structural demand growth.",
      });
    }

    if (growthPct !== undefined && growthPct < -5) {
      inferences.push({
        inference_type: "headwind",
        conclusion: `Employment decline (${growthPct.toFixed(1)}% over 5 years) suggests industry contraction or automation pressures.`,
        input_fact_ids: [employmentGrowthFacts[0].id],
        confidence: 0.8,
        reasoning: "Employment decline above 5% indicates structural challenges.",
      });
    }
  }

  // Wage-based inference
  if (wageFacts.length > 0) {
    const value = wageFacts[0].value as NumericValue;
    const avgWage = value.value;

    if (avgWage > 80_000) {
      inferences.push({
        inference_type: "tailwind",
        conclusion: `High average wages ($${avgWage.toLocaleString()}/year) suggest skilled workforce and potentially higher margins.`,
        input_fact_ids: [wageFacts[0].id],
        confidence: 0.7,
        reasoning: "Industries with higher wages often have specialized skills and pricing power.",
      });
    } else if (avgWage < 35_000) {
      inferences.push({
        inference_type: "headwind",
        conclusion: `Lower average wages ($${avgWage.toLocaleString()}/year) may indicate labor intensity and margin pressure.`,
        input_fact_ids: [wageFacts[0].id],
        confidence: 0.7,
        reasoning: "Lower-wage industries often face tighter margins and labor challenges.",
      });
    }
  }

  return inferences;
}

/**
 * Main inference derivation function.
 * Takes all facts from a mission and derives inferences.
 */
export function deriveInferences(facts: ResearchFact[]): InferenceDerivationResult {
  const inferences: DerivedInference[] = [];

  // 1. Competitive intensity
  const competitiveIntensity = deriveCompetitiveIntensity(facts);
  if (competitiveIntensity) {
    inferences.push(competitiveIntensity);
  }

  // 2. Market attractiveness
  const marketAttractiveness = deriveMarketAttractiveness(facts);
  if (marketAttractiveness) {
    inferences.push(marketAttractiveness);
  }

  // 3. Growth trajectory
  const growthTrajectory = deriveGrowthTrajectory(facts);
  if (growthTrajectory) {
    inferences.push(growthTrajectory);
  }

  // 4. Tailwinds and headwinds
  const tailwindsHeadwinds = deriveTailwindsHeadwinds(facts);
  inferences.push(...tailwindsHeadwinds);

  return { inferences };
}

/**
 * Check if we have enough facts to derive meaningful inferences.
 */
export function hasEnoughFactsForInferences(facts: ResearchFact[]): boolean {
  // Need at least 3 facts to make any meaningful inferences
  return facts.length >= 3;
}
