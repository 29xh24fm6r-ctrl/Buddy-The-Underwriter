/**
 * Buddy Research Engine - Core Types
 *
 * Every type here maps to the database schema.
 * These are the building blocks for auditable, citation-backed research.
 */

// ============================================================================
// Mission Types
// ============================================================================

export type MissionType =
  | "industry_landscape"
  | "competitive_analysis"
  | "market_demand"
  | "demographics"
  | "regulatory_environment"
  | "management_backgrounds";

export type MissionDepth = "overview" | "committee" | "deep_dive";

export type MissionStatus = "queued" | "running" | "complete" | "failed" | "cancelled";

export type MissionSubject = {
  naics_code?: string;
  sic_code?: string;
  geography?: string;
  company_name?: string;
  keywords?: string[];
};

export type ResearchMission = {
  id: string;
  deal_id: string;
  bank_id?: string | null;
  mission_type: MissionType;
  subject: MissionSubject;
  depth: MissionDepth;
  status: MissionStatus;
  error_message?: string | null;
  sources_count: number;
  facts_count: number;
  inferences_count: number;
  created_at: string;
  started_at?: string | null;
  completed_at?: string | null;
  created_by?: string | null;
  correlation_id?: string | null;
};

// ============================================================================
// Source Types
// ============================================================================

export type SourceClass =
  | "government"
  | "regulatory"
  | "industry"
  | "company"
  | "geography"
  | "news";

export type DiscoveredSource = {
  source_class: SourceClass;
  source_name: string;
  url: string;
  fetch_kind: "json" | "html" | "xml";
  priority: number; // Lower = higher priority
};

export type ResearchSource = {
  id: string;
  mission_id: string;
  source_class: SourceClass;
  source_name: string;
  source_url: string;
  raw_content: unknown;
  content_type?: string | null;
  checksum: string;
  retrieved_at: string;
  http_status?: number | null;
  fetch_duration_ms?: number | null;
  fetch_error?: string | null;
};

// ============================================================================
// Fact Types
// ============================================================================

export type FactType =
  // Industry facts
  | "market_size"
  | "market_growth_rate"
  | "employment_count"
  | "employment_growth"
  | "average_wage"
  | "establishment_count"
  // Competitive facts
  | "competitor_name"
  | "competitor_ticker"
  | "competitor_revenue"
  | "competitor_employees"
  | "market_share_estimate"
  // Geographic facts
  | "population"
  | "median_income"
  | "business_density"
  // Regulatory facts
  | "regulatory_body"
  | "compliance_requirement"
  | "recent_enforcement"
  // General
  | "other";

export type FactValue =
  | MarketSizeValue
  | GrowthRateValue
  | EmploymentValue
  | CompetitorValue
  | NumericValue
  | TextValue;

export type MarketSizeValue = {
  amount: number;
  currency: string;
  year: number;
  scope: string;
};

export type GrowthRateValue = {
  rate: number; // Percentage, e.g., 0.05 = 5%
  period: string; // e.g., "5Y", "1Y", "YoY"
  start_year?: number;
  end_year?: number;
};

export type EmploymentValue = {
  count: number;
  year: number;
  geography: string;
  change_pct?: number;
};

export type CompetitorValue = {
  name: string;
  cik?: string;
  ticker?: string;
  sic_code?: string;
};

export type NumericValue = {
  value: number;
  unit?: string;
  year?: number;
  geography?: string;
};

export type TextValue = {
  text: string;
  category?: string;
};

export type ResearchFact = {
  id: string;
  mission_id: string;
  source_id: string;
  fact_type: FactType;
  value: FactValue;
  confidence: number;
  extracted_by: "rule" | "model";
  extraction_path?: string | null;
  extracted_at: string;
  as_of_date?: string | null;
};

// ============================================================================
// Inference Types
// ============================================================================

export type InferenceType =
  | "competitive_intensity"
  | "market_attractiveness"
  | "growth_trajectory"
  | "cyclicality_risk"
  | "barrier_to_entry"
  | "regulatory_burden"
  | "geographic_concentration"
  | "tailwind"
  | "headwind"
  | "other";

export type ResearchInference = {
  id: string;
  mission_id: string;
  inference_type: InferenceType;
  conclusion: string;
  input_fact_ids: string[];
  confidence: number;
  reasoning?: string | null;
  created_at: string;
};

// ============================================================================
// Narrative Types
// ============================================================================

export type CitationType = "fact" | "inference";

export type Citation = {
  type: CitationType;
  id: string;
};

export type NarrativeSentence = {
  text: string;
  citations: Citation[];
};

export type NarrativeSection = {
  title: string;
  sentences: NarrativeSentence[];
};

export type ResearchNarrative = {
  id: string;
  mission_id: string;
  sections: NarrativeSection[];
  version: number;
  compiled_at: string;
};

// ============================================================================
// API Response Types
// ============================================================================

export type StartMissionInput = {
  mission_type: MissionType;
  subject: MissionSubject;
  depth?: MissionDepth;
};

export type StartMissionResult = {
  ok: boolean;
  mission_id?: string;
  error?: string;
};

export type FetchMissionResult = {
  ok: boolean;
  mission?: ResearchMission;
  sources?: Array<{
    id: string;
    source_class: SourceClass;
    source_name: string;
    source_url: string;
    retrieved_at: string;
  }>;
  facts?: ResearchFact[];
  inferences?: ResearchInference[];
  narrative?: NarrativeSection[];
  error?: string;
};

// ============================================================================
// Engine Types (Internal)
// ============================================================================

export type SourceIngestionResult = {
  ok: boolean;
  source?: ResearchSource;
  error?: string;
};

export type FactExtractionResult = {
  facts: Array<Omit<ResearchFact, "id" | "mission_id" | "extracted_at">>;
};

export type InferenceDerivationResult = {
  inferences: Array<Omit<ResearchInference, "id" | "mission_id" | "created_at">>;
};

export type NarrativeCompilationResult = {
  ok: boolean;
  sections: NarrativeSection[];
  error?: string;
};

export type MissionExecutionResult = {
  ok: boolean;
  mission_id: string;
  sources_count: number;
  facts_count: number;
  inferences_count: number;
  narrative_sections: number;
  error?: string;
  duration_ms: number;
};
