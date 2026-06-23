/**
 * SPEC-CLASSIC-SPREAD-BANKER-REVIEW-ACTIONS-1 #5 — apply reviewed decisions to the audit (pure).
 *
 * The Classic Spread audit/render consumes closed/reviewed banker decisions: a confirmed/rejected/
 * waived blocker downgrades to a REVIEWED WARNING, a source-verified blocker clears to info, and a
 * borrower-detail request KEEPS the blocker open (task pending). A decision NEVER clears a blocker
 * without `reviewedAt` + `reviewerUserId` (anti silent-auto-clear). Recomputes the derived fields.
 */

import type { SpreadAuditResult, SpreadAuditFinding, SpreadAuditStatement } from "../audit/spreadAccuracyAudit";
import { classifySpreadFindingAction, isUnresolvedAction, type SpreadFindingAction } from "../audit/spreadFindingActions";
import { reviewFindingKey, type ReviewActionStatus } from "./buildReviewActions";

export type ReviewDecision = {
  findingKey: string;
  status: ReviewActionStatus;
  reviewedAt: string | null;
  reviewerUserId: string | null;
  note?: string | null;
};

/** A decision is honored only when a real reviewer signed off (anti silent-auto-clear). */
function isReviewed(d: ReviewDecision): boolean {
  return d.reviewedAt != null && d.reviewerUserId != null && d.status !== "open";
}

function applyToFinding(f: SpreadAuditFinding, d: ReviewDecision): SpreadAuditFinding {
  if (!isReviewed(d)) return f;
  const tag = (extra: string) => `${f.detail} [reviewed: ${d.status}${d.note ? ` — ${d.note}` : ""}${extra}]`;
  switch (d.status) {
    case "confirmed_resolved_value":
    case "rejected_source_value":
    case "waived":
      // Downgrade to a reviewed warning — NOT clean.
      return { ...f, severity: "warning", reviewStatus: d.status, detail: tag("") };
    case "source_verified":
      // Source accepted as correct → the exception clears to informational.
      return { ...f, severity: "info", reviewStatus: d.status, detail: tag("") };
    case "borrower_detail_requested":
      // Blocker REMAINS open; task shows the request is pending.
      return { ...f, reviewStatus: d.status, detail: `${f.detail} [borrower detail requested — pending${d.note ? ` — ${d.note}` : ""}]` };
    case "closed":
      return { ...f, severity: "info", reviewStatus: d.status, detail: tag("") };
    default:
      return f;
  }
}

export function applyReviewDecisions(
  audit: SpreadAuditResult,
  decisions: ReviewDecision[],
): SpreadAuditResult {
  if (decisions.length === 0) return audit;
  const byKey = new Map(decisions.map((d) => [d.findingKey, d]));

  const findings = audit.findings.map((f) => {
    const d = byKey.get(reviewFindingKey(f));
    return d ? applyToFinding(f, d) : f;
  });

  // Recompute derived fields from the adjusted findings.
  const blockers = findings.filter((f) => f.severity === "blocker").length;
  const warnings = findings.filter((f) => f.severity === "warning").length;
  const infos = findings.filter((f) => f.severity === "info").length;
  const status: SpreadAuditResult["status"] = blockers > 0 ? "blocker" : warnings > 0 ? "warning" : "clean";
  const blockedCells = findings
    .filter((f) => f.severity === "blocker")
    .map((f) => ({ period: f.period, statement: f.statement as SpreadAuditStatement, rowLabel: f.rowLabel }));

  const actions = findings.map(classifySpreadFindingAction);
  const byPeriod: Record<string, number> = {};
  const byDocument: Record<string, number> = {};
  const byAction: Partial<Record<SpreadFindingAction, number>> = {};
  let unresolvedActionCount = 0;
  for (const a of actions) {
    byPeriod[a.period] = (byPeriod[a.period] ?? 0) + 1;
    byAction[a.action] = (byAction[a.action] ?? 0) + 1;
    for (const doc of a.documentIds) byDocument[doc] = (byDocument[doc] ?? 0) + 1;
    if (isUnresolvedAction(a)) unresolvedActionCount++;
  }

  return {
    ...audit,
    findings,
    summary: { ...audit.summary, blockers, warnings, infos },
    status,
    blockedCells,
    actionSummary: { byPeriod, byDocument, byAction, unresolvedActionCount, actions },
  };
}
