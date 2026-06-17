/**
 * SPEC-CLASSIC-SPREAD-CERTIFICATION-GATE-PDF-VERSION-1 + SPEC-CLASSIC-SPREAD-PERSONAL-INCOME-GCF-
 * CERTIFICATION-1 — pure classic-spread certification summary.
 *
 * Rolls the existing certification framework (per-domain gate statuses: balance sheet, personal
 * income, GCF/DSCR support, ratios) and the post-decision accuracy audit (statement-truth-resolver
 * findings + banker review decisions already applied) into a single honest status the PDF / memo can
 * present. It does NOT re-run certification, touch the canonical VM, or import reconcileFinancialFacts
 * — it only summarizes what the gate + audit produced.
 *
 *   status:
 *     - "blocked"     when any blocker finding remains OR any certification domain is blocked;
 *     - "preliminary" when no blockers but unresolved warnings / source-detail confirmations /
 *                     open review actions / preliminary domains remain;
 *     - "certified"   only when every certification domain is clean, the accuracy audit is clean,
 *                     and no required review actions remain.
 *
 * GCF is evaluated honestly against the RENDERED Global Cash Flow section when supplied: it can never
 * read "certified" while entity cash flow is not computed, proposed debt service is missing, the
 * global DSCR is unavailable, or personal income is blocked.
 */

import type { ClassicSpreadCertificationAudit } from "./certifiedSpreadGateCore";
import type { CertificationStatus } from "./certifiedSpreadAudit";
import type { GlobalCashFlowSection } from "../types";
import type { SpreadAuditFinding } from "../audit/spreadAccuracyAudit";
import { classifySpreadFindingAction } from "../audit/spreadFindingActions";

export type ClassicSpreadCertificationStatus = "certified" | "preliminary" | "blocked";

export type ClassicSpreadRequiredAction = {
  period: string;
  statement: string;
  rowLabel: string;
  action: string; // SpreadFindingAction (e.g. REQUEST_SOURCE_DETAIL / CONFIRM_RESOLVED_VALUE)
};

export type DomainCertStatus = { status: ClassicSpreadCertificationStatus; reasons: string[] };

export type ClassicSpreadCertificationDomains = {
  balanceSheet: DomainCertStatus;
  personalIncome: DomainCertStatus;
  globalCashFlow: DomainCertStatus;
  ratios: DomainCertStatus;
};

export type ClassicSpreadCertificationSummary = {
  status: ClassicSpreadCertificationStatus;
  /** certification DOMAINS rolled into the overall status */
  domains: ClassicSpreadCertificationDomains;
  /** domain counts (certified / preliminary / blocked across the four domains) */
  certifiedCount: number;
  preliminaryCount: number;
  blockedCount: number;
  /** accuracy-audit finding counts (after banker decisions applied) */
  blockerCount: number;
  warningCount: number;
  /** open banker review actions still requiring resolution */
  openReviewActionCount: number;
  /** the open required actions (one per remaining blocker finding), by period/line/action */
  remainingRequiredActions: ClassicSpreadRequiredAction[];
  notes: string[];
};

const GATE_TO_STATUS: Record<CertificationStatus, ClassicSpreadCertificationStatus> = {
  clean: "certified",
  caveated: "preliminary",
  blocked: "blocked",
};

const requiredActionKey = (a: ClassicSpreadRequiredAction) =>
  `${a.period}|${a.statement}|${a.rowLabel}|${a.action}`;

function remainingActionsFromFindings(findings: SpreadAuditFinding[]): ClassicSpreadRequiredAction[] {
  const seen = new Set<string>();
  const out: ClassicSpreadRequiredAction[] = [];
  for (const f of findings) {
    if (f.severity !== "blocker") continue; // required actions are the unresolved blockers
    const action = classifySpreadFindingAction(f).action;
    const item: ClassicSpreadRequiredAction = { period: f.period, statement: f.statement, rowLabel: f.rowLabel, action };
    const k = requiredActionKey(item);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(item);
  }
  return out.sort((a, b) => requiredActionKey(a).localeCompare(requiredActionKey(b)));
}

/**
 * Honest GCF status from the RENDERED section (+ personal-income dependency). GCF cannot certify
 * while entity cash flow / proposed debt service / DSCR is missing or personal income is blocked.
 * When no section is supplied the gate's GCF domain status is used as-is (back-compat).
 */
function gcfStatusFromSection(
  section: GlobalCashFlowSection | null,
  gateStatus: ClassicSpreadCertificationStatus,
  personalIncomeBlocked: boolean,
): DomainCertStatus {
  const reasons: string[] = [];
  if (personalIncomeBlocked) reasons.push("personal income source conflict");
  if (!section || (section.entityCashFlowAvailable == null && section.globalCashFlow == null)) {
    reasons.push("entity cash flow not computed (re-run spread pipeline)");
  }
  if (section && section.proposedAnnualDebtService == null) reasons.push("missing proposed debt service");
  if (section && section.globalDscr == null) reasons.push("global DSCR unavailable");
  if (reasons.length > 0) return { status: "blocked", reasons };
  // SPEC-CLASSIC-SPREAD-GCF-ENTITY-CASH-FLOW-COMPUTE-1: when entity cash flow was DERIVED from the
  // rendered annual spread rows (not a materialized GCF fact), GCF is PRELIMINARY — the figure is a
  // supportable derivation but the underlying spread is not itself certified. It overrides the gate's
  // "entity cash flow not computed" block (we have now computed it) but never reads "certified".
  if (section && section.entityCashFlowComputed) {
    const period = section.entityCashFlowSourcePeriod ?? "latest annual period";
    return { status: "preliminary", reasons: [`entity cash flow derived from ${period} spread rows (preliminary)`] };
  }
  // Inputs all present from a materialized fact — defer to the gate's GCF domain status (clean/caveated).
  return { status: gateStatus, reasons: [] };
}

const ALL_BLOCKED: ClassicSpreadCertificationDomains = {
  balanceSheet: { status: "blocked", reasons: ["certification gate did not complete"] },
  personalIncome: { status: "blocked", reasons: ["certification gate did not complete"] },
  globalCashFlow: { status: "blocked", reasons: ["certification gate did not complete"] },
  ratios: { status: "blocked", reasons: ["certification gate did not complete"] },
};

/**
 * Build the certification summary from the gate audit (+ optional open-review-action count and the
 * rendered GCF section). Fails closed to "blocked" when the gate did not complete.
 */
export function buildClassicSpreadCertificationSummary(args: {
  certified: boolean;
  audit: ClassicSpreadCertificationAudit | null | undefined;
  openReviewActionCount?: number;
  /** the rendered Global Cash Flow section, for honest GCF certification. `undefined` = not supplied. */
  globalCashFlow?: GlobalCashFlowSection | null;
}): ClassicSpreadCertificationSummary {
  const { certified, audit } = args;

  if (!certified || !audit) {
    return {
      status: "blocked",
      domains: ALL_BLOCKED,
      certifiedCount: 0,
      preliminaryCount: 0,
      blockedCount: 4,
      blockerCount: 0,
      warningCount: 0,
      openReviewActionCount: args.openReviewActionCount ?? 0,
      remainingRequiredActions: [],
      notes: ["Certification gate did not complete — the spread is NOT certified."],
    };
  }

  const findings = audit.spreadAccuracy?.findings ?? [];
  const blockerCount = findings.filter((f) => f.severity === "blocker").length;
  const warningCount = findings.filter((f) => f.severity === "warning").length;
  const remainingRequiredActions = remainingActionsFromFindings(findings);
  // BUGFIX-CLASSIC-SPREAD-CERTIFICATION-OPEN-ACTION-COUNT-PARITY-1: the "open review action(s)" count
  // must never UNDERSTATE the unresolved blocker actions. The persisted-table count passed in by the
  // loader is computed BEFORE the regenerate-cycle re-sync, so it can lag the live post-decision audit
  // (e.g. a freshly-surfaced 2022 blocker the table hasn't recorded yet). Reconcile by taking the max
  // of the persisted active-action count and the live unresolved blocker actions — so the PDF reads the
  // same count as the Review Actions panel (which counts active rows) and as "unresolved blocker
  // action(s)". `remainingRequiredActions` already reflects banker decisions (applyReviewDecisions
  // downgraded reviewed blockers), so this never over-reports genuinely-resolved work.
  const openReviewActionCount = Math.max(args.openReviewActionCount ?? 0, remainingRequiredActions.length);

  const piGate = GATE_TO_STATUS[audit.domains.personal_income.status];
  const gcfGate = GATE_TO_STATUS[audit.domains.global_cash_flow.status];

  const domains: ClassicSpreadCertificationDomains = {
    balanceSheet: {
      status: GATE_TO_STATUS[audit.domains.balance_sheet.status],
      reasons: audit.domains.balance_sheet.blocked.map((b) => `${b.period} ${b.row}: ${b.reason ?? "blocked"}`),
    },
    personalIncome: {
      status: piGate,
      reasons: audit.domains.personal_income.replacements
        .filter((r) => r.status !== "certified")
        .map((r) => `${r.year} ${String(r.field)}: ${r.reason}`),
    },
    globalCashFlow:
      args.globalCashFlow !== undefined
        ? gcfStatusFromSection(args.globalCashFlow, gcfGate, piGate === "blocked")
        : { status: gcfGate, reasons: audit.domains.global_cash_flow.blocked.map((b) => b.reason) },
    ratios: {
      status: GATE_TO_STATUS[audit.domains.ratios.status],
      reasons: audit.domains.ratios.suppressed.map((sx) => `${sx.row}: ${sx.reason}`),
    },
  };

  const domainList = [domains.balanceSheet, domains.personalIncome, domains.globalCashFlow, domains.ratios];
  const certifiedCount = domainList.filter((d) => d.status === "certified").length;
  const preliminaryCount = domainList.filter((d) => d.status === "preliminary").length;
  const blockedCount = domainList.filter((d) => d.status === "blocked").length;

  let status: ClassicSpreadCertificationStatus;
  if (blockerCount > 0 || blockedCount > 0) status = "blocked";
  else if (warningCount > 0 || preliminaryCount > 0 || openReviewActionCount > 0) status = "preliminary";
  else status = "certified";

  const notes: string[] = [];
  if (status === "blocked") notes.push(`${blockerCount} unresolved blocker action(s); ${blockedCount} certification domain(s) blocked — the spread is NOT certified.`);
  else if (status === "preliminary") notes.push("Preliminary — source detail or banker confirmation still required before certification.");
  else notes.push("All certification domains clean and no required review actions remain.");

  const sourceDetail = remainingRequiredActions.filter((a) => a.action === "REQUEST_SOURCE_DETAIL");
  if (sourceDetail.length > 0) {
    notes.push(`Source detail still required for: ${sourceDetail.map((a) => `${a.period} ${a.rowLabel}`).join("; ")}.`);
  }
  if (domains.globalCashFlow.status !== "certified" && domains.globalCashFlow.reasons.length > 0) {
    notes.push(`GCF ${domains.globalCashFlow.status}: ${domains.globalCashFlow.reasons.join("; ")}.`);
  }

  return {
    status,
    domains,
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
const SHORT_LABEL: Record<ClassicSpreadCertificationStatus, string> = {
  certified: "certified",
  preliminary: "preliminary",
  blocked: "blocked",
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
  // Explicit personal-income + GCF certification lines (with the blocking reasons when not certified).
  const piReasons = summary.domains.personalIncome.reasons;
  lines.push(
    `Personal income certification: ${SHORT_LABEL[summary.domains.personalIncome.status]}` +
      (summary.domains.personalIncome.status !== "certified" && piReasons.length > 0 ? ` - ${piReasons.join("; ")}` : ""),
  );
  const gcfReasons = summary.domains.globalCashFlow.reasons;
  lines.push(
    `GCF certification: ${SHORT_LABEL[summary.domains.globalCashFlow.status]}` +
      (summary.domains.globalCashFlow.status !== "certified" && gcfReasons.length > 0 ? ` - ${gcfReasons.join("; ")}` : ""),
  );
  for (const a of summary.remainingRequiredActions) {
    lines.push(`[${a.action}] ${a.period} - ${a.statement.replace(/_/g, " ")} - ${a.rowLabel}`);
  }
  for (const n of summary.notes) lines.push(n);
  return lines;
}
