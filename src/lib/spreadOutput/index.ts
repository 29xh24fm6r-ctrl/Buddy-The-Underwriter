/**
 * Spread Output Layer — Barrel Exports
 *
 * Pure functions only. No server-only dependencies.
 */

// Orchestrator
export { composeSpreadOutput } from "./spreadOutputComposer";

// Individual generators (for testing / direct use)
export { detectDealType } from "./dealTypeDetection";
export { composeNarratives } from "./narrativeComposer";
export { generateExecutiveSummary } from "./executiveSummaryGenerator";
export { buildNormalizedSpread } from "./normalizedSpreadBuilder";
export { buildRatioScorecard, formatRatioValue } from "./ratioScorecardBuilder";
export { generateStoryPanel } from "./storyPanelGenerator";
export { getSpreadTemplate, getSupportedDealTypes } from "./spreadTemplateRegistry";

// Types
export type {
  DealType,
  SpreadOutputInput,
  SpreadOutputReport,
  BankPolicyConfig,
  ExecutiveSummary,
  RecommendationLevel,
  NormalizedSpread,
  NormalizedLineItem,
  LineItemCategory,
  SpreadAdjustment,
  RatioScorecardReport,
  RatioGroup,
  RatioScorecardItem,
  RatioAssessment,
  StoryPanel,
  StoryElement,
  CovenantSuggestion,
  QoEReport,
  TrendReport,
  ConsolidatedSpread,
} from "./types";

export { DEFAULT_BANK_POLICY } from "./types";

// Narrative types
export type { ComposedNarratives } from "./narrativeComposer";
