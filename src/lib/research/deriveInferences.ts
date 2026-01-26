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
 * Derive demand stability from population and income trends.
 * Key for market_demand missions.
 */
function deriveDemandStability(facts: ResearchFact[]): DerivedInference | null {
  const populationFacts = facts.filter((f) => f.fact_type === "population");
  const incomeFacts = facts.filter((f) => f.fact_type === "median_income");
  const growthRateFacts = facts.filter(
    (f) => f.fact_type === "other" && (f.value as { category?: string }).category === "population_growth_rate"
  );

  if (populationFacts.length === 0 && incomeFacts.length === 0) {
    return null;
  }

  // Use a score-based approach that TypeScript can follow
  let stabilityScore = 1; // 0=low, 1=medium, 2=high
  const reasons: string[] = [];

  // Population growth assessment
  if (growthRateFacts.length > 0) {
    const growthRate = parseFloat((growthRateFacts[0].value as { text: string }).text);
    if (!isNaN(growthRate)) {
      if (growthRate > 1.0) {
        reasons.push(`population growing ${growthRate.toFixed(2)}% annually`);
        stabilityScore = 2;
      } else if (growthRate > 0) {
        reasons.push(`population stable (+${growthRate.toFixed(2)}%)`);
      } else if (growthRate > -0.5) {
        reasons.push(`population slightly declining (${growthRate.toFixed(2)}%)`);
        if (stabilityScore > 1) stabilityScore = 1;
      } else {
        reasons.push(`population declining (${growthRate.toFixed(2)}%)`);
        stabilityScore = 0;
      }
    }
  }

  // Income assessment
  if (incomeFacts.length > 0) {
    const incomeValue = incomeFacts[0].value as NumericValue;
    const medianIncome = incomeValue.value;
    const geography = incomeValue.geography ?? "area";

    // US national median is ~$75k
    if (medianIncome > 85000) {
      reasons.push(`above-average median income ($${medianIncome.toLocaleString()}) in ${geography}`);
      if (stabilityScore > 0) stabilityScore = 2;
    } else if (medianIncome > 60000) {
      reasons.push(`moderate median income ($${medianIncome.toLocaleString()}) in ${geography}`);
    } else {
      reasons.push(`below-average median income ($${medianIncome.toLocaleString()}) in ${geography}`);
      if (stabilityScore > 1) stabilityScore = 1;
    }
  }

  // Total population assessment
  if (populationFacts.length > 0) {
    const popValue = populationFacts[0].value as NumericValue;
    const population = popValue.value;
    const geography = popValue.geography ?? "area";

    if (population > 1_000_000) {
      reasons.push(`substantial population base (${(population / 1_000_000).toFixed(2)}M) in ${geography}`);
    } else if (population > 100_000) {
      reasons.push(`moderate population (${(population / 1_000).toFixed(0)}K) in ${geography}`);
    } else {
      reasons.push(`smaller population (${population.toLocaleString()}) limits demand ceiling`);
      if (stabilityScore > 1) stabilityScore = 1;
    }
  }

  if (reasons.length === 0) return null;

  // Convert score to text
  const stability = stabilityScore === 2 ? "high" : stabilityScore === 0 ? "low" : "medium";

  const inputFactIds = [
    ...populationFacts.slice(0, 3).map((f) => f.id),
    ...incomeFacts.slice(0, 2).map((f) => f.id),
    ...growthRateFacts.slice(0, 2).map((f) => f.id),
  ];

  return {
    inference_type: "other",
    conclusion: `${stability.toUpperCase()} demand stability: ${reasons.join("; ")}.`,
    input_fact_ids: inputFactIds,
    confidence: reasons.length >= 2 ? 0.85 : 0.7,
    reasoning: `Demand stability assessed based on ${reasons.length} demographic indicators.`,
  };
}

/**
 * Derive geographic concentration risk from demographic spread.
 */
function deriveGeographicConcentration(facts: ResearchFact[]): DerivedInference | null {
  const populationFacts = facts.filter((f) => f.fact_type === "population");
  const incomeFacts = facts.filter((f) => f.fact_type === "median_income");

  // Need multiple geographic areas to assess concentration
  if (populationFacts.length < 2) {
    return null;
  }

  // Extract unique geographies
  const geographies = new Set<string>();
  for (const fact of [...populationFacts, ...incomeFacts]) {
    const value = fact.value as NumericValue;
    if (value.geography) {
      geographies.add(value.geography);
    }
  }

  let concentration: "high" | "medium" | "low";
  let reasoning: string;

  if (geographies.size === 1) {
    concentration = "high";
    reasoning = `Data from single geography (${[...geographies][0]}); high geographic concentration risk`;
  } else if (geographies.size <= 3) {
    concentration = "medium";
    reasoning = `Data from ${geographies.size} geographies; moderate geographic diversification`;
  } else {
    concentration = "low";
    reasoning = `Data from ${geographies.size} geographies; good geographic diversification`;
  }

  const inputFactIds = populationFacts.slice(0, 5).map((f) => f.id);

  return {
    inference_type: "geographic_concentration",
    conclusion: `${concentration.toUpperCase()} geographic concentration.`,
    input_fact_ids: inputFactIds,
    confidence: 0.75,
    reasoning,
  };
}

/**
 * Derive demographic tailwinds/headwinds from population and income trends.
 */
function deriveDemographicTailwindsHeadwinds(facts: ResearchFact[]): DerivedInference[] {
  const inferences: DerivedInference[] = [];

  // Population growth tailwind/headwind
  const growthRateFacts = facts.filter(
    (f) => f.fact_type === "other" && (f.value as { category?: string }).category === "population_growth_rate"
  );

  if (growthRateFacts.length > 0) {
    const growthRate = parseFloat((growthRateFacts[0].value as { text: string }).text);
    if (!isNaN(growthRate)) {
      if (growthRate > 1.5) {
        inferences.push({
          inference_type: "tailwind",
          conclusion: `Strong population growth (+${growthRate.toFixed(2)}% annually) drives organic demand expansion.`,
          input_fact_ids: [growthRateFacts[0].id],
          confidence: 0.85,
          reasoning: "Population growth above 1.5% creates natural demand tailwind.",
        });
      } else if (growthRate < -0.5) {
        inferences.push({
          inference_type: "headwind",
          conclusion: `Population decline (${growthRate.toFixed(2)}% annually) may constrain long-term demand.`,
          input_fact_ids: [growthRateFacts[0].id],
          confidence: 0.8,
          reasoning: "Population decline creates structural demand headwind.",
        });
      }
    }
  }

  // Income-based tailwind/headwind
  const incomeFacts = facts.filter((f) => f.fact_type === "median_income");
  if (incomeFacts.length > 0) {
    const incomeValue = incomeFacts[0].value as NumericValue;
    const medianIncome = incomeValue.value;

    if (medianIncome > 100000) {
      inferences.push({
        inference_type: "tailwind",
        conclusion: `High median income ($${medianIncome.toLocaleString()}) indicates strong purchasing power.`,
        input_fact_ids: [incomeFacts[0].id],
        confidence: 0.8,
        reasoning: "Above-average income supports premium pricing and higher-margin services.",
      });
    } else if (medianIncome < 50000) {
      inferences.push({
        inference_type: "headwind",
        conclusion: `Below-average median income ($${medianIncome.toLocaleString()}) may limit discretionary spending.`,
        input_fact_ids: [incomeFacts[0].id],
        confidence: 0.75,
        reasoning: "Lower income levels may constrain demand for non-essential goods/services.",
      });
    }
  }

  // Education-based (workforce quality) tailwind
  const educationFacts = facts.filter(
    (f) => f.fact_type === "other" && (f.value as { category?: string }).category === "college_educated_pct"
  );
  if (educationFacts.length > 0) {
    const educationPct = parseFloat((educationFacts[0].value as { text: string }).text);
    if (!isNaN(educationPct) && educationPct > 35) {
      inferences.push({
        inference_type: "tailwind",
        conclusion: `Highly educated workforce (${educationPct.toFixed(1)}% college-educated) supports knowledge-based services.`,
        input_fact_ids: [educationFacts[0].id],
        confidence: 0.75,
        reasoning: "Higher education levels correlate with professional services demand.",
      });
    }
  }

  // Housing market health (as proxy for local economy)
  const homeValueFacts = facts.filter(
    (f) => f.fact_type === "other" && (f.value as { category?: string }).category === "median_home_value"
  );
  if (homeValueFacts.length > 0) {
    const homeValue = parseFloat((homeValueFacts[0].value as { text: string }).text);
    if (!isNaN(homeValue)) {
      if (homeValue > 400000) {
        inferences.push({
          inference_type: "tailwind",
          conclusion: `High home values ($${homeValue.toLocaleString()}) indicate affluent market with strong local economy.`,
          input_fact_ids: [homeValueFacts[0].id],
          confidence: 0.7,
          reasoning: "High property values correlate with economic prosperity and consumer spending.",
        });
      }
    }
  }

  return inferences;
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

  // 4. Demand stability (from demographics)
  const demandStability = deriveDemandStability(facts);
  if (demandStability) {
    inferences.push(demandStability);
  }

  // 5. Geographic concentration
  const geoConcentration = deriveGeographicConcentration(facts);
  if (geoConcentration) {
    inferences.push(geoConcentration);
  }

  // 6. Tailwinds and headwinds (industry)
  const tailwindsHeadwinds = deriveTailwindsHeadwinds(facts);
  inferences.push(...tailwindsHeadwinds);

  // 7. Demographic tailwinds and headwinds
  const demoTailwindsHeadwinds = deriveDemographicTailwindsHeadwinds(facts);
  inferences.push(...demoTailwindsHeadwinds);

  return { inferences };
}

/**
 * Check if we have enough facts to derive meaningful inferences.
 */
export function hasEnoughFactsForInferences(facts: ResearchFact[]): boolean {
  // Need at least 3 facts to make any meaningful inferences
  return facts.length >= 3;
}
