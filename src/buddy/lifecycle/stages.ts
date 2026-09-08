/**
 * Lifecycle Stage Metadata
 *
 * Declarative stage definitions with per-stage properties.
 * Tests and blocker logic use stageRequiresDocuments() — never hardcoded stage names.
 */

import type { LifecycleStage } from "./model";

type StageDefinition = {
  code: LifecycleStage;
  requiresDocuments: boolean;
};

export const LIFECYCLE_STAGES: StageDefinition[] = [
  { code: "intake_created", requiresDocuments: false },
  { code: "docs_requested", requiresDocuments: true },
  { code: "docs_in_progress", requiresDocuments: true },
  { code: "docs_satisfied", requiresDocuments: true },
  { code: "memo_inputs_required", requiresDocuments: true },
  { code: "underwrite_ready", requiresDocuments: true },
  { code: "underwrite_in_progress", requiresDocuments: false },
  { code: "committee_ready", requiresDocuments: false },
  { code: "committee_decisioned", requiresDocuments: false },
  { code: "closing_in_progress", requiresDocuments: false },
  { code: "closed", requiresDocuments: false },
  { code: "workout", requiresDocuments: false },
];

export function stageRequiresDocuments(stage: LifecycleStage): boolean {
  const def = LIFECYCLE_STAGES.find((s) => s.code === stage);
  return def?.requiresDocuments ?? false;
}

/**
 * Position of a stage in the linear progression (workout is the branch
 * terminal and sorts last). -1 for an unknown stage.
 */
export function lifecycleStageIndex(stage: LifecycleStage): number {
  return LIFECYCLE_STAGES.findIndex((s) => s.code === stage);
}

/**
 * True when `stage` is `target` or any later stage. Used by automation that
 * may only move a deal forward: a deal already past its readiness-derived
 * target must be left alone, never asked to advance again.
 */
export function isStageAtOrBeyond(
  stage: LifecycleStage,
  target: LifecycleStage,
): boolean {
  const a = lifecycleStageIndex(stage);
  const b = lifecycleStageIndex(target);
  if (a < 0 || b < 0) return false;
  return a >= b;
}
