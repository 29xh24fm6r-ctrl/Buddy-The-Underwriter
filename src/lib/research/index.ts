/**
 * Buddy Research Engine (BRE)
 *
 * An auditable, citation-backed research system for commercial lending.
 * Every fact traces to a source. Every inference traces to facts.
 * No hallucinations. No uncited claims. Bank-grade auditability.
 *
 * Usage:
 *   import { runIndustryLandscapeMission } from "@/lib/research";
 *
 *   const result = await runIndustryLandscapeMission(dealId, "236", {
 *     geography: "US",
 *     depth: "committee",
 *   });
 */

// Types
export type {
  // Mission types
  MissionType,
  MissionDepth,
  MissionStatus,
  MissionSubject,
  ResearchMission,
  // Source types
  SourceClass,
  DiscoveredSource,
  ResearchSource,
  // Fact types
  FactType,
  FactValue,
  MarketSizeValue,
  GrowthRateValue,
  EmploymentValue,
  CompetitorValue,
  NumericValue,
  TextValue,
  ResearchFact,
  // Inference types
  InferenceType,
  ResearchInference,
  // Narrative types
  CitationType,
  Citation,
  NarrativeSentence,
  NarrativeSection,
  ResearchNarrative,
  // API types
  StartMissionInput,
  StartMissionResult,
  FetchMissionResult,
  // Engine types
  SourceIngestionResult,
  FactExtractionResult,
  InferenceDerivationResult,
  NarrativeCompilationResult,
  MissionExecutionResult,
} from "./types";

// Source Discovery
export {
  discoverSources,
  isValidNaicsCode,
  getNaicsIndustryName,
} from "./sourceDiscovery";

// Source Ingestion (server-only in runMission)
export {
  hasValidContent,
} from "./ingestSource";

// Fact Extraction
export {
  extractFacts,
  extractFactsFromSources,
} from "./extractFacts";

// Inference Derivation
export {
  deriveInferences,
  hasEnoughFactsForInferences,
} from "./deriveInferences";

// Narrative Compilation
export {
  compileNarrative,
  validateNarrativeCitations,
} from "./compileNarrative";

// Credit Committee Pack (Phase 5)
export type {
  CreditCommitteePackSection,
  RiskIndicator,
  CreditCommitteePack,
  CompilePackInput,
  CompilePackResult,
} from "./creditCommitteePack";

export {
  compileCreditCommitteePack,
  renderPackToMarkdown,
} from "./creditCommitteePack";

// Playbook (Configuration)
export {
  MISSION_DEFINITIONS,
  SOURCE_CLASS_CONFIG,
  FACT_TYPE_CONFIG,
  INFERENCE_TYPE_CONFIG,
  AUTONOMY_LEVEL_CONFIG,
  getMissionDefinition,
  getMissionTypesInOrder,
  getSourceClassConfig,
  getFactTypeConfig,
  getInferenceTypeConfig,
  getNarrativeTemplate,
  isRiskIndicator,
  getRiskIndicatorInferenceTypes,
} from "./playbook";

export type {
  MissionDefinition,
  SourceClassConfig,
  FactTypeConfig,
  InferenceTypeConfig,
  NarrativeTemplate,
  AutonomyLevel,
} from "./playbook";

// Source Registry
export {
  lookupSource,
  getRegistryEntry,
  getAllRegistryEntries,
  getSourceTrustScore,
  getSourceRateLimit,
  getSourceTimeout,
  getSourceHeaders,
  sourceSupportsCache,
  logBlockedSource,
  getRecentBlockedSources,
} from "./sources/registry";

export type {
  SourceRegistryEntry,
  RegistryLookupResult,
  BlockedSourceEvent,
} from "./sources/registry";

// Integrity
export {
  assertMissionIntegrity,
  assertBulkMissionIntegrity,
  buildExplainabilityGraph,
  validateExplainabilityGraph,
} from "./integrity";

export type {
  IntegrityViolation,
  IntegrityViolationCode,
  MissionIntegrityResult,
  MissionData,
  ExplainabilityNode,
  ExplainabilityEdge,
  ExplainabilityGraph,
} from "./integrity";

// Orchestration
export {
  generateRunKey,
  getTimeboxConfig,
  createTimeboxState,
  checkTimeboxLimits,
  recordSourceFetched,
  startFetchPhase,
  startExtractPhase,
  createMissionEvent,
  sortByPriority,
  getRetryDelay,
  isRetryableError,
} from "./orchestration";

export type {
  RunKeyInput,
  TimeboxConfig,
  TimeboxState,
  TimeboxCheckResult,
  MissionLifecycleEvent,
  MissionEvent,
  QueuedMission,
  RetryConfig,
} from "./orchestration";

// Industry Underwriting Context (The "Holy Shit" Moment)
export {
  deriveIndustryUnderwritingContext,
} from "./deriveIndustryUnderwritingContext";

export type {
  UnderwritingContext,
  IndustryUnderwritingInsight,
  DerivedContext,
  RecommendedAction,
} from "./deriveIndustryUnderwritingContext";

// Note: runMission and runIndustryLandscapeMission are server-only
// Import them directly from "@/lib/research/runMission" in server contexts

// Note: Fetch layer (fetchSource, fetchSourceWithCache) is server-only
// Import directly from "@/lib/research/fetch/fetchSource" in server contexts

// Note: Autonomy management is available via planner
// Import from "@/lib/research/planner/autonomy" for autonomy functions
