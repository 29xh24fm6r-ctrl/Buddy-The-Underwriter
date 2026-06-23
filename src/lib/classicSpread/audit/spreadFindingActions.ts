/**
 * SPEC-CLASSIC-SPREAD-BLOCKER-BATCH-RESOLUTION-1 #3 — finding → action model (pure).
 *
 * Turns a diagnostic spread audit finding into an OPERATIONAL source-review action so blockers
 * become tasks a banker can act on. No UI, no routes — just pure action payloads.
 */

import type { SpreadAuditFinding } from "./spreadAccuracyAudit";

export type SpreadFindingAction =
  | "CONFIRM_RESOLVED_VALUE" // the resolver corrected the value; confirm the corrected figure
  | "REQUEST_SOURCE_DETAIL" // a line/component is missing or unmapped; obtain the underlying detail
  | "VERIFY_SOURCE_LINE" // two sources disagree; verify which source line is right
  | "ACCEPT_AS_REPORTED" // informational/derived; can be accepted as reported
  | "REJECT_SOURCE_VALUE"; // the source value is wrong and must be rejected outright

export type SpreadFindingActionItem = {
  action: SpreadFindingAction;
  period: string;
  statement: SpreadAuditFinding["statement"];
  rowLabel: string;
  issueType: SpreadAuditFinding["issueType"];
  severity: SpreadAuditFinding["severity"];
  rejectedSourceKey: string | null;
  documentIds: string[];
  detail: string;
};

/** Map a finding's issue type to the operational action a reviewer must take. */
export function classifySpreadFindingAction(finding: SpreadAuditFinding): SpreadFindingActionItem {
  let action: SpreadFindingAction;
  switch (finding.issueType) {
    case "rejected_source_value":
      // The resolver replaced a wrong direct value with a coherent one — confirm the corrected figure.
      action = "CONFIRM_RESOLVED_VALUE";
      break;
    case "missing_implied_component":
    case "missing_required_value":
      // A line/component is missing or implied — obtain the underlying source detail.
      action = "REQUEST_SOURCE_DETAIL";
      break;
    case "formula_mismatch":
    case "unreconciled_total":
    case "missing_source_mapping":
      // Sources disagree / a line is unmapped — verify which source line is correct.
      action = "VERIFY_SOURCE_LINE";
      break;
    case "contradictory_components":
      // Direct total exceeds visible components (e.g. unmapped OCL) — request the source detail.
      action = "REQUEST_SOURCE_DETAIL";
      break;
    case "derived_from_fallback":
    default:
      action = "ACCEPT_AS_REPORTED";
      break;
  }
  return {
    action,
    period: finding.period,
    statement: finding.statement,
    rowLabel: finding.rowLabel,
    issueType: finding.issueType,
    severity: finding.severity,
    rejectedSourceKey: /rejected/i.test(finding.detail) ? extractRejectedKey(finding.detail) : null,
    documentIds: finding.documentIds,
    detail: finding.detail,
  };
}

function extractRejectedKey(detail: string): string | null {
  const m = detail.match(/\b(SL_[A-Z_]+|TOTAL_[A-Z_]+)\b/);
  return m ? m[1]! : null;
}

/** Whether an action still needs operator attention (everything but accept-as-reported). */
export function isUnresolvedAction(item: SpreadFindingActionItem): boolean {
  return item.action !== "ACCEPT_AS_REPORTED";
}
