/**
 * Research Playbook - Canonical Configuration
 *
 * Single source of truth for mission definitions.
 * Adding a new mission type should be config-only unless a new source class is introduced.
 *
 * Structure:
 * - Mission definitions (type, description, priority)
 * - Trigger conditions (when to run)
 * - Source discovery mappings
 * - Fact extractor mappings
 * - Inference rules
 * - Narrative templates
 */

import type { MissionType, MissionDepth, SourceClass, FactType, InferenceType } from "./types";

// ============================================================================
// Mission Definitions
// ============================================================================

export type MissionDefinition = {
  type: MissionType;
  label: string;
  description: string;
  priority: number; // Lower = higher priority
  default_depth: MissionDepth;
  required_subject_fields: Array<keyof MissionSubjectFields>;
  optional_subject_fields: Array<keyof MissionSubjectFields>;
  max_sources: number;
  max_fetch_seconds: number;
  max_extract_seconds: number;
};

export type MissionSubjectFields = {
  naics_code: string;
  sic_code: string;
  geography: string;
  company_name: string;
  keywords: string[];
};

export const MISSION_DEFINITIONS: Record<MissionType, MissionDefinition> = {
  industry_landscape: {
    type: "industry_landscape",
    label: "Industry & Competitive Landscape",
    description: "Analyze industry size, growth, employment, and competitive dynamics",
    priority: 1,
    default_depth: "committee",
    required_subject_fields: ["naics_code"],
    optional_subject_fields: ["geography", "sic_code"],
    max_sources: 10,
    max_fetch_seconds: 60,
    max_extract_seconds: 30,
  },

  competitive_analysis: {
    type: "competitive_analysis",
    label: "Competitive Analysis",
    description: "Identify major competitors, market shares, and competitive positioning",
    priority: 2,
    default_depth: "committee",
    required_subject_fields: ["naics_code"],
    optional_subject_fields: ["company_name", "geography"],
    max_sources: 8,
    max_fetch_seconds: 45,
    max_extract_seconds: 20,
  },

  market_demand: {
    type: "market_demand",
    label: "Market Demand & Demographics",
    description: "Assess market demand drivers and demographic factors",
    priority: 3,
    default_depth: "committee",
    required_subject_fields: ["geography"],
    optional_subject_fields: ["naics_code"],
    max_sources: 8,
    max_fetch_seconds: 45,
    max_extract_seconds: 20,
  },

  demographics: {
    type: "demographics",
    label: "Demographics",
    description: "Detailed demographic analysis for consumer-facing businesses",
    priority: 4,
    default_depth: "committee",
    required_subject_fields: ["geography"],
    optional_subject_fields: ["naics_code"],
    max_sources: 6,
    max_fetch_seconds: 30,
    max_extract_seconds: 15,
  },

  regulatory_environment: {
    type: "regulatory_environment",
    label: "Regulatory Environment",
    description: "Analyze regulatory requirements, compliance burden, and enforcement trends",
    priority: 5,
    default_depth: "committee",
    required_subject_fields: ["naics_code"],
    optional_subject_fields: ["geography"],
    max_sources: 10,
    max_fetch_seconds: 60,
    max_extract_seconds: 30,
  },

  management_backgrounds: {
    type: "management_backgrounds",
    label: "Management & Ownership Backgrounds",
    description: "Research principal backgrounds, experience, and adverse events",
    priority: 6,
    default_depth: "committee",
    required_subject_fields: ["keywords"], // Principal names
    optional_subject_fields: ["company_name"],
    max_sources: 12,
    max_fetch_seconds: 90,
    max_extract_seconds: 45,
  },

  lender_fit_analysis: {
    type: "lender_fit_analysis",
    label: "Lender Fit Analysis",
    description: "Match deal to SBA/USDA/CDFI programs and assess eligibility",
    priority: 7,
    default_depth: "committee",
    required_subject_fields: ["naics_code"],
    optional_subject_fields: ["geography"],
    max_sources: 10,
    max_fetch_seconds: 45,
    max_extract_seconds: 20,
  },

  scenario_stress: {
    type: "scenario_stress",
    label: "Scenario Stress Analysis",
    description: "Quantify downside risk, breakeven analysis, and economic sensitivity",
    priority: 8,
    default_depth: "committee",
    required_subject_fields: [],
    optional_subject_fields: ["naics_code"],
    max_sources: 8,
    max_fetch_seconds: 45,
    max_extract_seconds: 20,
  },
};

// ============================================================================
// Source Class Configuration
// ============================================================================

export type SourceClassConfig = {
  class: SourceClass;
  label: string;
  trust_score: number; // 0-1, higher = more trusted
  rate_limit_rpm: number; // Requests per minute
  timeout_ms: number;
  max_response_size_bytes: number;
};

export const SOURCE_CLASS_CONFIG: Record<SourceClass, SourceClassConfig> = {
  government: {
    class: "government",
    label: "Government Data",
    trust_score: 0.95,
    rate_limit_rpm: 60,
    timeout_ms: 30000,
    max_response_size_bytes: 5 * 1024 * 1024, // 5MB
  },
  regulatory: {
    class: "regulatory",
    label: "Regulatory Data",
    trust_score: 0.95,
    rate_limit_rpm: 30,
    timeout_ms: 45000,
    max_response_size_bytes: 10 * 1024 * 1024, // 10MB
  },
  industry: {
    class: "industry",
    label: "Industry Data",
    trust_score: 0.8,
    rate_limit_rpm: 30,
    timeout_ms: 30000,
    max_response_size_bytes: 5 * 1024 * 1024,
  },
  company: {
    class: "company",
    label: "Company Data",
    trust_score: 0.75,
    rate_limit_rpm: 20,
    timeout_ms: 30000,
    max_response_size_bytes: 5 * 1024 * 1024,
  },
  geography: {
    class: "geography",
    label: "Geographic Data",
    trust_score: 0.9,
    rate_limit_rpm: 60,
    timeout_ms: 20000,
    max_response_size_bytes: 2 * 1024 * 1024,
  },
  news: {
    class: "news",
    label: "News Data",
    trust_score: 0.6,
    rate_limit_rpm: 20,
    timeout_ms: 20000,
    max_response_size_bytes: 1 * 1024 * 1024,
  },
};

// ============================================================================
// Fact Type Configuration
// ============================================================================

export type FactTypeConfig = {
  type: FactType;
  label: string;
  category: "industry" | "competitive" | "geographic" | "demographic" | "regulatory" | "management" | "lender_fit" | "scenario_stress" | "general";
  primary_missions: MissionType[];
};

export const FACT_TYPE_CONFIG: Record<FactType, FactTypeConfig> = {
  // Industry facts
  market_size: { type: "market_size", label: "Market Size", category: "industry", primary_missions: ["industry_landscape"] },
  market_growth_rate: { type: "market_growth_rate", label: "Market Growth Rate", category: "industry", primary_missions: ["industry_landscape"] },
  employment_count: { type: "employment_count", label: "Employment Count", category: "industry", primary_missions: ["industry_landscape"] },
  employment_growth: { type: "employment_growth", label: "Employment Growth", category: "industry", primary_missions: ["industry_landscape"] },
  average_wage: { type: "average_wage", label: "Average Wage", category: "industry", primary_missions: ["industry_landscape"] },
  establishment_count: { type: "establishment_count", label: "Establishment Count", category: "industry", primary_missions: ["industry_landscape"] },

  // Competitive facts
  competitor_name: { type: "competitor_name", label: "Competitor Name", category: "competitive", primary_missions: ["competitive_analysis"] },
  competitor_ticker: { type: "competitor_ticker", label: "Competitor Ticker", category: "competitive", primary_missions: ["competitive_analysis"] },
  competitor_revenue: { type: "competitor_revenue", label: "Competitor Revenue", category: "competitive", primary_missions: ["competitive_analysis"] },
  competitor_employees: { type: "competitor_employees", label: "Competitor Employees", category: "competitive", primary_missions: ["competitive_analysis"] },
  market_share_estimate: { type: "market_share_estimate", label: "Market Share Estimate", category: "competitive", primary_missions: ["competitive_analysis"] },

  // Geographic facts
  population: { type: "population", label: "Population", category: "geographic", primary_missions: ["market_demand", "demographics"] },
  median_income: { type: "median_income", label: "Median Income", category: "geographic", primary_missions: ["market_demand", "demographics"] },
  per_capita_income: { type: "per_capita_income", label: "Per Capita Income", category: "geographic", primary_missions: ["demographics"] },
  median_home_value: { type: "median_home_value", label: "Median Home Value", category: "geographic", primary_missions: ["demographics"] },
  median_age: { type: "median_age", label: "Median Age", category: "geographic", primary_missions: ["demographics"] },
  business_density: { type: "business_density", label: "Business Density", category: "geographic", primary_missions: ["market_demand"] },

  // Demographic facts
  population_growth_rate: { type: "population_growth_rate", label: "Population Growth Rate", category: "demographic", primary_missions: ["demographics"] },
  college_educated_pct: { type: "college_educated_pct", label: "College Educated %", category: "demographic", primary_missions: ["demographics"] },
  unemployment_rate: { type: "unemployment_rate", label: "Unemployment Rate", category: "demographic", primary_missions: ["demographics"] },
  housing_units: { type: "housing_units", label: "Housing Units", category: "demographic", primary_missions: ["demographics"] },
  housing_occupancy_rate: { type: "housing_occupancy_rate", label: "Housing Occupancy Rate", category: "demographic", primary_missions: ["demographics"] },

  // Regulatory facts
  regulatory_body: { type: "regulatory_body", label: "Regulatory Body", category: "regulatory", primary_missions: ["regulatory_environment"] },
  compliance_requirement: { type: "compliance_requirement", label: "Compliance Requirement", category: "regulatory", primary_missions: ["regulatory_environment"] },
  recent_enforcement: { type: "recent_enforcement", label: "Recent Enforcement", category: "regulatory", primary_missions: ["regulatory_environment"] },
  licensing_required: { type: "licensing_required", label: "Licensing Required", category: "regulatory", primary_missions: ["regulatory_environment"] },
  regulatory_burden_level: { type: "regulatory_burden_level", label: "Regulatory Burden Level", category: "regulatory", primary_missions: ["regulatory_environment"] },
  state_specific_constraint: { type: "state_specific_constraint", label: "State-Specific Constraint", category: "regulatory", primary_missions: ["regulatory_environment"] },
  compliance_cost_indicator: { type: "compliance_cost_indicator", label: "Compliance Cost Indicator", category: "regulatory", primary_missions: ["regulatory_environment"] },
  enforcement_action_count: { type: "enforcement_action_count", label: "Enforcement Action Count", category: "regulatory", primary_missions: ["regulatory_environment"] },
  federal_rule_count: { type: "federal_rule_count", label: "Federal Rule Count", category: "regulatory", primary_missions: ["regulatory_environment"] },

  // Management facts
  years_experience: { type: "years_experience", label: "Years Experience", category: "management", primary_missions: ["management_backgrounds"] },
  prior_entity: { type: "prior_entity", label: "Prior Entity", category: "management", primary_missions: ["management_backgrounds"] },
  role_history: { type: "role_history", label: "Role History", category: "management", primary_missions: ["management_backgrounds"] },
  adverse_event: { type: "adverse_event", label: "Adverse Event", category: "management", primary_missions: ["management_backgrounds"] },
  sanctions_status: { type: "sanctions_status", label: "Sanctions Status", category: "management", primary_missions: ["management_backgrounds"] },
  bankruptcy_history: { type: "bankruptcy_history", label: "Bankruptcy History", category: "management", primary_missions: ["management_backgrounds"] },
  litigation_history: { type: "litigation_history", label: "Litigation History", category: "management", primary_missions: ["management_backgrounds"] },

  // Lender fit facts (Phase 6)
  lender_program: { type: "lender_program", label: "Lender Program", category: "lender_fit", primary_missions: ["lender_fit_analysis"] },
  program_eligibility: { type: "program_eligibility", label: "Program Eligibility", category: "lender_fit", primary_missions: ["lender_fit_analysis"] },
  size_standard_threshold: { type: "size_standard_threshold", label: "Size Standard Threshold", category: "lender_fit", primary_missions: ["lender_fit_analysis"] },
  collateral_requirement: { type: "collateral_requirement", label: "Collateral Requirement", category: "lender_fit", primary_missions: ["lender_fit_analysis"] },
  interest_rate_range: { type: "interest_rate_range", label: "Interest Rate Range", category: "lender_fit", primary_missions: ["lender_fit_analysis"] },
  term_limit: { type: "term_limit", label: "Term Limit", category: "lender_fit", primary_missions: ["lender_fit_analysis"] },
  geographic_restriction: { type: "geographic_restriction", label: "Geographic Restriction", category: "lender_fit", primary_missions: ["lender_fit_analysis"] },
  industry_restriction: { type: "industry_restriction", label: "Industry Restriction", category: "lender_fit", primary_missions: ["lender_fit_analysis"] },

  // Scenario stress facts (Phase 7)
  revenue_sensitivity: { type: "revenue_sensitivity", label: "Revenue Sensitivity", category: "scenario_stress", primary_missions: ["scenario_stress"] },
  margin_sensitivity: { type: "margin_sensitivity", label: "Margin Sensitivity", category: "scenario_stress", primary_missions: ["scenario_stress"] },
  interest_rate_sensitivity: { type: "interest_rate_sensitivity", label: "Interest Rate Sensitivity", category: "scenario_stress", primary_missions: ["scenario_stress"] },
  dscr_baseline: { type: "dscr_baseline", label: "DSCR Baseline", category: "scenario_stress", primary_missions: ["scenario_stress"] },
  breakeven_threshold: { type: "breakeven_threshold", label: "Breakeven Threshold", category: "scenario_stress", primary_missions: ["scenario_stress"] },

  // General
  other: { type: "other", label: "Other", category: "general", primary_missions: [] },
};

// ============================================================================
// Inference Type Configuration
// ============================================================================

export type InferenceTypeConfig = {
  type: InferenceType;
  label: string;
  category: "competitive" | "market" | "regulatory" | "management" | "lender_fit" | "stress" | "institutional" | "general";
  risk_indicator: boolean;
  primary_missions: MissionType[];
};

export const INFERENCE_TYPE_CONFIG: Record<InferenceType, InferenceTypeConfig> = {
  competitive_intensity: { type: "competitive_intensity", label: "Competitive Intensity", category: "competitive", risk_indicator: true, primary_missions: ["competitive_analysis"] },
  market_attractiveness: { type: "market_attractiveness", label: "Market Attractiveness", category: "market", risk_indicator: false, primary_missions: ["industry_landscape", "market_demand"] },
  growth_trajectory: { type: "growth_trajectory", label: "Growth Trajectory", category: "market", risk_indicator: false, primary_missions: ["industry_landscape"] },
  cyclicality_risk: { type: "cyclicality_risk", label: "Cyclicality Risk", category: "market", risk_indicator: true, primary_missions: ["industry_landscape"] },
  barrier_to_entry: { type: "barrier_to_entry", label: "Barrier to Entry", category: "competitive", risk_indicator: false, primary_missions: ["competitive_analysis"] },
  regulatory_burden: { type: "regulatory_burden", label: "Regulatory Burden", category: "regulatory", risk_indicator: true, primary_missions: ["regulatory_environment"] },
  geographic_concentration: { type: "geographic_concentration", label: "Geographic Concentration", category: "market", risk_indicator: true, primary_missions: ["market_demand", "demographics"] },
  tailwind: { type: "tailwind", label: "Tailwind", category: "market", risk_indicator: false, primary_missions: ["industry_landscape", "market_demand"] },
  headwind: { type: "headwind", label: "Headwind", category: "market", risk_indicator: true, primary_missions: ["industry_landscape", "market_demand"] },

  // Regulatory inferences
  regulatory_risk_level: { type: "regulatory_risk_level", label: "Regulatory Risk Level", category: "regulatory", risk_indicator: true, primary_missions: ["regulatory_environment"] },
  expansion_constraint_risk: { type: "expansion_constraint_risk", label: "Expansion Constraint Risk", category: "regulatory", risk_indicator: true, primary_missions: ["regulatory_environment"] },
  licensing_complexity: { type: "licensing_complexity", label: "Licensing Complexity", category: "regulatory", risk_indicator: false, primary_missions: ["regulatory_environment"] },

  // Management inferences
  execution_risk_level: { type: "execution_risk_level", label: "Execution Risk Level", category: "management", risk_indicator: true, primary_missions: ["management_backgrounds"] },
  management_depth: { type: "management_depth", label: "Management Depth", category: "management", risk_indicator: false, primary_missions: ["management_backgrounds"] },
  adverse_event_risk: { type: "adverse_event_risk", label: "Adverse Event Risk", category: "management", risk_indicator: true, primary_missions: ["management_backgrounds"] },

  // Demand stability
  demand_stability: { type: "demand_stability", label: "Demand Stability", category: "market", risk_indicator: false, primary_missions: ["market_demand"] },

  // Lender fit inferences (Phase 6)
  lender_program_fit: { type: "lender_program_fit", label: "Lender Program Fit", category: "lender_fit", risk_indicator: true, primary_missions: ["lender_fit_analysis"] },
  collateral_adequacy: { type: "collateral_adequacy", label: "Collateral Adequacy", category: "lender_fit", risk_indicator: false, primary_missions: ["lender_fit_analysis"] },
  eligibility_assessment: { type: "eligibility_assessment", label: "Eligibility Assessment", category: "lender_fit", risk_indicator: false, primary_missions: ["lender_fit_analysis"] },

  // Scenario stress inferences (Phase 7)
  stress_resilience: { type: "stress_resilience", label: "Stress Resilience", category: "stress", risk_indicator: true, primary_missions: ["scenario_stress"] },
  downside_risk: { type: "downside_risk", label: "Downside Risk", category: "stress", risk_indicator: true, primary_missions: ["scenario_stress"] },
  breakeven_cushion: { type: "breakeven_cushion", label: "Breakeven Cushion", category: "stress", risk_indicator: false, primary_missions: ["scenario_stress"] },

  // Institutional learning (Phase 8)
  historical_performance_pattern: { type: "historical_performance_pattern", label: "Historical Performance Pattern", category: "institutional", risk_indicator: false, primary_missions: [] },

  // General
  other: { type: "other", label: "Other", category: "general", risk_indicator: false, primary_missions: [] },
};

// ============================================================================
// Narrative Templates
// ============================================================================

export type NarrativeTemplate = {
  mission_type: MissionType;
  section_title: string;
  section_order: number;
  include_in_summary: boolean;
};

export const NARRATIVE_TEMPLATES: NarrativeTemplate[] = [
  { mission_type: "industry_landscape", section_title: "Industry Landscape", section_order: 1, include_in_summary: true },
  { mission_type: "competitive_analysis", section_title: "Competitive Analysis", section_order: 2, include_in_summary: true },
  { mission_type: "market_demand", section_title: "Market Demand", section_order: 3, include_in_summary: true },
  { mission_type: "demographics", section_title: "Demographics", section_order: 4, include_in_summary: false },
  { mission_type: "regulatory_environment", section_title: "Regulatory Environment", section_order: 5, include_in_summary: true },
  { mission_type: "management_backgrounds", section_title: "Management Backgrounds", section_order: 6, include_in_summary: true },
  { mission_type: "lender_fit_analysis", section_title: "Lender Fit Analysis", section_order: 7, include_in_summary: true },
  { mission_type: "scenario_stress", section_title: "Scenario Stress Analysis", section_order: 8, include_in_summary: true },
];

// ============================================================================
// Autonomy Levels
// ============================================================================

export type AutonomyLevel = "OFF" | "RECOMMEND" | "AUTO_RUN";

export const AUTONOMY_LEVEL_CONFIG: Record<AutonomyLevel, { label: string; description: string; auto_execute: boolean }> = {
  OFF: {
    label: "Off",
    description: "No research planning or execution",
    auto_execute: false,
  },
  RECOMMEND: {
    label: "Recommend",
    description: "Create research plan for user approval before execution",
    auto_execute: false,
  },
  AUTO_RUN: {
    label: "Auto Run",
    description: "Automatically execute research plan",
    auto_execute: true,
  },
};

export const DEFAULT_AUTONOMY_LEVEL: AutonomyLevel = "RECOMMEND";

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Get mission definition by type.
 */
export function getMissionDefinition(type: MissionType): MissionDefinition {
  return MISSION_DEFINITIONS[type];
}

/**
 * Get all mission types in priority order.
 */
export function getMissionTypesInOrder(): MissionType[] {
  return Object.values(MISSION_DEFINITIONS)
    .sort((a, b) => a.priority - b.priority)
    .map((def) => def.type);
}

/**
 * Get source class configuration.
 */
export function getSourceClassConfig(sourceClass: SourceClass): SourceClassConfig {
  return SOURCE_CLASS_CONFIG[sourceClass];
}

/**
 * Get fact type configuration.
 */
export function getFactTypeConfig(factType: FactType): FactTypeConfig {
  return FACT_TYPE_CONFIG[factType];
}

/**
 * Get inference type configuration.
 */
export function getInferenceTypeConfig(inferenceType: InferenceType): InferenceTypeConfig {
  return INFERENCE_TYPE_CONFIG[inferenceType];
}

/**
 * Get narrative template for a mission type.
 */
export function getNarrativeTemplate(missionType: MissionType): NarrativeTemplate | undefined {
  return NARRATIVE_TEMPLATES.find((t) => t.mission_type === missionType);
}

/**
 * Check if an inference type is a risk indicator.
 */
export function isRiskIndicator(inferenceType: InferenceType): boolean {
  return INFERENCE_TYPE_CONFIG[inferenceType]?.risk_indicator ?? false;
}

/**
 * Get all risk indicator inference types.
 */
export function getRiskIndicatorInferenceTypes(): InferenceType[] {
  return Object.values(INFERENCE_TYPE_CONFIG)
    .filter((config) => config.risk_indicator)
    .map((config) => config.type);
}
