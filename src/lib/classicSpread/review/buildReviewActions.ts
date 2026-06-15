/**
 * SPEC-CLASSIC-SPREAD-BANKER-REVIEW-ACTIONS-1 #2 — pure review-action builder.
 *
 * Turns the Spread Accuracy Audit's actionable BLOCKER findings into stable, banker-reviewable
 * workflow items with a DETERMINISTIC finding_key (so a re-sync upserts instead of duplicating).
 * No IO.
 */

import type { SpreadAuditResult, SpreadAuditFinding } from "../audit/spreadAccuracyAudit";
import { classifySpreadFindingAction } from "../audit/spreadFindingActions";

export type ReviewActionStatus =
  | "open"
  | "confirmed_resolved_value"
  | "rejected_source_value"
  | "borrower_detail_requested"
  | "source_verified"
  | "waived"
  | "closed";

export const REVIEW_ACTION_STATUSES: ReviewActionStatus[] = [
  "open", "confirmed_resolved_value", "rejected_source_value",
  "borrower_detail_requested", "source_verified", "waived", "closed",
];

export type ClassicSpreadReviewAction = {
  findingKey: string;
  periodLabel: string;
  statement: string;
  rowLabel: string;
  actionType: string; // SpreadFindingAction
  issueType: string;
  severity: string;
  recommendedValue: number | null; // the resolver's recommended (expected) value
  sourceValue: number | null; // the rejected/reported source value
  diffValue: number | null;
  sourceDocumentId: string | null;
  findingJson: { finding: SpreadAuditFinding; action: ReturnType<typeof classifySpreadFindingAction> };
};

/** Deterministic, stable key for a finding — the natural upsert key per (bank, deal). */
export function reviewFindingKey(f: { period: string; statement: string; rowLabel: string; issueType: string }): string {
  return [f.period, f.statement, f.rowLabel, f.issueType]
    .map((s) => String(s).trim().toLowerCase().replace(/\s+/g, "_"))
    .join("|");
}

/**
 * Build review actions for the actionable BLOCKER findings (the items an operator must resolve).
 * Deterministic order + de-duplicated by finding_key.
 */
export function buildClassicSpreadReviewActions(
  audit: SpreadAuditResult | null | undefined,
): ClassicSpreadReviewAction[] {
  if (!audit) return [];
  const seen = new Set<string>();
  const out: ClassicSpreadReviewAction[] = [];
  for (const f of audit.findings) {
    if (f.severity !== "blocker") continue;
    const findingKey = reviewFindingKey(f);
    if (seen.has(findingKey)) continue;
    seen.add(findingKey);
    const action = classifySpreadFindingAction(f);
    out.push({
      findingKey,
      periodLabel: f.period,
      statement: f.statement,
      rowLabel: f.rowLabel,
      actionType: action.action,
      issueType: f.issueType,
      severity: f.severity,
      recommendedValue: f.expectedValue,
      sourceValue: f.actualValue,
      diffValue: f.difference,
      sourceDocumentId: f.documentIds[0] ?? null,
      findingJson: { finding: f, action },
    });
  }
  return out.sort((a, b) => a.findingKey.localeCompare(b.findingKey));
}
