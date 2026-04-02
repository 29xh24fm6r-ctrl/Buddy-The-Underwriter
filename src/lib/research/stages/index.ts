/**
 * Research Stages — Phase 66A (Commit 4)
 *
 * Refactored stage definitions for the research pipeline.
 * Each stage is a named, typed unit of work that can be:
 * - Tracked via thread runs
 * - Checkpointed for resume
 * - Independently retried
 *
 * This module provides the stage registry and execution helpers
 * used by brieRuntime.ts and runMission.ts.
 */

import type { CheckpointStage } from "../checkpoint";

// ============================================================================
// Stage Definition
// ============================================================================

export type StageDefinition = {
  name: CheckpointStage;
  label: string;
  description: string;
  /** Stages that must complete before this one can start */
  dependsOn: CheckpointStage[];
  /** Whether this stage can be skipped without failing the mission */
  optional: boolean;
  /** Default timeout in ms */
  timeoutMs: number;
  /** Whether the stage supports partial resume */
  resumable: boolean;
};

// ============================================================================
// Stage Registry
// ============================================================================

export const STAGE_REGISTRY: StageDefinition[] = [
  {
    name: "source_discovery",
    label: "Source Discovery",
    description: "Discover data sources based on mission type and subject",
    dependsOn: [],
    optional: false,
    timeoutMs: 30_000,
    resumable: false,
  },
  {
    name: "source_ingestion",
    label: "Source Ingestion",
    description: "Fetch and store raw data from discovered sources",
    dependsOn: ["source_discovery"],
    optional: false,
    timeoutMs: 60_000,
    resumable: true, // Can resume from last ingested source
  },
  {
    name: "fact_extraction",
    label: "Fact Extraction",
    description: "Extract typed, citable facts from ingested sources",
    dependsOn: ["source_ingestion"],
    optional: false,
    timeoutMs: 30_000,
    resumable: true, // Can resume from last extracted source
  },
  {
    name: "inference_derivation",
    label: "Inference Derivation",
    description: "Derive conclusions from extracted facts",
    dependsOn: ["fact_extraction"],
    optional: false,
    timeoutMs: 20_000,
    resumable: false,
  },
  {
    name: "narrative_compilation",
    label: "Narrative Compilation",
    description: "Compile citation-backed narrative from facts and inferences",
    dependsOn: ["inference_derivation"],
    optional: false,
    timeoutMs: 30_000,
    resumable: false,
  },
  {
    name: "bie_enrichment",
    label: "BIE Enrichment",
    description: "Deep company research via Buddy Intelligence Engine",
    dependsOn: ["narrative_compilation"],
    optional: true, // Non-fatal
    timeoutMs: 120_000,
    resumable: false,
  },
  {
    name: "gap_analysis",
    label: "Gap Analysis",
    description: "Compute deal gaps based on research findings",
    dependsOn: ["narrative_compilation"],
    optional: true, // Non-fatal
    timeoutMs: 15_000,
    resumable: false,
  },
  {
    name: "flag_bridging",
    label: "Flag Bridging",
    description: "Bridge research inferences to risk flags",
    dependsOn: ["inference_derivation"],
    optional: true, // Non-fatal
    timeoutMs: 10_000,
    resumable: false,
  },
];

/**
 * Get a stage definition by name.
 */
export function getStageDefinition(name: CheckpointStage): StageDefinition | undefined {
  return STAGE_REGISTRY.find((s) => s.name === name);
}

/**
 * Get stages that can execute given a set of completed stages.
 */
export function getExecutableStages(completedStages: Set<CheckpointStage>): StageDefinition[] {
  return STAGE_REGISTRY.filter((stage) => {
    if (completedStages.has(stage.name)) return false;
    return stage.dependsOn.every((dep) => completedStages.has(dep));
  });
}

/**
 * Get stages in dependency order (topological sort).
 */
export function getStagesInOrder(): StageDefinition[] {
  return [...STAGE_REGISTRY]; // Already in dependency order
}

/**
 * Get required stages only (non-optional).
 */
export function getRequiredStages(): StageDefinition[] {
  return STAGE_REGISTRY.filter((s) => !s.optional);
}
