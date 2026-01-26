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

// Note: runMission and runIndustryLandscapeMission are server-only
// Import them directly from "@/lib/research/runMission" in server contexts
