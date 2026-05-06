// Pure unifier — takes the per-source readiness inputs and returns one
// UnifiedDealReadiness object. No DB, no server-only.
//
// Group ordering and aggregate score weights are owned here. The output of
// this function is what JourneyRail and DealShell render.

import type { LifecycleBlocker, LifecycleState } from "@/buddy/lifecycle/model";
import { blockerGatesStage } from "@/buddy/lifecycle/blockerToStage";
import type { MemoInputReadiness } from "@/lib/creditMemo/inputs/types";
import { getBlockerFixAction, getNextAction } from "@/buddy/lifecycle/nextAction";
import type {
  ReadinessGroup,
  ReadinessGroupKey,
  UnifiedBlocker,
  UnifiedDealReadiness,
  UnifiedNextAction,
} from "./types";

export type CreditMemoSubmissionStatus = {
  // Whether a banker_submitted snapshot exists for this deal.
  submitted: boolean;
  // Most recent submitted snapshot id, if any.
  snapshotId: string | null;
  // Whether the underwriter has finalized a decision against the snapshot.
  finalized: boolean;
};

export type UnifyDealReadinessArgs = {
  dealId: string;
  lifecycle: LifecycleState;
  memoInput: MemoInputReadiness | null;
  creditMemo: CreditMemoSubmissionStatus;
  now?: Date;
};

const GROUP_LABELS: Record<ReadinessGroupKey, string> = {
  documents: "Documents",
  financials: "Financials",
  research: "Research",
  memo_inputs: "Memo Inputs",
  credit_memo: "Credit Memo",
};

const GROUP_WEIGHTS: Record<ReadinessGroupKey, number> = {
  documents: 0.20,
  financials: 0.20,
  research: 0.15,
  memo_inputs: 0.30,
  credit_memo: 0.15,
};

export function unifyDealReadiness(
  args: UnifyDealReadinessArgs,
): UnifiedDealReadiness {
  const { dealId, lifecycle, memoInput, creditMemo } = args;
  const now = args.now ?? new Date();

  const groups = {
    documents: buildDocumentsGroup(dealId, lifecycle),
    financials: buildFinancialsGroup(dealId, lifecycle, memoInput),
    research: buildResearchGroup(dealId, lifecycle, memoInput),
    memo_inputs: buildMemoInputsGroup(dealId, memoInput),
    credit_memo: buildCreditMemoGroup(dealId, lifecycle, creditMemo, memoInput),
  } satisfies Record<ReadinessGroupKey, ReadinessGroup>;

  const blockers = (Object.values(groups) as ReadinessGroup[]).flatMap(
    (g) => g.blockers,
  );
  const warnings = (Object.values(groups) as ReadinessGroup[]).flatMap(
    (g) => g.warnings,
  );

  const score = computeAggregateScore(groups);
  const ready = blockers.length === 0;

  const next_action = chooseNextAction({
    dealId,
    lifecycle,
    blockers,
    creditMemo,
    memoInput,
  });

  return {
    dealId,
    ready,
    stage: lifecycle.stage,
    score,
    groups,
    blockers,
    warnings,
    next_action,
    evaluatedAt: now.toISOString(),
    contractVersion: "unified_readiness_v1",
  };
}

// ─── Group builders ──────────────────────────────────────────────────────────

function buildDocumentsGroup(
  dealId: string,
  lifecycle: LifecycleState,
): ReadinessGroup {
  const blockers: UnifiedBlocker[] = [];
  const warnings: UnifiedBlocker[] = [];
  for (const lb of lifecycle.blockers) {
    const stage = blockerGatesStage(lb.code);
    if (
      stage === "docs_requested" ||
      stage === "docs_in_progress" ||
      stage === "docs_satisfied"
    ) {
      blockers.push(toUnified(lb, "documents", "banker", dealId));
    }
  }
  const ready =
    blockers.length === 0 &&
    (lifecycle.derived?.documentsReady === true ||
      lifecycle.derived?.financialSnapshotExists === true);
  const pct = lifecycle.derived?.documentsReadinessPct ?? 0;
  return {
    key: "documents",
    label: GROUP_LABELS.documents,
    ready,
    score: ready ? 100 : Math.max(0, Math.min(100, pct)),
    blockers,
    warnings,
  };
}

function buildFinancialsGroup(
  dealId: string,
  lifecycle: LifecycleState,
  memoInput: MemoInputReadiness | null,
): ReadinessGroup {
  const blockers: UnifiedBlocker[] = [];
  const warnings: UnifiedBlocker[] = [];

  // Lifecycle-emitted financial blockers (snapshot, spreads, pricing assumptions).
  for (const lb of lifecycle.blockers) {
    const stage = blockerGatesStage(lb.code);
    if (stage === "underwrite_ready") {
      blockers.push(toUnified(lb, "financials", "buddy", dealId));
    }
  }

  // Memo-input layer adds DSCR / debt service / global cash flow blockers.
  if (memoInput) {
    for (const b of memoInput.blockers) {
      if (
        b.code === "missing_dscr" ||
        b.code === "missing_global_cash_flow" ||
        b.code === "missing_debt_service_facts"
      ) {
        blockers.push(memoInputBlockerToUnified(b, "financials", dealId));
      }
    }
  }

  const ready = blockers.length === 0;
  return {
    key: "financials",
    label: GROUP_LABELS.financials,
    ready,
    score: ready ? 100 : 50,
    blockers,
    warnings,
  };
}

function buildResearchGroup(
  dealId: string,
  lifecycle: LifecycleState,
  memoInput: MemoInputReadiness | null,
): ReadinessGroup {
  const blockers: UnifiedBlocker[] = [];
  const warnings: UnifiedBlocker[] = [];

  if (memoInput) {
    for (const b of memoInput.blockers) {
      if (b.code === "missing_research_quality_gate") {
        blockers.push(memoInputBlockerToUnified(b, "research", dealId));
      }
    }
    for (const w of memoInput.warnings) {
      if (w.code === "low_research_quality") {
        warnings.push({
          code: w.code,
          label: w.label,
          group: "research",
          owner: "buddy",
          severity: "warning",
          fixPath: w.fixPath ?? `/deals/${dealId}/research`,
          fixLabel: "Open research",
        });
      }
    }
  }

  const ready = blockers.length === 0;
  return {
    key: "research",
    label: GROUP_LABELS.research,
    ready,
    score: ready ? 100 : 50,
    blockers,
    warnings,
  };
}

function buildMemoInputsGroup(
  dealId: string,
  memoInput: MemoInputReadiness | null,
): ReadinessGroup {
  const blockers: UnifiedBlocker[] = [];
  const warnings: UnifiedBlocker[] = [];

  // Tracked separately by Documents/Financials/Research above.
  const ROUTED_ELSEWHERE = new Set([
    "missing_research_quality_gate",
    "missing_dscr",
    "missing_global_cash_flow",
    "missing_debt_service_facts",
    "unfinalized_required_documents",
  ]);

  if (memoInput) {
    for (const b of memoInput.blockers) {
      if (ROUTED_ELSEWHERE.has(b.code)) continue;
      blockers.push(memoInputBlockerToUnified(b, "memo_inputs", dealId));
    }
    for (const w of memoInput.warnings) {
      if (w.code === "low_research_quality") continue;
      warnings.push({
        code: w.code,
        label: w.label,
        group: "memo_inputs",
        owner: "banker",
        severity: "warning",
        fixPath: w.fixPath ?? `/deals/${dealId}/memo-inputs`,
        fixLabel: "Open memo inputs",
      });
    }
  } else {
    blockers.push({
      code: "memo_input_readiness_missing",
      label: "Memo input readiness has not been evaluated yet",
      group: "memo_inputs",
      owner: "banker",
      severity: "blocker",
      fixPath: `/deals/${dealId}/memo-inputs`,
      fixLabel: "Open memo inputs",
    });
  }

  const ready = blockers.length === 0;
  const score = memoInput?.readiness_score ?? (ready ? 100 : 0);
  return {
    key: "memo_inputs",
    label: GROUP_LABELS.memo_inputs,
    ready,
    score,
    blockers,
    warnings,
  };
}

function buildCreditMemoGroup(
  dealId: string,
  lifecycle: LifecycleState,
  creditMemo: CreditMemoSubmissionStatus,
  memoInput: MemoInputReadiness | null,
): ReadinessGroup {
  const blockers: UnifiedBlocker[] = [];
  const warnings: UnifiedBlocker[] = [];

  // The credit memo can only be submitted once memo inputs are 100%.
  // We surface that as a fix-path here so the Credit Memo group itself
  // surfaces a clear next step rather than showing a green checkmark
  // while inputs are blocked.
  const memoInputsReady = memoInput?.ready === true;

  // Lifecycle stages past underwrite_in_progress imply the memo is in flight.
  const submitted = creditMemo.submitted;
  const finalized = creditMemo.finalized;

  if (!memoInputsReady && !submitted) {
    blockers.push({
      code: "memo_inputs_incomplete",
      label: "Complete memo inputs before submitting",
      group: "credit_memo",
      owner: "banker",
      severity: "blocker",
      fixPath: `/deals/${dealId}/memo-inputs`,
      fixLabel: "Complete memo inputs",
    });
  }

  // Lifecycle-driven committee/decision blockers belong here once memo is ready.
  for (const lb of lifecycle.blockers) {
    const stage = blockerGatesStage(lb.code);
    if (stage === "committee_ready" || stage === "committee_decisioned") {
      blockers.push(toUnified(lb, "credit_memo", "underwriter", dealId));
    }
  }

  const ready = blockers.length === 0 && (memoInputsReady || submitted);
  return {
    key: "credit_memo",
    label: GROUP_LABELS.credit_memo,
    ready,
    score: finalized ? 100 : submitted ? 90 : ready ? 80 : memoInputsReady ? 60 : 0,
    blockers,
    warnings,
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function toUnified(
  lb: LifecycleBlocker,
  group: ReadinessGroupKey,
  owner: UnifiedBlocker["owner"],
  dealId: string,
): UnifiedBlocker {
  const fix = getBlockerFixAction(lb, dealId);
  const fixPath =
    fix && "href" in fix && typeof fix.href === "string" ? fix.href : `/deals/${dealId}/cockpit`;
  const fixLabel = fix?.label ?? "Resolve";
  return {
    code: lb.code,
    label: lb.message,
    group,
    owner,
    severity: "blocker",
    fixPath,
    fixLabel,
  };
}

function memoInputBlockerToUnified(
  b: MemoInputReadiness["blockers"][number],
  group: ReadinessGroupKey,
  dealId: string,
): UnifiedBlocker {
  // Prefer a per-section deep link if the memo-input layer already provides one.
  const fixPath = b.fixPath ?? `/deals/${dealId}/memo-inputs`;
  return {
    code: b.code,
    label: b.label,
    group,
    owner: b.owner,
    severity: "blocker",
    fixPath,
    fixLabel: b.label,
  };
}

function computeAggregateScore(
  groups: Record<ReadinessGroupKey, ReadinessGroup>,
): number {
  let weighted = 0;
  for (const k of Object.keys(GROUP_WEIGHTS) as ReadinessGroupKey[]) {
    const g = groups[k];
    weighted += (g.score / 100) * GROUP_WEIGHTS[k];
  }
  return Math.round(weighted * 100);
}

function chooseNextAction(args: {
  dealId: string;
  lifecycle: LifecycleState;
  blockers: UnifiedBlocker[];
  creditMemo: CreditMemoSubmissionStatus;
  memoInput: MemoInputReadiness | null;
}): UnifiedNextAction {
  const { dealId, lifecycle, blockers, creditMemo, memoInput } = args;

  // 1. Submitted memo → underwriter view.
  if (creditMemo.submitted) {
    return {
      label: creditMemo.finalized ? "View finalized memo" : "View submitted memo",
      href: `/deals/${dealId}/credit-memo`,
      owner: creditMemo.finalized ? "underwriter" : "banker",
      kind: "navigate",
      reason: creditMemo.finalized
        ? "Decision recorded by underwriter"
        : "Awaiting underwriter review",
    };
  }

  // 2. Top blocker → exact fix path.
  const top = pickTopBlocker(blockers);
  if (top) {
    return {
      label: top.fixLabel,
      href: top.fixPath,
      owner: top.owner,
      kind: "fix",
      reason: top.label,
    };
  }

  // 3. Memo inputs ready & no blockers → review credit memo.
  if (memoInput?.ready) {
    return {
      label: "Review Credit Memo",
      href: `/deals/${dealId}/credit-memo`,
      owner: "banker",
      kind: "navigate",
      reason: "All memo inputs satisfied — ready for banker review",
    };
  }

  // 4. Fall back to the lifecycle's existing next action.
  const lifecycleNext = getNextAction(lifecycle, dealId);
  return {
    label: lifecycleNext.label,
    href: lifecycleNext.href ?? `/deals/${dealId}/cockpit`,
    owner: "banker",
    kind: lifecycleNext.intent === "navigate" ? "navigate" : "run",
    reason: lifecycleNext.description,
  };
}

// Top blocker selection: priority order across groups.
const GROUP_PRIORITY: ReadinessGroupKey[] = [
  "documents",
  "financials",
  "research",
  "memo_inputs",
  "credit_memo",
];

function pickTopBlocker(blockers: UnifiedBlocker[]): UnifiedBlocker | null {
  if (blockers.length === 0) return null;
  for (const group of GROUP_PRIORITY) {
    const inGroup = blockers.find((b) => b.group === group);
    if (inGroup) return inGroup;
  }
  return blockers[0];
}
