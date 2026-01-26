/**
 * Credit Committee Pack Compiler
 *
 * Aggregates research from all mission types into a comprehensive,
 * citation-backed document for credit committee review.
 *
 * Phase 5 of the Buddy Institutional Intelligence Engine.
 */

import type {
  ResearchMission,
  ResearchFact,
  ResearchInference,
  ResearchSource,
  NarrativeSection,
  NarrativeSentence,
  Citation,
  MissionType,
} from "./types";
import { compileNarrative } from "./compileNarrative";

// ============================================================================
// Credit Committee Pack Types
// ============================================================================

export type CreditCommitteePackSection = {
  section_type: "executive_summary" | "research" | "risk_assessment" | "appendix";
  title: string;
  content: NarrativeSentence[];
  mission_ids?: string[];
};

export type RiskIndicator = {
  category: "competitive" | "regulatory" | "execution" | "market" | "geographic" | "lender_fit" | "stress";
  level: "low" | "medium" | "high";
  summary: string;
  supporting_inference_ids: string[];
};

export type CreditCommitteePack = {
  id: string;
  deal_id: string;
  bank_id?: string | null;

  // Pack content
  sections: CreditCommitteePackSection[];
  risk_indicators: RiskIndicator[];

  // Aggregated statistics
  total_facts: number;
  total_inferences: number;
  total_sources: number;
  missions_included: string[];

  // Metadata
  compiled_at: string;
  version: number;
  correlation_id?: string | null;
};

export type CompilePackInput = {
  deal_id: string;
  bank_id?: string | null;

  // Research data by mission
  missions: Array<{
    mission: ResearchMission;
    facts: ResearchFact[];
    inferences: ResearchInference[];
    sources: ResearchSource[];
  }>;

  // Optional deal context
  deal_context?: {
    borrower_name?: string;
    loan_amount?: number;
    loan_purpose?: string;
    industry_description?: string;
  };
};

export type CompilePackResult = {
  ok: boolean;
  pack?: CreditCommitteePack;
  error?: string;
};

// ============================================================================
// Helper Functions
// ============================================================================

function factCitation(factId: string): Citation {
  return { type: "fact", id: factId };
}

function inferenceCitation(inferenceId: string): Citation {
  return { type: "inference", id: inferenceId };
}

/**
 * Get ordered mission types for narrative structure.
 */
function getMissionTypeOrder(): MissionType[] {
  return [
    "industry_landscape",
    "competitive_analysis",
    "market_demand",
    "demographics",
    "regulatory_environment",
    "management_backgrounds",
    "lender_fit_analysis",
    "scenario_stress",
  ];
}

/**
 * Get display title for mission type.
 */
function getMissionTypeTitle(missionType: MissionType): string {
  const titles: Record<MissionType, string> = {
    industry_landscape: "Industry Landscape",
    competitive_analysis: "Competitive Analysis",
    market_demand: "Market Demand",
    demographics: "Demographics",
    regulatory_environment: "Regulatory Environment",
    management_backgrounds: "Management Backgrounds",
    lender_fit_analysis: "Lender Fit Analysis",
    scenario_stress: "Scenario Stress Analysis",
  };
  return titles[missionType] ?? missionType;
}

// ============================================================================
// Risk Assessment
// ============================================================================

/**
 * Extract risk indicators from inferences across all missions.
 */
function extractRiskIndicators(
  allInferences: ResearchInference[]
): RiskIndicator[] {
  const indicators: RiskIndicator[] = [];

  // Competitive risk
  const competitiveInference = allInferences.find(
    (i) => i.inference_type === "competitive_intensity"
  );
  if (competitiveInference) {
    const conclusion = competitiveInference.conclusion.toLowerCase();
    let level: "low" | "medium" | "high" = "medium";
    if (conclusion.includes("high")) level = "high";
    else if (conclusion.includes("low")) level = "low";

    indicators.push({
      category: "competitive",
      level,
      summary: competitiveInference.conclusion,
      supporting_inference_ids: [competitiveInference.id],
    });
  }

  // Regulatory risk
  const regulatoryInference = allInferences.find(
    (i) => i.inference_type === "regulatory_risk_level"
  );
  if (regulatoryInference) {
    const conclusion = regulatoryInference.conclusion.toLowerCase();
    let level: "low" | "medium" | "high" = "medium";
    if (conclusion.includes("high")) level = "high";
    else if (conclusion.includes("low")) level = "low";

    indicators.push({
      category: "regulatory",
      level,
      summary: regulatoryInference.conclusion,
      supporting_inference_ids: [regulatoryInference.id],
    });
  }

  // Execution risk
  const executionInference = allInferences.find(
    (i) => i.inference_type === "execution_risk_level"
  );
  if (executionInference) {
    const conclusion = executionInference.conclusion.toLowerCase();
    let level: "low" | "medium" | "high" = "medium";
    if (conclusion.includes("high")) level = "high";
    else if (conclusion.includes("low")) level = "low";

    indicators.push({
      category: "execution",
      level,
      summary: executionInference.conclusion,
      supporting_inference_ids: [executionInference.id],
    });
  }

  // Market risk (from market attractiveness and demand stability)
  const marketInference = allInferences.find(
    (i) => i.inference_type === "market_attractiveness"
  );
  const demandInference = allInferences.find(
    (i) =>
      i.inference_type === "other" &&
      i.conclusion.toLowerCase().includes("demand stability")
  );

  if (marketInference || demandInference) {
    const inferenceIds: string[] = [];
    let marketLevel: "low" | "medium" | "high" = "medium";

    if (marketInference) {
      inferenceIds.push(marketInference.id);
      const conclusion = marketInference.conclusion.toLowerCase();
      if (conclusion.includes("low")) marketLevel = "high"; // Low attractiveness = high risk
      else if (conclusion.includes("high")) marketLevel = "low";
    }

    if (demandInference) {
      inferenceIds.push(demandInference.id);
      const conclusion = demandInference.conclusion.toLowerCase();
      if (conclusion.includes("low")) marketLevel = "high";
      else if (conclusion.includes("high") && marketLevel !== "high")
        marketLevel = "low";
    }

    indicators.push({
      category: "market",
      level: marketLevel,
      summary:
        marketInference?.conclusion ?? demandInference?.conclusion ?? "Market risk assessed",
      supporting_inference_ids: inferenceIds,
    });
  }

  // Geographic risk
  const geoInference = allInferences.find(
    (i) => i.inference_type === "geographic_concentration"
  );
  if (geoInference) {
    const conclusion = geoInference.conclusion.toLowerCase();
    let level: "low" | "medium" | "high" = "medium";
    if (conclusion.includes("high")) level = "high";
    else if (conclusion.includes("low")) level = "low";

    indicators.push({
      category: "geographic",
      level,
      summary: geoInference.conclusion,
      supporting_inference_ids: [geoInference.id],
    });
  }

  // Lender fit indicator (Phase 6)
  const lenderFitInference = allInferences.find(
    (i) => i.inference_type === "lender_program_fit"
  );
  if (lenderFitInference) {
    const conclusion = lenderFitInference.conclusion.toLowerCase();
    let level: "low" | "medium" | "high" = "medium";
    // Note: "strong" fit = low risk, "limited" fit = high risk
    if (conclusion.includes("limited")) level = "high";
    else if (conclusion.includes("strong")) level = "low";

    indicators.push({
      category: "lender_fit",
      level,
      summary: lenderFitInference.conclusion,
      supporting_inference_ids: [lenderFitInference.id],
    });
  }

  // Stress resilience indicator (Phase 7)
  const stressInference = allInferences.find(
    (i) => i.inference_type === "stress_resilience"
  );
  if (stressInference) {
    const conclusion = stressInference.conclusion.toLowerCase();
    let level: "low" | "medium" | "high" = "medium";
    // Note: "high" resilience = low risk, "low" resilience = high risk
    if (conclusion.includes("low") && conclusion.includes("resilience")) level = "high";
    else if (conclusion.includes("high") && conclusion.includes("resilience")) level = "low";

    indicators.push({
      category: "stress",
      level,
      summary: stressInference.conclusion,
      supporting_inference_ids: [stressInference.id],
    });
  }

  return indicators;
}

// ============================================================================
// Executive Summary
// ============================================================================

/**
 * Compile the Executive Summary section.
 */
function compileExecutiveSummary(
  input: CompilePackInput,
  allFacts: ResearchFact[],
  allInferences: ResearchInference[],
  riskIndicators: RiskIndicator[]
): CreditCommitteePackSection {
  const sentences: NarrativeSentence[] = [];

  // Opening paragraph with deal context
  if (input.deal_context) {
    const ctx = input.deal_context;
    if (ctx.borrower_name && ctx.loan_amount) {
      sentences.push({
        text: `This Credit Committee Pack summarizes the institutional research conducted for ${ctx.borrower_name}'s $${ctx.loan_amount.toLocaleString()} ${ctx.loan_purpose ?? "loan"} request.`,
        citations: [],
      });
    }

    if (ctx.industry_description) {
      sentences.push({
        text: `The borrower operates in ${ctx.industry_description}.`,
        citations: [],
      });
    }
  }

  // Research coverage summary
  const missionTypes = input.missions.map((m) => m.mission.mission_type);
  sentences.push({
    text: `This analysis incorporates ${allFacts.length} verified facts and ${allInferences.length} derived inferences from ${input.missions.length} research missions covering: ${missionTypes.map(getMissionTypeTitle).join(", ")}.`,
    citations: [],
  });

  // Risk summary
  const highRisks = riskIndicators.filter((r) => r.level === "high");
  const mediumRisks = riskIndicators.filter((r) => r.level === "medium");

  if (highRisks.length > 0) {
    sentences.push({
      text: `⚠️ HIGH RISK AREAS (${highRisks.length}):`,
      citations: [],
    });
    for (const risk of highRisks) {
      sentences.push({
        text: `• ${risk.category.toUpperCase()}: ${risk.summary}`,
        citations: risk.supporting_inference_ids.map(inferenceCitation),
      });
    }
  }

  if (mediumRisks.length > 0) {
    sentences.push({
      text: `MODERATE RISK AREAS (${mediumRisks.length}):`,
      citations: [],
    });
    for (const risk of mediumRisks) {
      sentences.push({
        text: `• ${risk.category.toUpperCase()}: ${risk.summary}`,
        citations: risk.supporting_inference_ids.map(inferenceCitation),
      });
    }
  }

  // Key tailwinds and headwinds
  const tailwinds = allInferences.filter((i) => i.inference_type === "tailwind");
  const headwinds = allInferences.filter((i) => i.inference_type === "headwind");

  if (tailwinds.length > 0) {
    sentences.push({
      text: `KEY TAILWINDS (${tailwinds.length}):`,
      citations: [],
    });
    for (const tw of tailwinds.slice(0, 3)) {
      sentences.push({
        text: `• ${tw.conclusion}`,
        citations: [inferenceCitation(tw.id)],
      });
    }
  }

  if (headwinds.length > 0) {
    sentences.push({
      text: `KEY HEADWINDS (${headwinds.length}):`,
      citations: [],
    });
    for (const hw of headwinds.slice(0, 3)) {
      sentences.push({
        text: `• ${hw.conclusion}`,
        citations: [inferenceCitation(hw.id)],
      });
    }
  }

  return {
    section_type: "executive_summary",
    title: "Executive Summary",
    content: sentences,
    mission_ids: input.missions.map((m) => m.mission.id),
  };
}

// ============================================================================
// Research Sections
// ============================================================================

/**
 * Compile research sections from each mission's narrative.
 */
function compileResearchSections(
  input: CompilePackInput
): CreditCommitteePackSection[] {
  const sections: CreditCommitteePackSection[] = [];
  const missionOrder = getMissionTypeOrder();

  // Sort missions by type order
  const sortedMissions = [...input.missions].sort((a, b) => {
    const aIdx = missionOrder.indexOf(a.mission.mission_type);
    const bIdx = missionOrder.indexOf(b.mission.mission_type);
    return aIdx - bIdx;
  });

  for (const missionData of sortedMissions) {
    const { mission, facts, inferences, sources } = missionData;

    // Skip incomplete missions
    if (mission.status !== "complete" || facts.length === 0) {
      continue;
    }

    // Compile mission narrative
    const narrativeResult = compileNarrative(facts, inferences, sources);
    if (!narrativeResult.ok || narrativeResult.sections.length === 0) {
      continue;
    }

    // Flatten narrative sections into pack content
    const content: NarrativeSentence[] = [];

    for (const section of narrativeResult.sections) {
      // Add section header
      content.push({
        text: `### ${section.title}`,
        citations: [],
      });

      // Add section sentences
      content.push(...section.sentences);

      // Add spacing
      content.push({
        text: "",
        citations: [],
      });
    }

    sections.push({
      section_type: "research",
      title: getMissionTypeTitle(mission.mission_type),
      content,
      mission_ids: [mission.id],
    });
  }

  return sections;
}

// ============================================================================
// Risk Assessment Section
// ============================================================================

/**
 * Compile the consolidated Risk Assessment section.
 */
function compileRiskAssessmentSection(
  riskIndicators: RiskIndicator[],
  allInferences: ResearchInference[]
): CreditCommitteePackSection {
  const sentences: NarrativeSentence[] = [];

  sentences.push({
    text: "## Risk Assessment Matrix",
    citations: [],
  });

  // Group by level
  const byLevel = {
    high: riskIndicators.filter((r) => r.level === "high"),
    medium: riskIndicators.filter((r) => r.level === "medium"),
    low: riskIndicators.filter((r) => r.level === "low"),
  };

  // High risks first
  if (byLevel.high.length > 0) {
    sentences.push({
      text: "### High Risk Factors",
      citations: [],
    });
    for (const risk of byLevel.high) {
      sentences.push({
        text: `**${risk.category.toUpperCase()}**: ${risk.summary}`,
        citations: risk.supporting_inference_ids.map(inferenceCitation),
      });
    }
  }

  // Medium risks
  if (byLevel.medium.length > 0) {
    sentences.push({
      text: "### Moderate Risk Factors",
      citations: [],
    });
    for (const risk of byLevel.medium) {
      sentences.push({
        text: `**${risk.category.toUpperCase()}**: ${risk.summary}`,
        citations: risk.supporting_inference_ids.map(inferenceCitation),
      });
    }
  }

  // Low risks
  if (byLevel.low.length > 0) {
    sentences.push({
      text: "### Low Risk Factors",
      citations: [],
    });
    for (const risk of byLevel.low) {
      sentences.push({
        text: `**${risk.category.toUpperCase()}**: ${risk.summary}`,
        citations: risk.supporting_inference_ids.map(inferenceCitation),
      });
    }
  }

  // Overall risk profile
  const highCount = byLevel.high.length;
  const mediumCount = byLevel.medium.length;

  let overallRisk = "MODERATE";
  if (highCount >= 2) {
    overallRisk = "ELEVATED";
  } else if (highCount >= 1) {
    overallRisk = "MODERATE-HIGH";
  } else if (mediumCount <= 1 && highCount === 0) {
    overallRisk = "LOW-MODERATE";
  }

  sentences.push({
    text: `### Overall Risk Profile: ${overallRisk}`,
    citations: [],
  });

  sentences.push({
    text: `Based on ${riskIndicators.length} risk categories analyzed, with ${highCount} high-risk, ${mediumCount} moderate-risk, and ${byLevel.low.length} low-risk indicators.`,
    citations: [],
  });

  return {
    section_type: "risk_assessment",
    title: "Risk Assessment",
    content: sentences,
  };
}

// ============================================================================
// Appendix Section
// ============================================================================

/**
 * Compile the appendix with source citations.
 */
function compileAppendix(
  input: CompilePackInput,
  allFacts: ResearchFact[],
  allSources: ResearchSource[]
): CreditCommitteePackSection {
  const sentences: NarrativeSentence[] = [];

  sentences.push({
    text: "## Sources & Methodology",
    citations: [],
  });

  // Source summary by class
  const sourcesByClass: Record<string, ResearchSource[]> = {};
  for (const source of allSources) {
    const cls = source.source_class;
    if (!sourcesByClass[cls]) sourcesByClass[cls] = [];
    sourcesByClass[cls].push(source);
  }

  sentences.push({
    text: "### Data Sources",
    citations: [],
  });

  for (const [cls, sources] of Object.entries(sourcesByClass)) {
    sentences.push({
      text: `**${cls.toUpperCase()} Sources (${sources.length})**:`,
      citations: [],
    });

    // List unique source names
    const uniqueNames = [...new Set(sources.map((s) => s.source_name))];
    for (const name of uniqueNames.slice(0, 5)) {
      sentences.push({
        text: `• ${name}`,
        citations: [],
      });
    }
    if (uniqueNames.length > 5) {
      sentences.push({
        text: `• ...and ${uniqueNames.length - 5} more`,
        citations: [],
      });
    }
  }

  // Methodology note
  sentences.push({
    text: "### Methodology",
    citations: [],
  });

  sentences.push({
    text: "All facts in this report are extracted from public government and regulatory data sources using deterministic rule-based extraction. Each fact traces to a specific source document and extraction path. Inferences are derived from multiple supporting facts using explicit reasoning chains.",
    citations: [],
  });

  sentences.push({
    text: `This report contains ${allFacts.length} verified facts, each with citation to source. No LLM-generated content is presented as fact without source verification.`,
    citations: [],
  });

  // Mission coverage
  sentences.push({
    text: "### Research Coverage",
    citations: [],
  });

  for (const missionData of input.missions) {
    const { mission, facts, inferences, sources } = missionData;
    const statusEmoji = mission.status === "complete" ? "✓" : "○";
    sentences.push({
      text: `${statusEmoji} ${getMissionTypeTitle(mission.mission_type)}: ${facts.length} facts, ${inferences.length} inferences from ${sources.length} sources`,
      citations: [],
    });
  }

  return {
    section_type: "appendix",
    title: "Appendix",
    content: sentences,
    mission_ids: input.missions.map((m) => m.mission.id),
  };
}

// ============================================================================
// Main Compiler
// ============================================================================

/**
 * Compile a Credit Committee Pack from research missions.
 */
export function compileCreditCommitteePack(
  input: CompilePackInput
): CompilePackResult {
  try {
    // Validate input
    if (!input.deal_id) {
      return { ok: false, error: "deal_id is required" };
    }

    if (input.missions.length === 0) {
      return { ok: false, error: "At least one mission is required" };
    }

    // Aggregate all facts, inferences, and sources
    const allFacts: ResearchFact[] = [];
    const allInferences: ResearchInference[] = [];
    const allSources: ResearchSource[] = [];

    for (const missionData of input.missions) {
      allFacts.push(...missionData.facts);
      allInferences.push(...missionData.inferences);
      allSources.push(...missionData.sources);
    }

    // Check minimum data requirements
    if (allFacts.length === 0) {
      return { ok: false, error: "No facts available to compile pack" };
    }

    // Extract risk indicators
    const riskIndicators = extractRiskIndicators(allInferences);

    // Compile sections
    const sections: CreditCommitteePackSection[] = [];

    // 1. Executive Summary
    const execSummary = compileExecutiveSummary(
      input,
      allFacts,
      allInferences,
      riskIndicators
    );
    sections.push(execSummary);

    // 2. Research sections (one per mission type)
    const researchSections = compileResearchSections(input);
    sections.push(...researchSections);

    // 3. Risk Assessment
    const riskSection = compileRiskAssessmentSection(riskIndicators, allInferences);
    sections.push(riskSection);

    // 4. Appendix
    const appendix = compileAppendix(input, allFacts, allSources);
    sections.push(appendix);

    // Build the pack
    const pack: CreditCommitteePack = {
      id: `pack_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      deal_id: input.deal_id,
      bank_id: input.bank_id,
      sections,
      risk_indicators: riskIndicators,
      total_facts: allFacts.length,
      total_inferences: allInferences.length,
      total_sources: allSources.length,
      missions_included: input.missions.map((m) => m.mission.id),
      compiled_at: new Date().toISOString(),
      version: 1,
    };

    return { ok: true, pack };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Unknown error compiling pack",
    };
  }
}

/**
 * Render a Credit Committee Pack to Markdown.
 */
export function renderPackToMarkdown(pack: CreditCommitteePack): string {
  const lines: string[] = [];

  lines.push("# Credit Committee Research Pack");
  lines.push("");
  lines.push(`**Deal ID:** ${pack.deal_id}`);
  lines.push(`**Compiled:** ${pack.compiled_at}`);
  lines.push(`**Version:** ${pack.version}`);
  lines.push("");
  lines.push("---");
  lines.push("");

  for (const section of pack.sections) {
    lines.push(`# ${section.title}`);
    lines.push("");

    for (const sentence of section.content) {
      if (sentence.text.startsWith("#")) {
        // It's a header
        lines.push(sentence.text);
      } else if (sentence.text.startsWith("•")) {
        // It's a bullet
        lines.push(sentence.text);
      } else if (sentence.text === "") {
        // Empty line
        lines.push("");
      } else {
        // Regular text
        lines.push(sentence.text);
      }

      // Add citation markers if any
      if (sentence.citations.length > 0) {
        const citationRefs = sentence.citations
          .map((c) => `[${c.type}:${c.id.slice(0, 8)}]`)
          .join(", ");
        // Append citations in smaller text
        lines[lines.length - 1] += ` *(${citationRefs})*`;
      }
    }

    lines.push("");
    lines.push("---");
    lines.push("");
  }

  // Footer
  lines.push("*This report was generated by Buddy's Institutional Intelligence Engine.*");
  lines.push(`*${pack.total_facts} facts | ${pack.total_inferences} inferences | ${pack.total_sources} sources*`);

  return lines.join("\n");
}
