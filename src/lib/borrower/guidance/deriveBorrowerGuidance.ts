/**
 * Phase 54B — Canonical Borrower Guidance Engine
 *
 * Single source of truth for "what should this borrower do next?"
 * Composes: status derivation, explanation engine, prioritizer, readiness calculator.
 *
 * Pure function — no DB calls. Accepts pre-fetched data.
 */

import { deriveConditionStatus, type ConditionInput } from "@/lib/conditions/deriveConditionStatus";
import { explainConditionForBorrower } from "./explainConditionForBorrower";
import { prioritizeBorrowerActions, type PrioritizableCondition } from "./prioritizeBorrowerActions";
import { calculateBorrowerReadiness, type ReadinessCondition } from "./calculateBorrowerReadiness";
import type { BorrowerGuidancePayload, ConditionGuidance } from "./types";

type EvidenceItem = {
  doc_type?: string;
  confidence?: number;
  distinct_key_value?: string | null;
  happened_at?: string;
  source?: string;
};

export type GuidanceConditionInput = {
  id: string;
  title: string;
  description?: string | null;
  category?: string | null;
  severity?: "REQUIRED" | "IMPORTANT" | "FYI" | string | null;
  dueDate?: string | null;
  dbStatus: string;
  evidence: EvidenceItem[];
  linkedDocCount: number;
  hasBorrowerUpload: boolean;
  classificationPending?: boolean;
  manualOverride?: "satisfied" | "rejected" | "waived" | null;
  rejectionReason?: string | null;
  requiredDocs?: Array<{ label?: string; key?: string }>;
  examples?: string[];
  borrowerExplanation?: string;
  stalledDays?: number;
};

/**
 * Derive complete borrower guidance from condition + evidence state.
 * This is the main engine — call once per portal load.
 */
export function deriveBorrowerGuidance(
  conditions: GuidanceConditionInput[],
): BorrowerGuidancePayload {
  const conditionGuidance: ConditionGuidance[] = [];
  const prioritizable: PrioritizableCondition[] = [];
  const readinessInputs: ReadinessCondition[] = [];
  const blockers: string[] = [];
  const warnings: string[] = [];

  for (const c of conditions) {
    // 1. Derive canonical status
    const statusInput: ConditionInput = {
      dbStatus: c.dbStatus,
      hasBorrowerUpload: c.hasBorrowerUpload,
      linkedDocCount: c.linkedDocCount,
      evidence: c.evidence,
      classificationPending: c.classificationPending,
      manualOverride: c.manualOverride,
    };
    const statusResult = deriveConditionStatus(statusInput);

    // 2. Generate explanation
    const explanation = explainConditionForBorrower({
      conditionId: c.id,
      title: c.title,
      canonicalStatus: statusResult.status,
      evidence: c.evidence,
      linkedDocCount: c.linkedDocCount,
      rejectionReason: c.rejectionReason,
      requiredDocs: c.requiredDocs,
      examples: c.examples,
      borrowerExplanation: c.borrowerExplanation,
    });
    conditionGuidance.push(explanation);

    // 3. Collect for prioritizer
    prioritizable.push({
      id: c.id,
      title: c.title,
      status: statusResult.status,
      severity: c.severity ?? null,
      dueDate: c.dueDate ?? null,
      linkedDocCount: c.linkedDocCount,
      rejectionReason: c.rejectionReason,
      stalledDays: c.stalledDays,
    });

    // 4. Collect for readiness
    readinessInputs.push({
      status: statusResult.status,
      severity: c.severity ?? null,
    });

    // 5. Collect blockers
    if (statusResult.status === "rejected" && c.severity === "REQUIRED") {
      blockers.push(`"${c.title}" was not accepted and needs re-upload`);
    }
    if (statusResult.status === "pending" && c.severity === "REQUIRED") {
      blockers.push(`"${c.title}" has not been submitted yet`);
    }
  }

  // 6. Prioritize actions
  const { primary, secondary, allBorrowerDone } = prioritizeBorrowerActions(prioritizable);

  if (allBorrowerDone && conditions.length > 0) {
    warnings.push("All items are complete. Your file is being prepared for review.");
  }

  // 7. Calculate readiness
  const readiness = calculateBorrowerReadiness(readinessInputs);

  // 8. Milestones
  const milestones: Record<string, boolean> = {
    "25": readiness.score >= 25,
    "50": readiness.score >= 50,
    "75": readiness.score >= 75,
    "100": readiness.score >= 95,
  };

  return {
    primaryNextAction: primary,
    secondaryActions: secondary,
    blockers,
    readiness,
    conditionGuidance,
    milestones,
    warnings,
    lastUpdatedAt: new Date().toISOString(),
  };
}
