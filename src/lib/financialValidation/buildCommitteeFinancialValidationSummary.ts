import "server-only";

/**
 * Phase 55D — Committee Financial Validation Summary Builder
 *
 * Produces a committee-facing summary from the live financial validation
 * state. Derived from the existing readiness engine — no re-implementation.
 */

import { getFinancialSnapshotGate, type FinancialSnapshotGate } from "@/lib/financial/snapshot/getFinancialSnapshotGate";

export type CommitteeFinancialValidationSummary = {
  status: "ready" | "needs_review" | "stale" | "blocked" | "missing";
  memoSafe: boolean;
  decisionSafe: boolean;
  completenessPercent: number;
  criticalMissingCount: number;
  unresolvedConflictCount: number;
  staleReasons: string[];
  overrideCount: number;
  openFollowUpCount: number;
  snapshotBuiltAt: string | null;
  recommendedAction: string | null;
  narrative: string;
};

/**
 * Build a committee-facing financial validation summary for a deal.
 * Uses the same gate as lifecycle to ensure consistency.
 */
export async function buildCommitteeFinancialValidationSummary(
  dealId: string,
): Promise<CommitteeFinancialValidationSummary> {
  const gate = await getFinancialSnapshotGate(dealId);

  const status = deriveCommitteeStatus(gate);
  const memoSafe = gate.ready || !gate.blockerCode || gate.blockerCode === "financial_validation_open";
  const decisionSafe = gate.ready;

  const narrative = buildNarrative(gate, status, memoSafe, decisionSafe);

  return {
    status,
    memoSafe,
    decisionSafe,
    completenessPercent: gate.evidence.snapshotExists ? estimateCompleteness(gate) : 0,
    criticalMissingCount: gate.evidence.unresolvedMissingFacts,
    unresolvedConflictCount: gate.evidence.unresolvedConflicts,
    staleReasons: gate.blockerCode === "financial_snapshot_stale"
      ? ["Financial snapshot is stale — newer evidence exists"]
      : [],
    overrideCount: 0, // Will be populated from resolution audit in future
    openFollowUpCount: gate.evidence.unresolvedLowConfidenceFacts,
    snapshotBuiltAt: gate.evidence.lastBuiltAt,
    recommendedAction: gate.ready ? null : gate.message,
    narrative,
  };
}

function deriveCommitteeStatus(gate: FinancialSnapshotGate): CommitteeFinancialValidationSummary["status"] {
  if (!gate.evidence.snapshotExists) return "missing";
  if (gate.blockerCode === "financial_snapshot_stale") return "stale";
  if (gate.blockerCode === "financial_validation_open") return "needs_review";
  if (gate.blockerCode === "financial_snapshot_build_failed") return "blocked";
  if (gate.ready) return "ready";
  return "needs_review";
}

function estimateCompleteness(gate: FinancialSnapshotGate): number {
  const total = gate.evidence.openReviewItems + 10; // baseline assumption
  const resolved = total - gate.evidence.openReviewItems;
  return Math.min(100, Math.round((resolved / total) * 100));
}

function buildNarrative(
  gate: FinancialSnapshotGate,
  status: string,
  memoSafe: boolean,
  decisionSafe: boolean,
): string {
  if (!gate.evidence.snapshotExists) {
    return "No financial snapshot has been generated. Financial documents must be uploaded and spreads completed before the memo can include validated financial data.";
  }

  if (decisionSafe) {
    return "The financial snapshot is validated and decision-safe. No unresolved financial conflicts or critical missing metrics remain.";
  }

  if (gate.blockerCode === "financial_snapshot_stale") {
    return "The current memo is stale relative to newer financial evidence and should be regenerated before committee use.";
  }

  const parts: string[] = [];
  if (gate.evidence.unresolvedConflicts > 0) {
    parts.push(`${gate.evidence.unresolvedConflicts} unresolved financial conflict(s) require banker judgment`);
  }
  if (gate.evidence.unresolvedMissingFacts > 0) {
    parts.push(`${gate.evidence.unresolvedMissingFacts} critical metric(s) are missing`);
  }
  if (gate.evidence.unresolvedLowConfidenceFacts > 0) {
    parts.push(`${gate.evidence.unresolvedLowConfidenceFacts} low-confidence fact(s) remain for review`);
  }

  if (memoSafe && !decisionSafe) {
    return `The financial snapshot is sufficient for memo preparation but not yet decision-safe. ${parts.join(". ")}.`;
  }

  return `Financial validation is incomplete. ${parts.join(". ")}.`;
}
