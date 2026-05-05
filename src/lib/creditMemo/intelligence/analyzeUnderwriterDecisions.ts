// Pure analytics over the underwriter's recorded decisions across all
// snapshots for a deal. Reads underwriter_feedback_json — never mutates.

import type {
  IntelligenceSnapshotRow,
  UnderwriterDecisionAnalytics,
} from "./types";

type FeedbackShape = {
  decision?: string;
  requested_changes?: Array<{
    section_key?: unknown;
    comment?: unknown;
    severity?: unknown;
  }>;
};

function readFeedback(row: IntelligenceSnapshotRow): FeedbackShape | null {
  const f = row.underwriter_feedback_json;
  if (!f || typeof f !== "object") return null;
  // An empty {} is the default the gate inserts — treat as no decision.
  if (Object.keys(f as Record<string, unknown>).length === 0) return null;
  return f as FeedbackShape;
}

export function analyzeUnderwriterDecisions(
  snapshots: IntelligenceSnapshotRow[],
): UnderwriterDecisionAnalytics {
  const decisions = snapshots
    .map(readFeedback)
    .filter((d): d is FeedbackShape => d !== null);

  const total = decisions.length;
  const approvals = decisions.filter((d) => d.decision === "approved").length;
  const declines = decisions.filter((d) => d.decision === "declined").length;
  const returns = decisions.filter((d) => d.decision === "returned_for_revision").length;

  const reasonCounts = new Map<string, number>();
  for (const decision of decisions) {
    const changes = Array.isArray(decision.requested_changes)
      ? decision.requested_changes
      : [];
    for (const change of changes) {
      const reason =
        (typeof change.comment === "string" && change.comment.trim().length > 0
          ? change.comment.trim()
          : null) ??
        (typeof change.section_key === "string" && change.section_key.length > 0
          ? change.section_key
          : null) ??
        "Unspecified";
      reasonCounts.set(reason, (reasonCounts.get(reason) ?? 0) + 1);
    }
  }

  // Cycles to final decision: count snapshots between the first
  // banker_submitted and the last finalized, if both exist.
  const avg = computeAvgCyclesToFinal(snapshots);

  return {
    total_decisions: total,
    approvals,
    declines,
    returns,
    approval_rate: total > 0 ? approvals / total : 0,
    return_rate: total > 0 ? returns / total : 0,
    common_return_reasons: [...reasonCounts.entries()]
      .map(([reason, count]) => ({ reason, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10),
    avg_cycles_to_final_decision: avg,
  };
}

function computeAvgCyclesToFinal(
  snapshots: IntelligenceSnapshotRow[],
): number | null {
  // Find the last finalized snapshot. Its memo_version minus 1 (since
  // versions are 1-indexed) is the number of cycles that preceded the
  // approval. With no finalized snapshot, return null.
  let lastFinalVersion: number | null = null;
  for (const s of snapshots) {
    const fb = readFeedback(s);
    if (fb && (fb.decision === "approved" || fb.decision === "declined")) {
      const v = s.memo_version;
      if (typeof v === "number" && (lastFinalVersion === null || v > lastFinalVersion)) {
        lastFinalVersion = v;
      }
    }
  }
  if (lastFinalVersion === null) return null;
  return Math.max(0, lastFinalVersion - 1);
}
