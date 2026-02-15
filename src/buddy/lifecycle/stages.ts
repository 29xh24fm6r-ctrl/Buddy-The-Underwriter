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
