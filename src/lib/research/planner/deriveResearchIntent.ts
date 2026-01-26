/**
 * Research Intent Derivation Engine
 *
 * The brain of the Autonomous Research Planner.
 * Uses deterministic rules to decide what research to run.
 *
 * Rule Priority Order:
 * 1. Industry + Competitive Landscape (NAICS required)
 * 2. Market Demand + Demographics (geography + growth purpose)
 * 3. Regulatory Environment (regulated industry or multi-state)
 * 4. Management Backgrounds (principals >= 20% ownership)
 *
 * All decisions are:
 * - Deterministic (same inputs → same outputs)
 * - Auditable (every decision logged with rationale)
 * - Explainable (human-readable reasoning)
 */

import type {
  PlannerInput,
  PlannerOutput,
  PlannerRule,
  RuleResult,
  ProposedMission,
  ResearchIntentLog,
  ExistingMission,
} from "./types";
import type { MissionType, MissionSubject } from "../types";

// ============================================================================
// Regulated Industries (inline for now, matches DB seed)
// ============================================================================

const REGULATED_NAICS_PREFIXES: Record<string, { name: string; bodies: string[] }> = {
  "621": { name: "Ambulatory Health Care", bodies: ["State Medical Boards", "CMS", "FDA"] },
  "622": { name: "Hospitals", bodies: ["State Health Departments", "CMS"] },
  "623": { name: "Nursing/Residential Care", bodies: ["State Health Departments", "CMS"] },
  "524": { name: "Insurance Carriers", bodies: ["State Insurance Commissioners"] },
  "522": { name: "Credit Intermediation", bodies: ["FDIC", "OCC", "State Banking Regulators"] },
  "531": { name: "Real Estate", bodies: ["State Real Estate Commissions"] },
  "722": { name: "Food Services", bodies: ["FDA", "State Health Departments"] },
  "312": { name: "Beverage Manufacturing", bodies: ["TTB", "State ABC Boards"] },
  "481": { name: "Air Transportation", bodies: ["FAA", "TSA", "DOT"] },
  "484": { name: "Truck Transportation", bodies: ["FMCSA", "DOT"] },
  "611": { name: "Educational Services", bodies: ["State Education Departments", "DOE"] },
};

/**
 * Check if an industry is regulated based on NAICS code.
 */
function isRegulatedIndustry(naicsCode: string): { regulated: boolean; bodies?: string[] } {
  // Check exact match first, then prefixes
  for (const [prefix, info] of Object.entries(REGULATED_NAICS_PREFIXES)) {
    if (naicsCode.startsWith(prefix)) {
      return { regulated: true, bodies: info.bodies };
    }
  }
  return { regulated: false };
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Check if a mission of given type has already been completed.
 */
function hasMissionCompleted(missions: ExistingMission[], type: MissionType): boolean {
  return missions.some((m) => m.mission_type === type && m.status === "complete");
}

/**
 * Check if a mission of given type is currently running.
 */
function hasMissionRunning(missions: ExistingMission[], type: MissionType): boolean {
  return missions.some((m) => m.mission_type === type && (m.status === "running" || m.status === "queued"));
}

/**
 * Check if deal purpose suggests growth/expansion.
 */
function isGrowthPurpose(purpose?: string): boolean {
  if (!purpose) return false;
  const p = purpose.toLowerCase();
  return (
    p.includes("expansion") ||
    p.includes("new location") ||
    p.includes("growth") ||
    p.includes("acquisition") ||
    p.includes("new market") ||
    p.includes("scaling")
  );
}

/**
 * Get fact IDs that support a given assertion.
 * In practice, these would be real fact IDs from extracted_facts.
 */
function getSupportingFactIds(input: PlannerInput, factTypes: string[]): string[] {
  return input.extracted_facts
    .filter((f) => factTypes.includes(f.fact_type))
    .map((f) => f.id);
}

// ============================================================================
// Rule Definitions
// ============================================================================

/**
 * Rule 1: Industry & Competitive Landscape
 *
 * Trigger: NAICS code present, no completed industry_landscape mission
 * Priority: 1 (highest)
 */
const industryLandscapeRule: PlannerRule = {
  name: "naics_triggers_industry_research",
  version: 1,
  description: "NAICS code detected → industry landscape research required",
  mission_type: "industry_landscape",

  evaluate: (input: PlannerInput): RuleResult | null => {
    const { entity_signals, existing_missions } = input;
    const naicsCode = entity_signals.naics_code;

    // Prerequisite: Need NAICS code
    if (!naicsCode) {
      return {
        should_run: false,
        priority: 1,
        subject: {},
        rationale: "No NAICS code available. Cannot research industry without industry classification.",
        confidence: 0,
        supporting_fact_ids: [],
        defer_reason: "prerequisite_missing",
      };
    }

    // Skip if already completed
    if (hasMissionCompleted(existing_missions, "industry_landscape")) {
      return {
        should_run: false,
        priority: 1,
        subject: { naics_code: naicsCode },
        rationale: "Industry landscape research already completed.",
        confidence: 1,
        supporting_fact_ids: [],
      };
    }

    // Skip if running
    if (hasMissionRunning(existing_missions, "industry_landscape")) {
      return {
        should_run: false,
        priority: 1,
        subject: { naics_code: naicsCode },
        rationale: "Industry landscape research already in progress.",
        confidence: 1,
        supporting_fact_ids: [],
      };
    }

    // Trigger research
    return {
      should_run: true,
      priority: 1,
      subject: {
        naics_code: naicsCode,
        geography: entity_signals.headquarters_state ?? "US",
      },
      rationale: `NAICS code ${naicsCode} detected from business tax return. Industry context required for underwriting.`,
      confidence: 0.95,
      supporting_fact_ids: getSupportingFactIds(input, ["entity_profile", "naics_code"]),
    };
  },
};

/**
 * Rule 2: Competitive Analysis
 *
 * Trigger: NAICS code present, industry_landscape completed
 * Priority: 2
 */
const competitiveAnalysisRule: PlannerRule = {
  name: "naics_triggers_competitive_research",
  version: 1,
  description: "NAICS code + industry completed → competitive analysis",
  mission_type: "competitive_analysis",

  evaluate: (input: PlannerInput): RuleResult | null => {
    const { entity_signals, existing_missions } = input;
    const naicsCode = entity_signals.naics_code;

    if (!naicsCode) {
      return null; // No action without NAICS
    }

    // Prerequisite: Industry landscape should be done first
    if (!hasMissionCompleted(existing_missions, "industry_landscape")) {
      return {
        should_run: false,
        priority: 2,
        subject: { naics_code: naicsCode },
        rationale: "Waiting for industry landscape research to complete before competitive analysis.",
        confidence: 0.8,
        supporting_fact_ids: [],
        defer_reason: "prerequisite_missing",
      };
    }

    // Skip if already done
    if (hasMissionCompleted(existing_missions, "competitive_analysis")) {
      return {
        should_run: false,
        priority: 2,
        subject: { naics_code: naicsCode },
        rationale: "Competitive analysis already completed.",
        confidence: 1,
        supporting_fact_ids: [],
      };
    }

    if (hasMissionRunning(existing_missions, "competitive_analysis")) {
      return null;
    }

    return {
      should_run: true,
      priority: 2,
      subject: { naics_code: naicsCode },
      rationale: `Industry landscape complete. Proceeding with competitive analysis for NAICS ${naicsCode}.`,
      confidence: 0.9,
      supporting_fact_ids: getSupportingFactIds(input, ["competitor_name", "market_share_estimate"]),
    };
  },
};

/**
 * Rule 3: Market Demand & Demographics
 *
 * Trigger: Geography + growth-related deal purpose
 * Priority: 3
 */
const marketDemandRule: PlannerRule = {
  name: "growth_purpose_triggers_market_research",
  version: 1,
  description: "Growth purpose + geography → market demand research",
  mission_type: "market_demand",

  evaluate: (input: PlannerInput): RuleResult | null => {
    const { entity_signals, deal_purpose, existing_missions } = input;
    const geography = entity_signals.operating_states?.[0] ?? entity_signals.headquarters_state;

    // Need geography for market research
    if (!geography) {
      return {
        should_run: false,
        priority: 3,
        subject: {},
        rationale: "No geography available for market demand research.",
        confidence: 0,
        supporting_fact_ids: [],
        defer_reason: "prerequisite_missing",
      };
    }

    // Check if growth purpose
    if (!isGrowthPurpose(deal_purpose)) {
      return {
        should_run: false,
        priority: 3,
        subject: { geography },
        rationale: "Deal purpose does not indicate expansion or growth. Market demand research not required.",
        confidence: 0.8,
        supporting_fact_ids: [],
      };
    }

    // Skip if done
    if (hasMissionCompleted(existing_missions, "market_demand")) {
      return {
        should_run: false,
        priority: 3,
        subject: { geography },
        rationale: "Market demand research already completed.",
        confidence: 1,
        supporting_fact_ids: [],
      };
    }

    if (hasMissionRunning(existing_missions, "market_demand")) {
      return null;
    }

    return {
      should_run: true,
      priority: 3,
      subject: {
        geography,
        naics_code: entity_signals.naics_code,
      },
      rationale: `Deal purpose implies expansion/growth. Market demand context required for ${geography}.`,
      confidence: 0.85,
      supporting_fact_ids: getSupportingFactIds(input, ["population", "median_income", "business_density"]),
    };
  },
};

/**
 * Rule 4: Regulatory Environment
 *
 * Trigger: Regulated industry OR multi-state operations
 * Priority: 4
 */
const regulatoryRule: PlannerRule = {
  name: "regulated_industry_triggers_regulatory_research",
  version: 1,
  description: "Regulated industry or multi-state → regulatory research",
  mission_type: "regulatory_environment",

  evaluate: (input: PlannerInput): RuleResult | null => {
    const { entity_signals, existing_missions } = input;
    const naicsCode = entity_signals.naics_code;
    const operatingStates = entity_signals.operating_states ?? [];

    // Check if regulated industry
    const regulatedCheck = naicsCode ? isRegulatedIndustry(naicsCode) : { regulated: false };
    const isMultiState = operatingStates.length > 1;

    // Need at least one trigger
    if (!regulatedCheck.regulated && !isMultiState) {
      return {
        should_run: false,
        priority: 4,
        subject: {},
        rationale: "Industry is not heavily regulated and operations are single-state. Regulatory research not required.",
        confidence: 0.7,
        supporting_fact_ids: [],
      };
    }

    // Skip if done
    if (hasMissionCompleted(existing_missions, "regulatory_environment")) {
      return {
        should_run: false,
        priority: 4,
        subject: {},
        rationale: "Regulatory environment research already completed.",
        confidence: 1,
        supporting_fact_ids: [],
      };
    }

    if (hasMissionRunning(existing_missions, "regulatory_environment")) {
      return null;
    }

    // Build rationale
    let rationale = "";
    if (regulatedCheck.regulated && regulatedCheck.bodies) {
      rationale = `Industry is regulated by ${regulatedCheck.bodies.join(", ")}.`;
    }
    if (isMultiState) {
      rationale += ` Operations span ${operatingStates.length} states (${operatingStates.join(", ")}).`;
    }

    return {
      should_run: true,
      priority: 4,
      subject: {
        naics_code: naicsCode,
        geography: operatingStates.join(","),
      },
      rationale: rationale.trim() + " Regulatory exposure assessment required.",
      confidence: regulatedCheck.regulated ? 0.9 : 0.75,
      supporting_fact_ids: getSupportingFactIds(input, ["regulatory_body", "compliance_requirement"]),
    };
  },
};

/**
 * Rule 5: Management & Ownership Backgrounds
 *
 * Trigger: Principals >= 20% ownership identified
 * Priority: 5
 */
const managementBackgroundsRule: PlannerRule = {
  name: "principals_trigger_management_research",
  version: 1,
  description: "Principals with >= 20% ownership → management backgrounds research",
  mission_type: "management_backgrounds",

  evaluate: (input: PlannerInput): RuleResult | null => {
    const { entity_signals, existing_missions, underwriting_stance } = input;
    const principals = entity_signals.principals ?? [];

    // Need principals
    if (principals.length === 0) {
      return {
        should_run: false,
        priority: 5,
        subject: {},
        rationale: "No principals with >= 20% ownership identified. Management research deferred.",
        confidence: 0,
        supporting_fact_ids: [],
        defer_reason: "prerequisite_missing",
      };
    }

    // Skip if done
    if (hasMissionCompleted(existing_missions, "management_backgrounds")) {
      return {
        should_run: false,
        priority: 5,
        subject: {},
        rationale: "Management backgrounds research already completed.",
        confidence: 1,
        supporting_fact_ids: [],
      };
    }

    if (hasMissionRunning(existing_missions, "management_backgrounds")) {
      return null;
    }

    // Don't run if we have insufficient information overall
    if (underwriting_stance === "insufficient_information") {
      return {
        should_run: false,
        priority: 5,
        subject: {},
        rationale: "Waiting for core financial documents before researching management backgrounds.",
        confidence: 0.8,
        supporting_fact_ids: [],
        defer_reason: "prerequisite_missing",
      };
    }

    // Build principal list for subject
    const principalSubject = principals.map((p) => ({
      name: p.name,
      ownership_pct: p.ownership_pct,
      title: p.title,
    }));

    return {
      should_run: true,
      priority: 5,
      subject: {
        company_name: entity_signals.legal_company_name,
        keywords: principals.map((p) => p.name),
      },
      rationale: `${principals.length} principal(s) with >= 20% ownership detected: ${principals.map((p) => `${p.name} (${p.ownership_pct}%)`).join(", ")}. Background research required.`,
      confidence: 0.85,
      supporting_fact_ids: getSupportingFactIds(input, ["entity_profile"]),
    };
  },
};

// ============================================================================
// All Rules (in priority order)
// ============================================================================

const ALL_RULES: PlannerRule[] = [
  industryLandscapeRule,
  competitiveAnalysisRule,
  marketDemandRule,
  regulatoryRule,
  managementBackgroundsRule,
];

// ============================================================================
// Main Derivation Function
// ============================================================================

/**
 * Derive research intent from planner inputs.
 *
 * This is the main entry point for the rules engine.
 * It evaluates all rules and returns proposed missions with rationale.
 */
export function deriveResearchIntent(input: PlannerInput): PlannerOutput {
  const proposed_missions: ProposedMission[] = [];
  const intent_logs: Omit<ResearchIntentLog, "id" | "plan_id" | "deal_id" | "created_at">[] = [];
  const gaps_identified: string[] = [];

  // Evaluate each rule
  for (const rule of ALL_RULES) {
    const result = rule.evaluate(input);

    if (!result) {
      // Rule returned null = no action needed
      continue;
    }

    // Log the intent
    const intentLog: Omit<ResearchIntentLog, "id" | "plan_id" | "deal_id" | "created_at"> = {
      intent_type: result.should_run
        ? "mission_proposed"
        : result.defer_reason === "prerequisite_missing"
          ? "prerequisite_missing"
          : "mission_skipped",
      mission_type: rule.mission_type,
      rationale: result.rationale,
      confidence: result.confidence,
      supporting_fact_ids: result.supporting_fact_ids,
      supporting_fact_types: [], // Could populate from facts
      rule_name: rule.name,
      rule_version: rule.version,
    };
    intent_logs.push(intentLog);

    // If should run, add to proposed missions
    if (result.should_run) {
      proposed_missions.push({
        mission_type: rule.mission_type,
        subject: result.subject,
        priority: result.priority,
        rationale: result.rationale,
        confidence: result.confidence,
        supporting_fact_ids: result.supporting_fact_ids,
        status: "pending",
      });
    }

    // Track gaps
    if (result.defer_reason === "prerequisite_missing") {
      gaps_identified.push(`${rule.mission_type}: ${result.rationale}`);
    }
  }

  // Sort by priority
  proposed_missions.sort((a, b) => a.priority - b.priority);

  return {
    ok: true,
    proposed_missions,
    intent_logs,
    gaps_identified,
  };
}

/**
 * Get a human-readable summary of the plan.
 */
export function summarizePlan(output: PlannerOutput): string {
  if (output.proposed_missions.length === 0) {
    return "No research missions recommended at this time.";
  }

  const lines = ["Buddy recommends the following research:"];
  for (const mission of output.proposed_missions) {
    lines.push(`\n${mission.priority}. ${formatMissionType(mission.mission_type)}`);
    lines.push(`   Rationale: ${mission.rationale}`);
    lines.push(`   Confidence: ${Math.round(mission.confidence * 100)}%`);
  }

  if (output.gaps_identified.length > 0) {
    lines.push("\nPending (waiting for prerequisites):");
    for (const gap of output.gaps_identified) {
      lines.push(`• ${gap}`);
    }
  }

  return lines.join("\n");
}

/**
 * Format mission type for display.
 */
function formatMissionType(type: MissionType): string {
  const labels: Record<MissionType, string> = {
    industry_landscape: "Industry & Competitive Landscape",
    competitive_analysis: "Competitive Analysis",
    market_demand: "Market Demand & Demographics",
    demographics: "Demographics",
    regulatory_environment: "Regulatory Environment",
    management_backgrounds: "Management & Ownership Backgrounds",
  };
  return labels[type] ?? type;
}
