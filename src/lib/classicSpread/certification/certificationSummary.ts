/**
 * SPEC-CLASSIC-SPREAD-CERTIFICATION-GATE-PDF-VERSION-1 — pure classic-spread certification summary.
 *
 * Rolls the existing certification framework (per-domain gate statuses) and the post-decision
 * accuracy audit (statement-truth-resolver findings + banker review decisions already applied) into
 * a single honest status the PDF / memo can present. It does NOT re-run certification, touch the
 * canonical VM, or import reconcileFinancialFacts — it only summarizes what the gate + audit produced.
 *
 *   status:
 *     - "blocked"     when any blocker finding remains OR any certification domain is blocked;
 *     - "preliminary" when no blockers but unresolved warnings / source-detail confirmations /
 *                     open review actions remain (e.g. the YTD-2026 missing-AR REQUEST_SOURCE_DETAIL);
 *     - "certified"   only when every certification domain is clean, the accuracy audit is clean,
 *                     and no required review actions remain.
 *
 * Banker-confirmed/closed actions are already downgraded out of the audit's blocker set by
 * applyReviewDecisions before this runs, so they never count as open blockers here.
 */

import type { ClassicSpreadCertificationAudit } from "./certifiedSpreadGateCore";
import type { SpreadAuditFinding } from "../audit/spreadAccuracyAudit";
import { classifySpreadFindingAction } from "../audit/spreadFindingActions";

export type ClassicSpreadCertificationStatus = "certified" | "preliminary" | "blocked";

export type ClassicSpreadRequiredAction = {
  period: string;
  statement: string;
  rowLabel: string;
  action: string; // SpreadFindingAction (e.g. REQUEST_SOURCE_DETAIL / CONFIRM_RESOLVED_VALUE)
};

export type ClassicSpreadCertificationSummary = {
  status: ClassicSpreadCertificationStatus;
  /** certification DOMAINS (balance_sheet / personal_income / global_cash_flow / ratios) by status */
  certifiedCount: number; // domains clean
  preliminaryCount: number; // domains caveated
  blockedCount: number; // domains blocked
  /** accuracy-audit finding counts (after banker decisions applied) */
  blockerCount: number;
  warningCount: number;
  /** open banker review actions still requiring resolution */
  openReviewActionCount: number;
  /** the open required actions (one per remaining blocker finding), by period/line/action */
  remainingRequiredActions: ClassicSpreadRequiredAction[];
  notes: string[];
};

const requiredActionKey = (a: ClassicSpreadRequiredAction) =>
  `${a.period}|${a.statement}|${a.rowLabel}|${a.action}`;

function remainingActionsFromFindings(findings: SpreadAuditFinding[]): ClassicSpreadRequiredAction[] {
  const seen = new Set<string>();
  const out: ClassicSpreadRequiredAction[] = [];
  for (const f of findings) {
    if (f.severity !== "blocker") continue; // required actions are the unresolved blockers
    const action = classifySpreadFindingAction(f).action;
    const item: ClassicSpreadRequiredAction = {
      period: f.period,
      statement: f.statement,
      rowLabel: f.rowLabel,
      action,
    };
    const k = requiredActionKey(item);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(item);
  }
  return out.sort((a, b) => requiredActionKey(a).localeCompare(requiredActionKey(b)));
}

/**
 * Build the certification summary from the gate audit (+ optional open-review-action count). When
 * the gate did not complete (`certified === false` or no audit) the summary fails closed to
 * "blocked" so the PDF never presents an uncertified spread as certified.
 */
export function buildClassicSpreadCertificationSummary(args: {
  certified: boolean;
  audit: ClassicSpreadCertificationAudit | null | undefined;
  openReviewActionCount?: number;
}): ClassicSpreadCertificationSummary {
  const { certified, audit } = args;

  if (!certified || !audit) {
    return {
      status: "blocked",
      certifiedCount: 0,
      preliminaryCount: 0,
      blockedCount: 0,
      blockerCount: 0,
      warningCount: 0,
      openReviewActionCount: args.openReviewActionCount ?? 0,
      remainingRequiredActions: [],
      notes: ["Certification gate did not complete — the spread is NOT certified."],
    };
  }

  const domainStatuses = Object.values(audit.domains).map((d) => d.status);
  const certifiedCount = domainStatuses.filter((s) => s === "clean").length;
  const preliminaryCount = domainStatuses.filter((s) => s === "caveated").length;
  const blockedCount = domainStatuses.filter((s) => s === "blocked").length;

  const findings = audit.spreadAccuracy?.findings ?? [];
  const blockerCount = findings.filter((f) => f.severity === "blocker").length;
  const warningCount = findings.filter((f) => f.severity === "warning").length;

  const remainingRequiredActions = remainingActionsFromFindings(findings);
  // Default the open-review-action count to the remaining blocker findings (each becomes an action)
  // when the caller did not supply the live persisted count.
  const openReviewActionCount = args.openReviewActionCount ?? remainingRequiredActions.length;

  let status: ClassicSpreadCertificationStatus;
  if (blockerCount > 0 || blockedCount > 0) status = "blocked";
  else if (warningCount > 0 || preliminaryCount > 0 || openReviewActionCount > 0) status = "preliminary";
  else status = "certified";

  const notes: string[] = [];
  if (status === "blocked") {
    notes.push(`${blockerCount} unresolved blocker action(s) remain — the spread is NOT certified.`);
  } else if (status === "preliminary") {
    notes.push("Preliminary — source detail or banker confirmation still required before certification.");
  } else {
    notes.push("All certification domains clean and no required review actions remain.");
  }
  const sourceDetail = remainingRequiredActions.filter((a) => a.action === "REQUEST_SOURCE_DETAIL");
  if (sourceDetail.length > 0) {
    notes.push(
      `Source detail still required for: ${sourceDetail.map((a) => `${a.period} ${a.rowLabel}`).join("; ")}.`,
    );
  }

  return {
    status,
    certifiedCount,
    preliminaryCount,
    blockedCount,
    blockerCount,
    warningCount,
    openReviewActionCount,
    remainingRequiredActions,
    notes,
  };
}

const STATUS_LABEL: Record<ClassicSpreadCertificationStatus, string> = {
  certified: "CERTIFIED",
  preliminary: "PRELIMINARY - source detail / confirmation still required",
  blocked: "BLOCKED - unresolved blockers remain",
};

/**
 * The plain-ASCII lines the PDF "Spread Certification" block renders. Pure so the rendered content
 * is unit-testable without producing a PDF buffer.
 */
export function certificationStatusLines(summary: ClassicSpreadCertificationSummary): string[] {
  const lines: string[] = [];
  lines.push(`Spread Certification: ${STATUS_LABEL[summary.status]}`);
  lines.push(
    `Domains certified ${summary.certifiedCount} / preliminary ${summary.preliminaryCount} / blocked ${summary.blockedCount}; ` +
      `accuracy ${summary.blockerCount} blocker(s), ${summary.warningCount} warning(s); ` +
      `${summary.openReviewActionCount} open review action(s).`,
  );
  for (const a of summary.remainingRequiredActions) {
    lines.push(`[${a.action}] ${a.period} - ${a.statement.replace(/_/g, " ")} - ${a.rowLabel}`);
  }
  for (const n of summary.notes) lines.push(n);
  return lines;
}
