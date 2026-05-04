/**
 * Canonical deal analysis status — single source of truth for the banker UI.
 *
 * This helper is the ONLY thing the analysis-status route returns and the
 * `DealAnalysisStatusCard` consumes. The UI must never inspect raw analysis
 * tables itself.
 *
 * Phase resolution is strict-priority — first match wins, no branching:
 *
 *   1. tenant_mismatch        → analysis_failed
 *   2. running_analysis       → active risk_runs.status='running'
 *   3. waiting_for_loan_request
 *   4. waiting_for_documents
 *   5. waiting_for_spreads
 *   6. analysis_failed        → latest run failed
 *   7. review_reconciliation  → FLAGS / CONFLICTS
 *   8. ready_for_committee
 *   9. not_started
 *
 * There is always EXACTLY ONE phase and EXACTLY ONE primaryAction.
 *
 * Source tables (read-only):
 *   deals, deal_loan_requests, deal_documents, deal_spreads,
 *   deal_model_snapshots, risk_runs, ai_risk_runs, memo_runs,
 *   memo_sections, deal_decisions, deal_credit_memo_status,
 *   deal_reconciliation_results.
 */

import { assertServerOnly } from "@/lib/serverOnly";
import type { SupabaseClient } from "@supabase/supabase-js";

assertServerOnly();

// ─── Public types ────────────────────────────────────────────────────────────

export type DealAnalysisPhase =
  | "not_started"
  | "waiting_for_loan_request"
  | "waiting_for_documents"
  | "waiting_for_spreads"
  | "running_analysis"
  | "review_reconciliation"
  | "ready_for_committee"
  | "analysis_failed";

export type BlockerSeverity = "info" | "warning" | "error";

export type DealAnalysisBlocker = {
  code: string;
  severity: BlockerSeverity;
  title: string;
  message: string;
  actionLabel: string;
  actionHref?: string;
  sourceTable?: string;
  sourceId?: string;
};

export type DealAnalysisCompleted = {
  loanRequest: boolean;
  documents: boolean;
  spreads: boolean;
  modelSnapshot: boolean;
  riskRun: boolean;
  memo: boolean;
  decision: boolean;
  committeeReady: boolean;
};

export type DealAnalysisLatest = {
  riskRunId: string | null;
  aiRiskRunId: string | null;
  memoRunId: string | null;
  decisionId: string | null;
  snapshotId: string | null;
  reconciliationStatus: "CLEAN" | "FLAGS" | "CONFLICTS" | null;
  updatedAt: string | null;
};

export type DealAnalysisLatestSuccessful = {
  riskRunId: string | null;
  memoRunId: string | null;
  decisionId: string | null;
  completedAt: string | null;
};

export type DealPrimaryAction = {
  label: string;
  href?: string;
  method?: "GET" | "POST";
  disabledReason?: string;
};

export type DealAnalysisStatus = {
  dealId: string;
  bankId: string;
  phase: DealAnalysisPhase;
  blockers: DealAnalysisBlocker[];
  completed: DealAnalysisCompleted;
  latest: DealAnalysisLatest;
  latestSuccessful: DealAnalysisLatestSuccessful;
  canRunAnalysis: boolean;
  canForceReplay: boolean;
  primaryAction: DealPrimaryAction;
};

export type GetDealAnalysisStatusInput = {
  dealId: string;
  /** Caller's bank id — compared against deals.bank_id for tenant safety. */
  callerBankId: string;
  /** Test seam — production callers leave this undefined. */
  _sb?: SupabaseClient;
};

// ─── Constants ──────────────────────────────────────────────────────────────

const RUNNING_FRESHNESS_WINDOW_MS = 10 * 60 * 1000;

// ─── Public API ──────────────────────────────────────────────────────────────

export async function getDealAnalysisStatus(
  input: GetDealAnalysisStatusInput,
): Promise<DealAnalysisStatus> {
  const sb = input._sb ?? (await loadAdmin());
  const dealId = input.dealId;
  const callerBankId = input.callerBankId;

  const deal = await loadDeal(sb, dealId);

  // 1. tenant_mismatch — short-circuit before any further reads.
  if (!deal || deal.bank_id !== callerBankId) {
    return tenantMismatchStatus(dealId, callerBankId);
  }

  const bankId = deal.bank_id;

  const [
    loanReq,
    docCount,
    spreadInfo,
    snapshot,
    riskRunInfo,
    memo,
    decision,
    committeeReady,
    recon,
    staleRecovery,
    writeFailure,
  ] = await Promise.all([
    loadLatestLoanRequest(sb, dealId),
    loadDocumentCount(sb, dealId, bankId),
    loadSpreadInfo(sb, dealId, bankId),
    loadLatestSnapshot(sb, dealId),
    loadRiskRunInfo(sb, dealId),
    loadLatestMemoRun(sb, dealId),
    loadLatestDecision(sb, dealId),
    loadCommitteeReady(sb, dealId),
    loadReconciliation(sb, dealId),
    loadLatestStaleRecovery(sb, dealId),
    loadLatestWriteFailure(sb, dealId),
  ]);

  // ── Completed flags ─────────────────────────────────────────────────────
  const loanRequestComplete =
    (typeof deal.loan_amount === "number" && deal.loan_amount > 0) ||
    (typeof loanReq?.requested_amount === "number" &&
      loanReq.requested_amount > 0);

  const documentsComplete = docCount > 0;
  const spreadsReady = spreadInfo?.kind === "ready";
  const modelSnapshotReady = !!snapshot?.id;
  const riskRunCompleted = !!riskRunInfo.latestCompletedRiskRunId;
  const memoSectionsExist = (memo?.sectionCount ?? 0) > 0;
  const memoComplete =
    !!memo?.completedRunId && memoSectionsExist;
  const decisionComplete = !!decision?.id;
  const committeeReadyFlag =
    committeeReady?.current_status === "ready_for_committee";

  const completed: DealAnalysisCompleted = {
    loanRequest: !!loanRequestComplete,
    documents: documentsComplete,
    spreads: spreadsReady,
    modelSnapshot: modelSnapshotReady,
    riskRun: riskRunCompleted,
    memo: memoComplete,
    decision: decisionComplete,
    committeeReady: committeeReadyFlag,
  };

  // ── Latest references ──────────────────────────────────────────────────
  const latest: DealAnalysisLatest = {
    riskRunId: riskRunInfo.latestRiskRunId,
    aiRiskRunId: riskRunInfo.latestAiRiskRunId,
    memoRunId: memo?.latestRunId ?? null,
    decisionId: decision?.id ?? null,
    snapshotId: snapshot?.id ?? null,
    reconciliationStatus: recon?.overall_status ?? null,
    updatedAt: latestUpdatedAt({
      snapshot,
      riskRun: riskRunInfo,
      memo,
      decision,
      committeeReady,
    }),
  };

  const latestSuccessful: DealAnalysisLatestSuccessful = {
    riskRunId: riskRunInfo.latestCompletedRiskRunId,
    memoRunId: memo?.completedRunId ?? null,
    decisionId: decisionComplete ? decision!.id : null,
    completedAt: riskRunInfo.latestCompletedRiskRunCreatedAt,
  };

  // ── Granular write-failure short-circuit ───────────────────────────────
  // The pipeline emits `banker_analysis.write_failed` events for every
  // write-failure blocker it returns. When such an event is more recent
  // than the latest successful run, the status helper short-circuits to
  // analysis_failed with the SPECIFIC code from the event — preserving
  // the granular failure reason for the banker.
  //
  // This must run BEFORE `running_analysis` resolution because
  // RISK_RUN_MARKER_UPDATE_FAILED leaves risk_runs stuck in 'running' (the
  // update is what failed). Without this short-circuit the UI would show
  // "Analysis running" until the next stale-reaper sweep.
  const activeWriteFailure = pickActiveWriteFailure(
    writeFailure,
    latestSuccessful,
  );
  if (activeWriteFailure) {
    return mergeStaleRecoveryWarning(
      buildWriteFailureEventStatus({
        dealId,
        bankId,
        completed,
        latest,
        latestSuccessful,
        writeFailure: activeWriteFailure,
      }),
      staleRecovery,
      latestSuccessful,
    );
  }

  // ── Phase resolution (strict priority) ─────────────────────────────────
  // Already handled: 1. tenant_mismatch + granular write-failure short-circuit.
  const result = resolvePhase({
    dealId,
    bankId,
    completed,
    latest,
    latestSuccessful,
    riskRunInfo,
    riskRunCompleted,
    memo,
    memoComplete,
    memoSectionsExist,
    decisionComplete,
    decision,
    spreadInfo,
    committeeReadyFlag,
  });

  // STALE_RUN_RECOVERED is a fail-soft warning: it surfaces when a previous
  // banker_analysis run was reset by the inline reaper and a fresh
  // successful run hasn't superseded it yet. It NEVER changes the resolved
  // phase — it just appends a `warning` blocker so the banker knows why
  // there's a gap in the audit history.
  return mergeStaleRecoveryWarning(result, staleRecovery, latestSuccessful);
}

type ResolvePhaseInput = {
  dealId: string;
  bankId: string;
  completed: DealAnalysisCompleted;
  latest: DealAnalysisLatest;
  latestSuccessful: DealAnalysisLatestSuccessful;
  riskRunInfo: RiskRunInfo;
  riskRunCompleted: boolean;
  memo: MemoInfo | null;
  memoComplete: boolean;
  memoSectionsExist: boolean;
  decisionComplete: boolean;
  decision: { id: string; created_at: string | null } | null;
  spreadInfo: SpreadInfo | null;
  committeeReadyFlag: boolean;
};

function resolvePhase(input: ResolvePhaseInput): DealAnalysisStatus {
  const {
    dealId,
    bankId,
    completed,
    latest,
    latestSuccessful,
    riskRunInfo,
    riskRunCompleted,
    memo,
    memoComplete,
    memoSectionsExist,
    decisionComplete,
    spreadInfo,
    committeeReadyFlag,
  } = input;

  // 2. running_analysis
  if (riskRunInfo.runningRiskRunId) {
    return buildRunningStatus({
      dealId,
      bankId,
      completed,
      latest,
      latestSuccessful,
      runningRiskRunId: riskRunInfo.runningRiskRunId,
    });
  }

  // 3. waiting_for_loan_request
  if (!completed.loanRequest) {
    return buildLoanRequestStatus({
      dealId,
      bankId,
      completed,
      latest,
      latestSuccessful,
    });
  }

  // 4. waiting_for_documents
  if (!completed.documents) {
    return buildWaitingForDocumentsStatus({
      dealId,
      bankId,
      completed,
      latest,
      latestSuccessful,
    });
  }

  // 5. waiting_for_spreads
  if (!completed.spreads) {
    return buildSpreadsStatus({
      dealId,
      bankId,
      completed,
      latest,
      latestSuccessful,
      spreadInfo,
    });
  }

  // 6. analysis_failed — latest run failed and not currently running
  if (riskRunInfo.latestRiskRunStatus === "failed") {
    return buildAnalysisFailedStatus({
      dealId,
      bankId,
      completed,
      latest,
      latestSuccessful,
      latestRiskRunError: riskRunInfo.latestRiskRunError,
      latestMemoRunStatus: memo?.latestRunStatus ?? null,
      latestMemoRunError: memo?.latestRunError ?? null,
    });
  }

  // 6b. analysis_failed — pipeline returned without writing memo sections /
  //     decision after a completed risk run. This protects against future
  //     non-fatal regressions.
  if (riskRunCompleted) {
    if (memo?.latestRunStatus === "failed") {
      return buildAnalysisFailedStatus({
        dealId,
        bankId,
        completed,
        latest,
        latestSuccessful,
        latestRiskRunError: null,
        latestMemoRunStatus: memo.latestRunStatus,
        latestMemoRunError: memo.latestRunError ?? null,
      });
    }
    if (memo?.completedRunId && !memoSectionsExist) {
      return buildWriteFailureStatus({
        dealId,
        bankId,
        completed,
        latest,
        latestSuccessful,
        code: "MEMO_SECTION_WRITE_FAILED",
        sourceTable: "memo_sections",
        sourceId: memo.completedRunId,
      });
    }
    if (memoComplete && memo?.completedRunId && !decisionComplete) {
      return buildWriteFailureStatus({
        dealId,
        bankId,
        completed,
        latest,
        latestSuccessful,
        code: "DECISION_WRITE_FAILED",
        sourceTable: "deal_decisions",
        sourceId: memo.completedRunId,
      });
    }
  }

  // 7. review_reconciliation — only when memo + decision succeeded but recon
  //    flagged review.
  if (
    memoComplete &&
    decisionComplete &&
    (latest.reconciliationStatus === "FLAGS" ||
      latest.reconciliationStatus === "CONFLICTS")
  ) {
    return buildReconciliationStatus({
      dealId,
      bankId,
      completed,
      latest,
      latestSuccessful,
    });
  }

  // 8. ready_for_committee
  if (
    committeeReadyFlag &&
    decisionComplete &&
    memoComplete &&
    latest.reconciliationStatus === "CLEAN"
  ) {
    return buildReadyForCommitteeStatus({
      dealId,
      bankId,
      completed,
      latest,
      latestSuccessful,
    });
  }

  // 8b. Memo + decision written, recon CLEAN, but committee-ready signal
  //     missing — pipeline silently dropped the upsert.
  if (
    memoComplete &&
    decisionComplete &&
    latest.reconciliationStatus === "CLEAN" &&
    !committeeReadyFlag
  ) {
    return buildWriteFailureStatus({
      dealId,
      bankId,
      completed,
      latest,
      latestSuccessful,
      code: "COMMITTEE_READY_WRITE_FAILED",
      sourceTable: "deal_credit_memo_status",
      sourceId: dealId,
    });
  }

  // 9. not_started — everything that gates execution is satisfied; no analysis
  //    has been kicked off yet.
  return buildNotStartedStatus({
    dealId,
    bankId,
    completed,
    latest,
    latestSuccessful,
  });
}

// ─── Phase builders ──────────────────────────────────────────────────────────

function tenantMismatchStatus(
  dealId: string,
  bankId: string,
): DealAnalysisStatus {
  const blocker: DealAnalysisBlocker = {
    code: "TENANT_MISMATCH",
    severity: "error",
    title: "Deal not available",
    message: "This deal is not associated with your bank.",
    actionLabel: "Return to deals",
    actionHref: "/deals",
    sourceTable: "deals",
    sourceId: dealId,
  };
  return {
    dealId,
    bankId,
    phase: "analysis_failed",
    blockers: [blocker],
    completed: emptyCompleted(),
    latest: emptyLatest(),
    latestSuccessful: emptyLatestSuccessful(),
    canRunAnalysis: false,
    canForceReplay: false,
    primaryAction: {
      label: blocker.actionLabel,
      href: blocker.actionHref,
      method: "GET",
      disabledReason: undefined,
    },
  };
}

type PhaseCtx = {
  dealId: string;
  bankId: string;
  completed: DealAnalysisCompleted;
  latest: DealAnalysisLatest;
  latestSuccessful: DealAnalysisLatestSuccessful;
};

function buildRunningStatus(
  ctx: PhaseCtx & { runningRiskRunId: string },
): DealAnalysisStatus {
  return {
    dealId: ctx.dealId,
    bankId: ctx.bankId,
    phase: "running_analysis",
    blockers: [],
    completed: ctx.completed,
    latest: ctx.latest,
    latestSuccessful: ctx.latestSuccessful,
    canRunAnalysis: false,
    canForceReplay: false,
    primaryAction: {
      label: "Analysis running…",
      method: "GET",
      disabledReason: "Analysis is in progress.",
    },
  };
}

function buildLoanRequestStatus(ctx: PhaseCtx): DealAnalysisStatus {
  const blocker: DealAnalysisBlocker = {
    code: "LOAN_REQUEST_INCOMPLETE",
    severity: "error",
    title: "Loan request is incomplete",
    message:
      "Buddy needs a requested loan amount before it can run analysis.",
    actionLabel: "Complete loan request",
    actionHref: `/deals/${ctx.dealId}/loan-request`,
    sourceTable: "deal_loan_requests",
  };
  return {
    dealId: ctx.dealId,
    bankId: ctx.bankId,
    phase: "waiting_for_loan_request",
    blockers: [blocker],
    completed: ctx.completed,
    latest: ctx.latest,
    latestSuccessful: ctx.latestSuccessful,
    canRunAnalysis: false,
    canForceReplay: false,
    primaryAction: {
      label: blocker.actionLabel,
      href: blocker.actionHref,
      method: "GET",
    },
  };
}

function buildWaitingForDocumentsStatus(ctx: PhaseCtx): DealAnalysisStatus {
  const blocker: DealAnalysisBlocker = {
    code: "DOCUMENTS_MISSING",
    severity: "error",
    title: "Documents required",
    message:
      "Buddy needs at least one financial document before it can run analysis.",
    actionLabel: "Upload documents",
    actionHref: `/deals/${ctx.dealId}/documents`,
    sourceTable: "deal_documents",
  };
  return {
    dealId: ctx.dealId,
    bankId: ctx.bankId,
    phase: "waiting_for_documents",
    blockers: [blocker],
    completed: ctx.completed,
    latest: ctx.latest,
    latestSuccessful: ctx.latestSuccessful,
    canRunAnalysis: false,
    canForceReplay: false,
    primaryAction: {
      label: blocker.actionLabel,
      href: blocker.actionHref,
      method: "GET",
    },
  };
}

function buildSpreadsStatus(
  ctx: PhaseCtx & { spreadInfo: SpreadInfo | null },
): DealAnalysisStatus {
  const info = ctx.spreadInfo;
  const baseHref = `/deals/${ctx.dealId}/spreads`;
  let code = "SPREADS_NOT_STARTED";
  let title = "Spreads not started";
  let message = "Buddy hasn't started spreading this deal yet.";
  let actionLabel = "Start spreads";
  let severity: BlockerSeverity = "error";

  if (info?.kind === "running") {
    code = "SPREADS_RUNNING";
    title = "Spreads in progress";
    message = "Buddy is spreading this deal. Analysis will start automatically once spreads complete.";
    actionLabel = "View spreads";
    severity = "warning";
  } else if (info?.kind === "failed") {
    code = "SPREADS_FAILED";
    title = "Spreads failed";
    message = "The latest spread job failed. Review the spread to retry.";
    actionLabel = "Review spreads";
    severity = "error";
  } else if (info?.kind === "other") {
    code = "SPREADS_NOT_READY";
    title = "Spreads not ready";
    message =
      "The latest spread is not in a ready state. Review the spread to continue.";
    actionLabel = "Review spreads";
    severity = "error";
  }

  const blocker: DealAnalysisBlocker = {
    code,
    severity,
    title,
    message,
    actionLabel,
    actionHref: baseHref,
    sourceTable: "deal_spreads",
    sourceId: info?.id ?? undefined,
  };

  return {
    dealId: ctx.dealId,
    bankId: ctx.bankId,
    phase: "waiting_for_spreads",
    blockers: [blocker],
    completed: ctx.completed,
    latest: ctx.latest,
    latestSuccessful: ctx.latestSuccessful,
    canRunAnalysis: false,
    canForceReplay: false,
    primaryAction: {
      label: actionLabel,
      href: baseHref,
      method: "GET",
    },
  };
}

function buildAnalysisFailedStatus(
  ctx: PhaseCtx & {
    latestRiskRunError: string | null;
    latestMemoRunStatus: string | null;
    latestMemoRunError: string | null;
  },
): DealAnalysisStatus {
  const memoFailed = ctx.latestMemoRunStatus === "failed";
  const blocker: DealAnalysisBlocker = memoFailed
    ? {
        code: "MEMO_RUN_FAILED",
        severity: "error",
        title: "Memo generation failed",
        message:
          ctx.latestMemoRunError?.slice(0, 240) ??
          "The credit memo step did not complete. Retry analysis to try again.",
        actionLabel: "Retry analysis",
        sourceTable: "memo_runs",
        sourceId: ctx.latest.memoRunId ?? undefined,
      }
    : {
        code: "RISK_RUN_FAILED",
        severity: "error",
        title: "Risk analysis failed",
        message:
          ctx.latestRiskRunError?.slice(0, 240) ??
          "The risk analysis step did not complete. Retry analysis to try again.",
        actionLabel: "Retry analysis",
        sourceTable: "risk_runs",
        sourceId: ctx.latest.riskRunId ?? undefined,
      };

  return {
    dealId: ctx.dealId,
    bankId: ctx.bankId,
    phase: "analysis_failed",
    blockers: [blocker],
    completed: ctx.completed,
    latest: ctx.latest,
    latestSuccessful: ctx.latestSuccessful,
    canRunAnalysis: true,
    canForceReplay: true,
    primaryAction: {
      label: blocker.actionLabel,
      href: `/deals/${ctx.dealId}`,
      method: "POST",
    },
  };
}

function buildWriteFailureStatus(
  ctx: PhaseCtx & {
    code:
      | "MEMO_SECTION_WRITE_FAILED"
      | "DECISION_WRITE_FAILED"
      | "COMMITTEE_READY_WRITE_FAILED";
    sourceTable: string;
    sourceId: string;
  },
): DealAnalysisStatus {
  const titles: Record<typeof ctx.code, string> = {
    MEMO_SECTION_WRITE_FAILED: "Memo write failed",
    DECISION_WRITE_FAILED: "Decision write failed",
    COMMITTEE_READY_WRITE_FAILED: "Committee-ready write failed",
  };
  const messages: Record<typeof ctx.code, string> = {
    MEMO_SECTION_WRITE_FAILED:
      "Buddy generated the memo, but storing the sections failed. Retry analysis to recover.",
    DECISION_WRITE_FAILED:
      "Buddy generated the analysis, but writing the system decision failed. Retry analysis to recover.",
    COMMITTEE_READY_WRITE_FAILED:
      "Buddy completed the analysis, but flipping the committee-ready signal failed. Retry analysis to recover.",
  };

  const blocker: DealAnalysisBlocker = {
    code: ctx.code,
    severity: "error",
    title: titles[ctx.code],
    message: messages[ctx.code],
    actionLabel: "Retry analysis",
    sourceTable: ctx.sourceTable,
    sourceId: ctx.sourceId,
  };

  return {
    dealId: ctx.dealId,
    bankId: ctx.bankId,
    phase: "analysis_failed",
    blockers: [blocker],
    completed: ctx.completed,
    latest: ctx.latest,
    latestSuccessful: ctx.latestSuccessful,
    canRunAnalysis: true,
    canForceReplay: true,
    primaryAction: {
      label: blocker.actionLabel,
      href: `/deals/${ctx.dealId}`,
      method: "POST",
    },
  };
}

function buildReconciliationStatus(ctx: PhaseCtx): DealAnalysisStatus {
  const isHard = ctx.latest.reconciliationStatus === "CONFLICTS";
  const blocker: DealAnalysisBlocker = {
    code: isHard ? "RECONCILIATION_CONFLICTS" : "RECONCILIATION_FLAGS",
    severity: isHard ? "error" : "warning",
    title: "Reconciliation needs review",
    message:
      "Analysis complete, but reconciliation requires review before committee.",
    actionLabel: "Review reconciliation",
    actionHref: `/deals/${ctx.dealId}/reconciliation`,
    sourceTable: "deal_reconciliation_results",
    sourceId: ctx.dealId,
  };
  return {
    dealId: ctx.dealId,
    bankId: ctx.bankId,
    phase: "review_reconciliation",
    blockers: [blocker],
    completed: ctx.completed,
    latest: ctx.latest,
    latestSuccessful: ctx.latestSuccessful,
    canRunAnalysis: false,
    canForceReplay: true,
    primaryAction: {
      label: blocker.actionLabel,
      href: blocker.actionHref,
      method: "GET",
    },
  };
}

function buildReadyForCommitteeStatus(ctx: PhaseCtx): DealAnalysisStatus {
  return {
    dealId: ctx.dealId,
    bankId: ctx.bankId,
    phase: "ready_for_committee",
    blockers: [],
    completed: ctx.completed,
    latest: ctx.latest,
    latestSuccessful: ctx.latestSuccessful,
    canRunAnalysis: false,
    canForceReplay: true,
    primaryAction: {
      label: "View credit memo",
      href: `/deals/${ctx.dealId}/credit-memo`,
      method: "GET",
    },
  };
}

function buildNotStartedStatus(ctx: PhaseCtx): DealAnalysisStatus {
  return {
    dealId: ctx.dealId,
    bankId: ctx.bankId,
    phase: "not_started",
    blockers: [],
    completed: ctx.completed,
    latest: ctx.latest,
    latestSuccessful: ctx.latestSuccessful,
    canRunAnalysis: true,
    canForceReplay: false,
    primaryAction: {
      label: "Run analysis",
      href: `/deals/${ctx.dealId}`,
      method: "POST",
    },
  };
}

// ─── Empty defaults ──────────────────────────────────────────────────────────

function emptyCompleted(): DealAnalysisCompleted {
  return {
    loanRequest: false,
    documents: false,
    spreads: false,
    modelSnapshot: false,
    riskRun: false,
    memo: false,
    decision: false,
    committeeReady: false,
  };
}

function emptyLatest(): DealAnalysisLatest {
  return {
    riskRunId: null,
    aiRiskRunId: null,
    memoRunId: null,
    decisionId: null,
    snapshotId: null,
    reconciliationStatus: null,
    updatedAt: null,
  };
}

function emptyLatestSuccessful(): DealAnalysisLatestSuccessful {
  return {
    riskRunId: null,
    memoRunId: null,
    decisionId: null,
    completedAt: null,
  };
}

// ─── DB readers ──────────────────────────────────────────────────────────────

type DealRow = { id: string; bank_id: string; loan_amount: number | null };

async function loadDeal(
  sb: SupabaseClient,
  dealId: string,
): Promise<DealRow | null> {
  const { data } = await sb
    .from("deals")
    .select("id, bank_id, loan_amount")
    .eq("id", dealId)
    .maybeSingle();
  return (data as DealRow | null) ?? null;
}

async function loadLatestLoanRequest(
  sb: SupabaseClient,
  dealId: string,
): Promise<{ requested_amount: number | null } | null> {
  const { data } = await sb
    .from("deal_loan_requests")
    .select("requested_amount")
    .eq("deal_id", dealId)
    .order("request_number", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as any) ?? null;
}

async function loadDocumentCount(
  sb: SupabaseClient,
  dealId: string,
  bankId: string,
): Promise<number> {
  const { data } = await sb
    .from("deal_documents")
    .select("id")
    .eq("deal_id", dealId)
    .eq("bank_id", bankId)
    .limit(1);
  return Array.isArray(data) ? data.length : 0;
}

type SpreadInfo = {
  id: string | null;
  status: string | null;
  updatedAt: string | null;
  kind: "ready" | "running" | "failed" | "other";
};

async function loadSpreadInfo(
  sb: SupabaseClient,
  dealId: string,
  bankId: string,
): Promise<SpreadInfo | null> {
  const { data } = await sb
    .from("deal_spreads")
    .select("id, status, updated_at")
    .eq("deal_id", dealId)
    .eq("bank_id", bankId)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  const status = (data as any).status as string | null;
  const id = (data as any).id as string | null;
  const updatedAt = (data as any).updated_at as string | null;
  let kind: SpreadInfo["kind"] = "other";
  if (status === "ready") kind = "ready";
  else if (status === "running" || status === "queued" || status === "pending")
    kind = "running";
  else if (status === "failed" || status === "error") kind = "failed";
  return { id, status, updatedAt, kind };
}

async function loadLatestSnapshot(
  sb: SupabaseClient,
  dealId: string,
): Promise<{ id: string; calculated_at: string | null } | null> {
  const { data } = await sb
    .from("deal_model_snapshots")
    .select("id, calculated_at")
    .eq("deal_id", dealId)
    .order("calculated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as any) ?? null;
}

type RiskRunInfo = {
  latestRiskRunId: string | null;
  latestRiskRunStatus: string | null;
  latestRiskRunError: string | null;
  latestRiskRunCreatedAt: string | null;
  latestCompletedRiskRunId: string | null;
  latestCompletedRiskRunCreatedAt: string | null;
  latestAiRiskRunId: string | null;
  runningRiskRunId: string | null;
};

async function loadRiskRunInfo(
  sb: SupabaseClient,
  dealId: string,
): Promise<RiskRunInfo> {
  const { data } = await sb
    .from("risk_runs")
    .select("id, status, error, created_at, model_name")
    .eq("deal_id", dealId)
    .order("created_at", { ascending: false })
    .limit(20);
  const rows = (data ?? []) as Array<{
    id: string;
    status: string | null;
    error: string | null;
    created_at: string | null;
    model_name?: string | null;
  }>;

  const latest = rows[0] ?? null;
  const completed = rows.find((r) => r.status === "completed") ?? null;
  const cutoff = Date.now() - RUNNING_FRESHNESS_WINDOW_MS;
  const running =
    rows.find((r) => {
      if (r.status !== "running") return false;
      const t = r.created_at ? new Date(r.created_at).getTime() : NaN;
      return !Number.isNaN(t) && t >= cutoff;
    }) ?? null;

  // ai_risk_runs latest
  const { data: aiRows } = await sb
    .from("ai_risk_runs")
    .select("id")
    .eq("deal_id", dealId)
    .order("created_at", { ascending: false })
    .limit(1);
  const latestAiRiskRunId =
    Array.isArray(aiRows) && aiRows.length > 0 ? (aiRows[0] as any).id : null;

  return {
    latestRiskRunId: latest?.id ?? null,
    latestRiskRunStatus: latest?.status ?? null,
    latestRiskRunError: latest?.error ?? null,
    latestRiskRunCreatedAt: latest?.created_at ?? null,
    latestCompletedRiskRunId: completed?.id ?? null,
    latestCompletedRiskRunCreatedAt: completed?.created_at ?? null,
    latestAiRiskRunId,
    runningRiskRunId: running?.id ?? null,
  };
}

type MemoInfo = {
  latestRunId: string | null;
  latestRunStatus: string | null;
  latestRunError: string | null;
  latestRunCreatedAt: string | null;
  completedRunId: string | null;
  sectionCount: number;
};

async function loadLatestMemoRun(
  sb: SupabaseClient,
  dealId: string,
): Promise<MemoInfo | null> {
  const { data } = await sb
    .from("memo_runs")
    .select("id, status, error, created_at")
    .eq("deal_id", dealId)
    .order("created_at", { ascending: false })
    .limit(20);
  const rows = (data ?? []) as Array<{
    id: string;
    status: string | null;
    error: string | null;
    created_at: string | null;
  }>;
  if (rows.length === 0) return null;
  const latest = rows[0];
  const completed = rows.find((r) => r.status === "completed") ?? null;

  // Section count for completed (or latest if no completed) memo run
  const focusId = completed?.id ?? latest.id;
  let sectionCount = 0;
  if (focusId) {
    const { data: secs } = await sb
      .from("memo_sections")
      .select("section_key")
      .eq("memo_run_id", focusId);
    sectionCount = Array.isArray(secs) ? secs.length : 0;
  }

  return {
    latestRunId: latest.id,
    latestRunStatus: latest.status,
    latestRunError: latest.error,
    latestRunCreatedAt: latest.created_at,
    completedRunId: completed?.id ?? null,
    sectionCount,
  };
}

async function loadLatestDecision(
  sb: SupabaseClient,
  dealId: string,
): Promise<{ id: string; created_at: string | null } | null> {
  const { data } = await sb
    .from("deal_decisions")
    .select("id, created_at")
    .eq("deal_id", dealId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as any) ?? null;
}

async function loadCommitteeReady(
  sb: SupabaseClient,
  dealId: string,
): Promise<{ current_status: string | null; updated_at: string | null } | null> {
  const { data } = await sb
    .from("deal_credit_memo_status")
    .select("current_status, updated_at")
    .eq("deal_id", dealId)
    .maybeSingle();
  return (data as any) ?? null;
}

async function loadReconciliation(
  sb: SupabaseClient,
  dealId: string,
): Promise<{ overall_status: "CLEAN" | "FLAGS" | "CONFLICTS" | null } | null> {
  const { data } = await sb
    .from("deal_reconciliation_results")
    .select("overall_status, reconciled_at")
    .eq("deal_id", dealId)
    .order("reconciled_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as any) ?? null;
}

type WriteFailureCode =
  | "AI_RISK_RUN_WRITE_FAILED"
  | "RISK_RUN_MARKER_UPDATE_FAILED"
  | "MEMO_SECTION_WRITE_FAILED"
  | "MEMO_RUN_MARKER_UPDATE_FAILED"
  | "DECISION_WRITE_FAILED"
  | "COMMITTEE_READY_WRITE_FAILED";

const WRITE_FAILURE_CODES: ReadonlySet<WriteFailureCode> = new Set([
  "AI_RISK_RUN_WRITE_FAILED",
  "RISK_RUN_MARKER_UPDATE_FAILED",
  "MEMO_SECTION_WRITE_FAILED",
  "MEMO_RUN_MARKER_UPDATE_FAILED",
  "DECISION_WRITE_FAILED",
  "COMMITTEE_READY_WRITE_FAILED",
]);

type WriteFailureEvent = {
  code: WriteFailureCode;
  failedAt: string | null;
  error: string | null;
  ids: Record<string, unknown>;
} | null;

const WRITE_FAILURE_COPY: Record<
  WriteFailureCode,
  { title: string; message: string; sourceTable: string }
> = {
  AI_RISK_RUN_WRITE_FAILED: {
    title: "Risk result write failed",
    message:
      "Risk analysis completed but the result row could not be saved. Retry analysis to recover.",
    sourceTable: "ai_risk_runs",
  },
  RISK_RUN_MARKER_UPDATE_FAILED: {
    title: "Risk run finalization failed",
    message:
      "Risk analysis completed but the audit row could not be marked complete. Retry analysis to recover.",
    sourceTable: "risk_runs",
  },
  MEMO_SECTION_WRITE_FAILED: {
    title: "Memo write failed",
    message:
      "Buddy generated the memo, but storing the sections failed. Retry analysis to recover.",
    sourceTable: "memo_sections",
  },
  MEMO_RUN_MARKER_UPDATE_FAILED: {
    title: "Memo finalization failed",
    message:
      "Buddy generated and stored the memo, but could not mark the run complete. Retry analysis to recover.",
    sourceTable: "memo_runs",
  },
  DECISION_WRITE_FAILED: {
    title: "Decision write failed",
    message:
      "Buddy generated the analysis, but writing the system decision failed. Retry analysis to recover.",
    sourceTable: "deal_decisions",
  },
  COMMITTEE_READY_WRITE_FAILED: {
    title: "Committee-ready write failed",
    message:
      "Buddy completed the analysis, but flipping the committee-ready signal failed. Retry analysis to recover.",
    sourceTable: "deal_credit_memo_status",
  },
};

type StaleRecoveryEvent = {
  recoveredAt: string | null;
  riskRunId: string | null;
} | null;

async function loadLatestWriteFailure(
  sb: SupabaseClient,
  dealId: string,
): Promise<WriteFailureEvent> {
  const { data } = await sb
    .from("deal_events")
    .select("payload, created_at")
    .eq("deal_id", dealId)
    .eq("kind", "banker_analysis.write_failed")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  const payload = (data as any).payload ?? {};
  const meta = payload?.meta ?? {};
  const code = meta.blocker;
  if (typeof code !== "string" || !WRITE_FAILURE_CODES.has(code as WriteFailureCode)) {
    return null;
  }
  return {
    code: code as WriteFailureCode,
    failedAt: (data as any).created_at ?? null,
    error: typeof meta.error === "string" ? meta.error : null,
    ids: typeof meta.ids === "object" && meta.ids !== null ? meta.ids : {},
  };
}

function pickActiveWriteFailure(
  failure: WriteFailureEvent,
  latestSuccessful: DealAnalysisLatestSuccessful,
): WriteFailureEvent {
  if (!failure || !failure.failedAt) return null;
  // Suppress once a successful run completed AFTER the write failure.
  if (
    latestSuccessful.completedAt &&
    latestSuccessful.completedAt > failure.failedAt
  ) {
    return null;
  }
  return failure;
}

function buildWriteFailureEventStatus(
  ctx: PhaseCtx & { writeFailure: NonNullable<WriteFailureEvent> },
): DealAnalysisStatus {
  const copy = WRITE_FAILURE_COPY[ctx.writeFailure.code];
  const idsAny = ctx.writeFailure.ids as Record<string, unknown>;
  const sourceIdFromIds: Record<WriteFailureCode, string | undefined> = {
    AI_RISK_RUN_WRITE_FAILED: stringOrUndef(idsAny.riskRunId ?? idsAny.aiRiskRunId),
    RISK_RUN_MARKER_UPDATE_FAILED: stringOrUndef(idsAny.riskRunId),
    MEMO_SECTION_WRITE_FAILED: stringOrUndef(idsAny.memoRunId),
    MEMO_RUN_MARKER_UPDATE_FAILED: stringOrUndef(idsAny.memoRunId),
    DECISION_WRITE_FAILED: stringOrUndef(idsAny.memoRunId ?? idsAny.decisionId),
    COMMITTEE_READY_WRITE_FAILED: ctx.dealId,
  };

  const blocker: DealAnalysisBlocker = {
    code: ctx.writeFailure.code,
    severity: "error",
    title: copy.title,
    message: ctx.writeFailure.error
      ? `${copy.message} (${ctx.writeFailure.error.slice(0, 200)})`
      : copy.message,
    actionLabel: "Retry analysis",
    sourceTable: copy.sourceTable,
    sourceId: sourceIdFromIds[ctx.writeFailure.code],
  };

  return {
    dealId: ctx.dealId,
    bankId: ctx.bankId,
    phase: "analysis_failed",
    blockers: [blocker],
    completed: ctx.completed,
    latest: ctx.latest,
    latestSuccessful: ctx.latestSuccessful,
    canRunAnalysis: true,
    canForceReplay: true,
    primaryAction: {
      label: blocker.actionLabel,
      href: `/deals/${ctx.dealId}`,
      method: "POST",
    },
  };
}

function stringOrUndef(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

async function loadLatestStaleRecovery(
  sb: SupabaseClient,
  dealId: string,
): Promise<StaleRecoveryEvent> {
  const { data } = await sb
    .from("deal_events")
    .select("payload, created_at")
    .eq("deal_id", dealId)
    .eq("kind", "banker_analysis.stale_run_recovered")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  const payload = (data as any).payload ?? {};
  const meta = payload?.meta ?? {};
  return {
    recoveredAt: (data as any).created_at ?? null,
    riskRunId:
      typeof meta.risk_run_id === "string" ? meta.risk_run_id : null,
  };
}

function mergeStaleRecoveryWarning(
  base: DealAnalysisStatus,
  recovery: StaleRecoveryEvent,
  latestSuccessful: DealAnalysisLatestSuccessful,
): DealAnalysisStatus {
  if (!recovery || !recovery.recoveredAt) return base;
  // If a successful run completed AFTER the recovery event, the stale row
  // is no longer relevant — suppress the warning.
  if (
    latestSuccessful.completedAt &&
    latestSuccessful.completedAt > recovery.recoveredAt
  ) {
    return base;
  }
  // Don't surface on tenant_mismatch — the user shouldn't see anything
  // about this deal.
  const isTenantMismatch =
    base.blockers.length > 0 && base.blockers[0].code === "TENANT_MISMATCH";
  if (isTenantMismatch) return base;

  const warning: DealAnalysisBlocker = {
    code: "STALE_RUN_RECOVERED",
    severity: "warning",
    title: "Previous run was reset",
    message:
      "A previous analysis run was interrupted and has been reset. The next run will start fresh.",
    actionLabel: "Run analysis",
    sourceTable: "risk_runs",
    sourceId: recovery.riskRunId ?? undefined,
  };
  return {
    ...base,
    blockers: [warning, ...base.blockers],
  };
}

// ─── Misc ───────────────────────────────────────────────────────────────────

function latestUpdatedAt(args: {
  snapshot: { calculated_at?: string | null } | null;
  riskRun: RiskRunInfo;
  memo: MemoInfo | null;
  decision: { created_at: string | null } | null;
  committeeReady: { updated_at: string | null } | null;
}): string | null {
  const candidates = [
    args.snapshot?.calculated_at ?? null,
    args.riskRun.latestRiskRunCreatedAt,
    args.memo?.latestRunCreatedAt ?? null,
    args.decision?.created_at ?? null,
    args.committeeReady?.updated_at ?? null,
  ].filter((v): v is string => typeof v === "string" && v.length > 0);
  if (candidates.length === 0) return null;
  return candidates.reduce((acc, v) => (v > acc ? v : acc), candidates[0]);
}

async function loadAdmin(): Promise<SupabaseClient> {
  const { supabaseAdmin } = await import("@/lib/supabase/admin");
  return supabaseAdmin();
}
