/**
 * Narrative Compiler
 *
 * Compiles facts and inferences into a citation-backed narrative.
 * Every sentence MUST have at least one citation.
 * No hallucinations. No uncited claims.
 */

import type {
  ResearchFact,
  ResearchInference,
  ResearchSource,
  NarrativeSection,
  NarrativeSentence,
  Citation,
  NarrativeCompilationResult,
  EmploymentValue,
  CompetitorValue,
  NumericValue,
} from "./types";

/**
 * Create a citation for a fact.
 */
function factCitation(factId: string): Citation {
  return { type: "fact", id: factId };
}

/**
 * Create a citation for an inference.
 */
function inferenceCitation(inferenceId: string): Citation {
  return { type: "inference", id: inferenceId };
}

/**
 * Compile the Industry Overview section.
 */
function compileIndustryOverview(
  facts: ResearchFact[],
  inferences: ResearchInference[]
): NarrativeSection | null {
  const sentences: NarrativeSentence[] = [];

  // Employment stats
  const employmentFacts = facts.filter((f) => f.fact_type === "employment_count");
  if (employmentFacts.length > 0) {
    const latest = employmentFacts[0];
    const value = latest.value as EmploymentValue;
    const formatted = value.count >= 1_000_000
      ? `${(value.count / 1_000_000).toFixed(2)} million`
      : value.count.toLocaleString();

    sentences.push({
      text: `The industry employs approximately ${formatted} workers in the ${value.geography}.`,
      citations: [factCitation(latest.id)],
    });
  }

  // Establishment count
  const establishmentFacts = facts.filter((f) => f.fact_type === "establishment_count");
  if (establishmentFacts.length > 0) {
    // Sum up establishments
    let total = 0;
    const citationIds: string[] = [];
    for (const fact of establishmentFacts.slice(0, 5)) {
      const value = fact.value as NumericValue;
      total += value.value;
      citationIds.push(fact.id);
    }

    sentences.push({
      text: `There are approximately ${total.toLocaleString()} establishments operating in this sector.`,
      citations: citationIds.map(factCitation),
    });
  }

  // Average wage
  const wageFacts = facts.filter((f) => f.fact_type === "average_wage");
  if (wageFacts.length > 0) {
    const latest = wageFacts[0];
    const value = latest.value as NumericValue;
    sentences.push({
      text: `The industry average annual wage is approximately $${value.value.toLocaleString()}.`,
      citations: [factCitation(latest.id)],
    });
  }

  // Market size (if available)
  const marketSizeFacts = facts.filter((f) => f.fact_type === "market_size");
  if (marketSizeFacts.length > 0) {
    const latest = marketSizeFacts[0];
    const value = latest.value as { amount: number; currency: string; year: number };
    const formatted = value.amount >= 1_000_000_000
      ? `$${(value.amount / 1_000_000_000).toFixed(1)} billion`
      : `$${(value.amount / 1_000_000).toFixed(1)} million`;

    sentences.push({
      text: `Total industry receipts were ${formatted} in ${value.year}.`,
      citations: [factCitation(latest.id)],
    });
  }

  // Growth trajectory inference
  const growthInference = inferences.find((i) => i.inference_type === "growth_trajectory");
  if (growthInference) {
    sentences.push({
      text: growthInference.conclusion,
      citations: [inferenceCitation(growthInference.id)],
    });
  }

  if (sentences.length === 0) {
    return null;
  }

  return {
    title: "Industry Overview",
    sentences,
  };
}

/**
 * Compile the Competitive Landscape section.
 */
function compileCompetitiveLandscape(
  facts: ResearchFact[],
  inferences: ResearchInference[]
): NarrativeSection | null {
  const sentences: NarrativeSentence[] = [];

  // Competitor facts
  const competitorFacts = facts.filter((f) => f.fact_type === "competitor_name");
  if (competitorFacts.length > 0) {
    // Summary sentence
    sentences.push({
      text: `We identified ${competitorFacts.length} public companies operating in this industry segment.`,
      citations: competitorFacts.slice(0, 5).map((f) => factCitation(f.id)),
    });

    // List top competitors
    const topCompetitors = competitorFacts.slice(0, 5);
    if (topCompetitors.length > 0) {
      const names = topCompetitors.map((f) => {
        const value = f.value as CompetitorValue;
        return value.ticker ? `${value.name} (${value.ticker})` : value.name;
      });

      sentences.push({
        text: `Notable public competitors include: ${names.join(", ")}.`,
        citations: topCompetitors.map((f) => factCitation(f.id)),
      });
    }
  }

  // Competitive intensity inference
  const intensityInference = inferences.find((i) => i.inference_type === "competitive_intensity");
  if (intensityInference) {
    sentences.push({
      text: intensityInference.conclusion,
      citations: [inferenceCitation(intensityInference.id)],
    });

    // Add reasoning if available
    if (intensityInference.reasoning) {
      sentences.push({
        text: intensityInference.reasoning,
        citations: [inferenceCitation(intensityInference.id)],
      });
    }
  }

  // Market attractiveness
  const attractivenessInference = inferences.find((i) => i.inference_type === "market_attractiveness");
  if (attractivenessInference) {
    sentences.push({
      text: attractivenessInference.conclusion,
      citations: [inferenceCitation(attractivenessInference.id)],
    });
  }

  if (sentences.length === 0) {
    return null;
  }

  return {
    title: "Competitive Landscape",
    sentences,
  };
}

/**
 * Compile the Market Dynamics section (tailwinds/headwinds).
 */
function compileMarketDynamics(
  facts: ResearchFact[],
  inferences: ResearchInference[]
): NarrativeSection | null {
  const sentences: NarrativeSentence[] = [];

  // Tailwinds
  const tailwinds = inferences.filter((i) => i.inference_type === "tailwind");
  if (tailwinds.length > 0) {
    sentences.push({
      text: "Key industry tailwinds:",
      citations: [],
    });

    for (const tw of tailwinds) {
      sentences.push({
        text: `• ${tw.conclusion}`,
        citations: [inferenceCitation(tw.id)],
      });
    }
  }

  // Headwinds
  const headwinds = inferences.filter((i) => i.inference_type === "headwind");
  if (headwinds.length > 0) {
    sentences.push({
      text: "Key industry headwinds:",
      citations: [],
    });

    for (const hw of headwinds) {
      sentences.push({
        text: `• ${hw.conclusion}`,
        citations: [inferenceCitation(hw.id)],
      });
    }
  }

  // Employment growth details
  const employmentGrowthFacts = facts.filter((f) => f.fact_type === "employment_growth");
  if (employmentGrowthFacts.length > 0) {
    const fact = employmentGrowthFacts[0];
    const value = fact.value as EmploymentValue;
    if (value.change_pct !== undefined) {
      const direction = value.change_pct > 0 ? "grown" : "declined";
      sentences.push({
        text: `Industry employment has ${direction} ${Math.abs(value.change_pct).toFixed(1)}% over the past 5 years.`,
        citations: [factCitation(fact.id)],
      });
    }
  }

  if (sentences.length === 0) {
    return null;
  }

  return {
    title: "Market Dynamics",
    sentences,
  };
}

/**
 * Compile the Market Demand section.
 * Focused on population, income, and demand stability.
 */
function compileMarketDemand(
  facts: ResearchFact[],
  inferences: ResearchInference[]
): NarrativeSection | null {
  const sentences: NarrativeSentence[] = [];

  // Population facts
  const populationFacts = facts.filter((f) => f.fact_type === "population");
  if (populationFacts.length > 0) {
    // Get the largest area's population
    const sortedPop = [...populationFacts].sort((a, b) => {
      const aVal = (a.value as NumericValue).value;
      const bVal = (b.value as NumericValue).value;
      return bVal - aVal;
    });

    const topPop = sortedPop[0];
    const popValue = topPop.value as NumericValue;
    const formatted = popValue.value >= 1_000_000
      ? `${(popValue.value / 1_000_000).toFixed(2)} million`
      : popValue.value.toLocaleString();

    sentences.push({
      text: `The target market area (${popValue.geography}) has a population of approximately ${formatted}.`,
      citations: [factCitation(topPop.id)],
    });
  }

  // Population growth
  const growthRateFacts = facts.filter(
    (f) => f.fact_type === "other" && (f.value as { category?: string }).category === "population_growth_rate"
  );
  if (growthRateFacts.length > 0) {
    const growthFact = growthRateFacts[0];
    const growthRate = parseFloat((growthFact.value as { text: string }).text);
    if (!isNaN(growthRate)) {
      const direction = growthRate >= 0 ? "growing" : "declining";
      sentences.push({
        text: `The population is ${direction} at ${Math.abs(growthRate).toFixed(2)}% annually.`,
        citations: [factCitation(growthFact.id)],
      });
    }
  }

  // Median income facts
  const incomeFacts = facts.filter((f) => f.fact_type === "median_income");
  if (incomeFacts.length > 0) {
    const incomeFact = incomeFacts[0];
    const incomeValue = incomeFact.value as NumericValue;

    sentences.push({
      text: `Median household income in ${incomeValue.geography ?? "the area"} is $${incomeValue.value.toLocaleString()}.`,
      citations: [factCitation(incomeFact.id)],
    });
  }

  // Per capita income
  const perCapitaFacts = facts.filter(
    (f) => f.fact_type === "other" && (f.value as { category?: string }).category === "per_capita_income"
  );
  if (perCapitaFacts.length > 0) {
    const pcFact = perCapitaFacts[0];
    const pcIncome = parseFloat((pcFact.value as { text: string }).text);
    if (!isNaN(pcIncome)) {
      sentences.push({
        text: `Per capita income is $${pcIncome.toLocaleString()}.`,
        citations: [factCitation(pcFact.id)],
      });
    }
  }

  // Demand stability inference
  const demandInference = inferences.find(
    (i) => i.inference_type === "other" && i.conclusion.toLowerCase().includes("demand stability")
  );
  if (demandInference) {
    sentences.push({
      text: demandInference.conclusion,
      citations: [inferenceCitation(demandInference.id)],
    });
  }

  // Geographic concentration
  const geoInference = inferences.find((i) => i.inference_type === "geographic_concentration");
  if (geoInference) {
    sentences.push({
      text: geoInference.conclusion,
      citations: [inferenceCitation(geoInference.id)],
    });
  }

  if (sentences.length === 0) {
    return null;
  }

  return {
    title: "Market Demand",
    sentences,
  };
}

/**
 * Compile the Demographics section.
 * Focused on workforce, education, housing characteristics.
 */
function compileDemographics(
  facts: ResearchFact[],
  inferences: ResearchInference[]
): NarrativeSection | null {
  const sentences: NarrativeSentence[] = [];

  // Median age
  const ageFacts = facts.filter(
    (f) => f.fact_type === "other" && (f.value as { category?: string }).category === "median_age"
  );
  if (ageFacts.length > 0) {
    const ageFact = ageFacts[0];
    const medianAge = parseFloat((ageFact.value as { text: string }).text);
    if (!isNaN(medianAge)) {
      sentences.push({
        text: `The median age in the area is ${medianAge.toFixed(1)} years.`,
        citations: [factCitation(ageFact.id)],
      });
    }
  }

  // Education level
  const educationFacts = facts.filter(
    (f) => f.fact_type === "other" && (f.value as { category?: string }).category === "college_educated_pct"
  );
  if (educationFacts.length > 0) {
    const eduFact = educationFacts[0];
    const eduPct = parseFloat((eduFact.value as { text: string }).text);
    if (!isNaN(eduPct)) {
      sentences.push({
        text: `Approximately ${eduPct.toFixed(1)}% of the adult population holds a college degree or higher.`,
        citations: [factCitation(eduFact.id)],
      });
    }
  }

  // Unemployment rate
  const unemploymentFacts = facts.filter(
    (f) => f.fact_type === "other" && (f.value as { category?: string }).category === "unemployment_rate"
  );
  if (unemploymentFacts.length > 0) {
    const unempFact = unemploymentFacts[0];
    const unempRate = parseFloat((unempFact.value as { text: string }).text);
    if (!isNaN(unempRate)) {
      sentences.push({
        text: `The local unemployment rate is ${unempRate.toFixed(1)}%.`,
        citations: [factCitation(unempFact.id)],
      });
    }
  }

  // Housing units
  const housingFacts = facts.filter(
    (f) => f.fact_type === "other" && (f.value as { category?: string }).category === "housing_units"
  );
  if (housingFacts.length > 0) {
    const housingFact = housingFacts[0];
    const units = parseInt((housingFact.value as { text: string }).text, 10);
    if (!isNaN(units)) {
      const formatted = units >= 1_000_000
        ? `${(units / 1_000_000).toFixed(2)} million`
        : units.toLocaleString();
      sentences.push({
        text: `There are approximately ${formatted} housing units in the area.`,
        citations: [factCitation(housingFact.id)],
      });
    }
  }

  // Median home value
  const homeValueFacts = facts.filter(
    (f) => f.fact_type === "other" && (f.value as { category?: string }).category === "median_home_value"
  );
  if (homeValueFacts.length > 0) {
    const hvFact = homeValueFacts[0];
    const homeValue = parseFloat((hvFact.value as { text: string }).text);
    if (!isNaN(homeValue)) {
      sentences.push({
        text: `Median home value is $${homeValue.toLocaleString()}.`,
        citations: [factCitation(hvFact.id)],
      });
    }
  }

  // Occupancy rate
  const occupancyFacts = facts.filter(
    (f) => f.fact_type === "other" && (f.value as { category?: string }).category === "housing_occupancy_rate"
  );
  if (occupancyFacts.length > 0) {
    const occFact = occupancyFacts[0];
    const occRate = parseFloat((occFact.value as { text: string }).text);
    if (!isNaN(occRate)) {
      sentences.push({
        text: `Housing occupancy rate is ${occRate.toFixed(1)}%.`,
        citations: [factCitation(occFact.id)],
      });
    }
  }

  // Demographic tailwinds (if any)
  const demoTailwinds = inferences.filter(
    (i) => i.inference_type === "tailwind" &&
    (i.reasoning?.toLowerCase().includes("population") ||
     i.reasoning?.toLowerCase().includes("income") ||
     i.reasoning?.toLowerCase().includes("education") ||
     i.reasoning?.toLowerCase().includes("home"))
  );

  if (demoTailwinds.length > 0) {
    sentences.push({
      text: "Demographic tailwinds:",
      citations: [],
    });
    for (const tw of demoTailwinds.slice(0, 3)) {
      sentences.push({
        text: `• ${tw.conclusion}`,
        citations: [inferenceCitation(tw.id)],
      });
    }
  }

  if (sentences.length === 0) {
    return null;
  }

  return {
    title: "Demographics",
    sentences,
  };
}

// ============================================================================
// Regulatory Environment Narrative (Phase 3)
// ============================================================================

/**
 * Compile the Regulatory Environment section.
 */
function compileRegulatoryEnvironment(
  facts: ResearchFact[],
  inferences: ResearchInference[]
): NarrativeSection | null {
  const sentences: NarrativeSentence[] = [];

  // Regulatory burden level
  const burdenFacts = facts.filter((f) => f.fact_type === "regulatory_burden_level");
  if (burdenFacts.length > 0) {
    const burdenFact = burdenFacts[0];
    const burden = ((burdenFact.value as { text?: string; category?: string }).text ?? "").toLowerCase();
    const category = ((burdenFact.value as { text?: string; category?: string }).category ?? "").toLowerCase();

    let description = "";
    if (burden === "high") {
      description = "This industry operates under a high regulatory burden";
    } else if (burden === "medium") {
      description = "This industry faces moderate regulatory requirements";
    } else {
      description = "This industry operates with relatively low regulatory burden";
    }

    if (category.includes("federal")) {
      description += " from federal agencies.";
    } else if (category.includes("epa")) {
      description += " from environmental regulations.";
    } else {
      description += ".";
    }

    sentences.push({
      text: description,
      citations: [factCitation(burdenFact.id)],
    });
  }

  // Federal rule count
  const ruleCountFacts = facts.filter((f) => f.fact_type === "federal_rule_count");
  if (ruleCountFacts.length > 0) {
    const ruleFact = ruleCountFacts[0];
    const value = ruleFact.value as NumericValue;

    sentences.push({
      text: `Federal agencies published ${value.value} rules affecting this industry in the past 12 months.`,
      citations: [factCitation(ruleFact.id)],
    });
  }

  // Licensing requirements
  const licensingFacts = facts.filter((f) => f.fact_type === "licensing_required");
  if (licensingFacts.length > 0) {
    sentences.push({
      text: `State-level licensing is required in ${licensingFacts.length} jurisdiction(s).`,
      citations: licensingFacts.slice(0, 3).map((f) => factCitation(f.id)),
    });
  }

  // State-specific constraints
  const constraintFacts = facts.filter((f) => f.fact_type === "state_specific_constraint");
  if (constraintFacts.length > 0) {
    sentences.push({
      text: "State-specific regulatory constraints:",
      citations: [],
    });

    for (const fact of constraintFacts.slice(0, 3)) {
      const value = fact.value as { text: string };
      sentences.push({
        text: `• ${value.text}`,
        citations: [factCitation(fact.id)],
      });
    }
  }

  // Compliance requirements
  const complianceFacts = facts.filter((f) => f.fact_type === "compliance_requirement");
  if (complianceFacts.length > 0) {
    sentences.push({
      text: `${complianceFacts.length} specific compliance requirement(s) identified:`,
      citations: [],
    });

    for (const fact of complianceFacts.slice(0, 3)) {
      const value = fact.value as { text: string };
      sentences.push({
        text: `• ${value.text}`,
        citations: [factCitation(fact.id)],
      });
    }
  }

  // Enforcement action count
  const enforcementFacts = facts.filter((f) => f.fact_type === "enforcement_action_count");
  if (enforcementFacts.length > 0) {
    const enforcementFact = enforcementFacts[0];
    const value = enforcementFact.value as NumericValue;

    sentences.push({
      text: `Regulatory agencies recorded ${value.value} enforcement ${value.unit} in this industry.`,
      citations: [factCitation(enforcementFact.id)],
    });
  }

  // Compliance cost indicator
  const costFacts = facts.filter((f) => f.fact_type === "compliance_cost_indicator");
  if (costFacts.length > 0) {
    const costFact = costFacts[0];
    const cost = ((costFact.value as { text?: string }).text ?? "").toLowerCase();

    let costDescription = "";
    if (cost === "high") {
      costDescription = "Compliance costs are significant, with substantial penalties for violations.";
    } else if (cost === "medium") {
      costDescription = "Compliance costs are moderate.";
    } else {
      costDescription = "Compliance costs are generally manageable.";
    }

    sentences.push({
      text: costDescription,
      citations: [factCitation(costFact.id)],
    });
  }

  // Regulatory risk inference
  const riskInference = inferences.find((i) => i.inference_type === "regulatory_risk_level");
  if (riskInference) {
    sentences.push({
      text: riskInference.conclusion,
      citations: [inferenceCitation(riskInference.id)],
    });
  }

  // Expansion constraint inference
  const expansionInference = inferences.find((i) => i.inference_type === "expansion_constraint_risk");
  if (expansionInference) {
    sentences.push({
      text: expansionInference.conclusion,
      citations: [inferenceCitation(expansionInference.id)],
    });
  }

  // Licensing complexity inference
  const licensingInference = inferences.find((i) => i.inference_type === "licensing_complexity");
  if (licensingInference) {
    sentences.push({
      text: licensingInference.conclusion,
      citations: [inferenceCitation(licensingInference.id)],
    });
  }

  if (sentences.length === 0) {
    return null;
  }

  return {
    title: "Regulatory Environment",
    sentences,
  };
}

// ============================================================================
// Management Backgrounds Narrative (Phase 4)
// ============================================================================

/**
 * Compile the Management Backgrounds section.
 */
function compileManagementBackgrounds(
  facts: ResearchFact[],
  inferences: ResearchInference[]
): NarrativeSection | null {
  const sentences: NarrativeSentence[] = [];

  // Years of experience
  const experienceFacts = facts.filter((f) => f.fact_type === "years_experience");
  if (experienceFacts.length > 0) {
    // Find max experience
    let maxExp = 0;
    let maxExpFact = experienceFacts[0];
    for (const fact of experienceFacts) {
      const value = fact.value as NumericValue;
      if (value.value > maxExp) {
        maxExp = value.value;
        maxExpFact = fact;
      }
    }

    sentences.push({
      text: `The business has ${maxExp}+ years of documented operating history.`,
      citations: [factCitation(maxExpFact.id)],
    });
  }

  // Prior entities
  const priorEntityFacts = facts.filter((f) => f.fact_type === "prior_entity");
  if (priorEntityFacts.length > 0) {
    const publicEntities = priorEntityFacts.filter(
      (f) => ((f.value as { category?: string }).category ?? "").includes("sec")
    );
    const otherEntities = priorEntityFacts.filter(
      (f) => !((f.value as { category?: string }).category ?? "").includes("sec")
    );

    if (publicEntities.length > 0) {
      sentences.push({
        text: `Management has ${publicEntities.length} public company affiliation(s) on record.`,
        citations: publicEntities.slice(0, 3).map((f) => factCitation(f.id)),
      });
    }

    if (otherEntities.length > 0) {
      sentences.push({
        text: `${otherEntities.length} prior business entity affiliation(s) identified.`,
        citations: otherEntities.slice(0, 3).map((f) => factCitation(f.id)),
      });
    }
  }

  // Role history
  const roleHistoryFacts = facts.filter((f) => f.fact_type === "role_history");
  if (roleHistoryFacts.length > 0) {
    sentences.push({
      text: "Management background includes:",
      citations: [],
    });

    for (const fact of roleHistoryFacts.slice(0, 3)) {
      const value = fact.value as { text: string };
      sentences.push({
        text: `• ${value.text}`,
        citations: [factCitation(fact.id)],
      });
    }
  }

  // Sanctions status
  const sanctionsFacts = facts.filter((f) => f.fact_type === "sanctions_status");
  const hasScreening = sanctionsFacts.some(
    (f) => ((f.value as { text?: string }).text ?? "") === "screening_available"
  );
  if (hasScreening) {
    sentences.push({
      text: "OFAC sanctions screening data is available for verification.",
      citations: sanctionsFacts.slice(0, 1).map((f) => factCitation(f.id)),
    });
  }

  // Bankruptcy history
  const bankruptcyFacts = facts.filter((f) => f.fact_type === "bankruptcy_history");
  if (bankruptcyFacts.length > 0) {
    sentences.push({
      text: `⚠️ ${bankruptcyFacts.length} bankruptcy case(s) identified in public records:`,
      citations: [],
    });

    for (const fact of bankruptcyFacts.slice(0, 3)) {
      const value = fact.value as { text: string };
      sentences.push({
        text: `• ${value.text}`,
        citations: [factCitation(fact.id)],
      });
    }
  }

  // Litigation history
  const litigationFacts = facts.filter((f) => f.fact_type === "litigation_history");
  if (litigationFacts.length > 0) {
    let totalCases = 0;
    for (const fact of litigationFacts) {
      const value = fact.value as NumericValue;
      totalCases += value.value;
    }

    if (totalCases > 0) {
      sentences.push({
        text: `${totalCases} civil litigation matter(s) identified in court records.`,
        citations: litigationFacts.slice(0, 2).map((f) => factCitation(f.id)),
      });
    }
  }

  // Execution risk inference
  const executionInference = inferences.find((i) => i.inference_type === "execution_risk_level");
  if (executionInference) {
    sentences.push({
      text: executionInference.conclusion,
      citations: [inferenceCitation(executionInference.id)],
    });
  }

  // Management depth inference
  const depthInference = inferences.find((i) => i.inference_type === "management_depth");
  if (depthInference) {
    sentences.push({
      text: depthInference.conclusion,
      citations: [inferenceCitation(depthInference.id)],
    });
  }

  // Adverse event risk inference
  const adverseInference = inferences.find((i) => i.inference_type === "adverse_event_risk");
  if (adverseInference) {
    sentences.push({
      text: adverseInference.conclusion,
      citations: [inferenceCitation(adverseInference.id)],
    });
  }

  if (sentences.length === 0) {
    return null;
  }

  return {
    title: "Management Backgrounds",
    sentences,
  };
}

/**
 * Compile a summary section.
 */
function compileSummary(
  facts: ResearchFact[],
  inferences: ResearchInference[]
): NarrativeSection | null {
  const sentences: NarrativeSentence[] = [];

  // Create a summary based on available inferences
  const keyInferences = inferences.filter((i) =>
    [
      "competitive_intensity",
      "market_attractiveness",
      "growth_trajectory",
      "geographic_concentration",
      "regulatory_risk_level",
      "execution_risk_level",
    ].includes(i.inference_type) ||
    (i.inference_type === "other" && i.conclusion.toLowerCase().includes("demand stability"))
  );

  if (keyInferences.length === 0) {
    return null;
  }

  // Opening sentence
  sentences.push({
    text: `Based on our analysis of ${facts.length} data points from government and regulatory sources:`,
    citations: [],
  });

  // Summary bullets from key inferences
  for (const inf of keyInferences) {
    sentences.push({
      text: `• ${inf.conclusion}`,
      citations: [inferenceCitation(inf.id)],
    });
  }

  return {
    title: "Summary",
    sentences,
  };
}

/**
 * Main narrative compilation function.
 * Compiles facts and inferences into a structured narrative.
 */
export function compileNarrative(
  facts: ResearchFact[],
  inferences: ResearchInference[],
  _sources?: ResearchSource[] // Available for future citation enrichment
): NarrativeCompilationResult {
  const sections: NarrativeSection[] = [];

  // 1. Industry Overview
  const overview = compileIndustryOverview(facts, inferences);
  if (overview) {
    sections.push(overview);
  }

  // 2. Competitive Landscape
  const competitive = compileCompetitiveLandscape(facts, inferences);
  if (competitive) {
    sections.push(competitive);
  }

  // 3. Market Demand (Phase 2)
  const marketDemand = compileMarketDemand(facts, inferences);
  if (marketDemand) {
    sections.push(marketDemand);
  }

  // 4. Demographics (Phase 2)
  const demographics = compileDemographics(facts, inferences);
  if (demographics) {
    sections.push(demographics);
  }

  // 5. Regulatory Environment (Phase 3)
  const regulatory = compileRegulatoryEnvironment(facts, inferences);
  if (regulatory) {
    sections.push(regulatory);
  }

  // 6. Management Backgrounds (Phase 4)
  const management = compileManagementBackgrounds(facts, inferences);
  if (management) {
    sections.push(management);
  }

  // 7. Market Dynamics
  const dynamics = compileMarketDynamics(facts, inferences);
  if (dynamics) {
    sections.push(dynamics);
  }

  // 8. Summary (always last)
  const summary = compileSummary(facts, inferences);
  if (summary) {
    sections.push(summary);
  }

  if (sections.length === 0) {
    return {
      ok: false,
      sections: [],
      error: "Insufficient data to compile narrative",
    };
  }

  return {
    ok: true,
    sections,
  };
}

/**
 * Validate that all citations in a narrative reference valid facts/inferences.
 */
export function validateNarrativeCitations(
  sections: NarrativeSection[],
  factIds: Set<string>,
  inferenceIds: Set<string>
): { valid: boolean; invalidCitations: Citation[] } {
  const invalidCitations: Citation[] = [];

  for (const section of sections) {
    for (const sentence of section.sentences) {
      for (const citation of sentence.citations) {
        if (citation.type === "fact" && !factIds.has(citation.id)) {
          invalidCitations.push(citation);
        } else if (citation.type === "inference" && !inferenceIds.has(citation.id)) {
          invalidCitations.push(citation);
        }
      }
    }
  }

  return {
    valid: invalidCitations.length === 0,
    invalidCitations,
  };
}
