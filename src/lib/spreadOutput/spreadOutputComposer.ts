/**
 * Spread Output Composer — Orchestrator
 *
 * Composes all five panels into a single SpreadOutputReport.
 * Pure function — no DB, no server imports.
 */

import type { SpreadOutputInput, SpreadOutputReport } from "./types";
import { detectDealType } from "./dealTypeDetection";
import { composeNarratives } from "./narrativeComposer";
import { generateExecutiveSummary } from "./executiveSummaryGenerator";
import { buildNormalizedSpread } from "./normalizedSpreadBuilder";
import { buildRatioScorecard } from "./ratioScorecardBuilder";
import { generateStoryPanel } from "./storyPanelGenerator";

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export function composeSpreadOutput(input: SpreadOutputInput): SpreadOutputReport {
  // 1. Detect deal type if not already set
  const deal_type = input.deal_type ?? detectDealType(input.canonical_facts);
  const resolved: SpreadOutputInput = { ...input, deal_type };

  // 2. Compose narratives (shared across panels)
  const narratives = composeNarratives(resolved);

  // 3. Generate all panels
  const executive_summary = generateExecutiveSummary(resolved, narratives);
  const normalized_spread = buildNormalizedSpread(resolved);
  const ratio_scorecard = buildRatioScorecard(resolved, narratives);
  const story_panel = generateStoryPanel(resolved, narratives);

  return {
    deal_id: input.deal_id,
    deal_type,
    executive_summary,
    normalized_spread,
    ratio_scorecard,
    story_panel,
    generated_at: new Date().toISOString(),
  };
}
