/**
 * Tests for getDealAnalysisStatus.
 *
 * Verifies STRICT phase-priority resolution (first match wins), single
 * primaryAction guarantee, success-definition enforcement, and tenant safety.
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  getDealAnalysisStatus,
  type DealAnalysisStatus,
} from "../getDealAnalysisStatus";
import { fakeSupabase } from "./_fakeSupabase";

const DEAL = "deal_1";
const BANK = "bank_1";

const dealRow = (loan_amount: number | null = 250_000) => ({
  id: DEAL,
  bank_id: BANK,
  loan_amount,
});

const loanReqRow = () => ({
  id: "lr_1",
  deal_id: DEAL,
  request_number: 1,
  requested_amount: 250_000,
});

const docRow = () => ({
  id: "doc_1",
  deal_id: DEAL,
  bank_id: BANK,
  document_type: "T12",
});

const readySpread = () => ({
  id: "sp_1",
  deal_id: DEAL,
  bank_id: BANK,
  status: "ready",
  updated_at: new Date().toISOString(),
});

const snapshot = () => ({
  id: "snap_1",
  deal_id: DEAL,
  calculated_at: new Date().toISOString(),
});

const completedRiskRun = () => ({
  id: "rr_complete",
  deal_id: DEAL,
  status: "completed",
  model_name: "banker_analysis_pipeline",
  created_at: new Date().toISOString(),
});

const aiRiskRun = () => ({
  id: "ai_rr_1",
  deal_id: DEAL,
  bank_id: BANK,
  created_at: new Date().toISOString(),
});

const completedMemoRun = () => ({
  id: "mr_complete",
  deal_id: DEAL,
  status: "completed",
  created_at: new Date().toISOString(),
});

const memoSection = (memoRunId: string) => ({
  id: "ms_1",
  memo_run_id: memoRunId,
  section_key: "executive_summary",
  title: "Exec",
  content: "ok",
});

const decisionRow = () => ({
  id: "dec_1",
  deal_id: DEAL,
  decision: "conditional_approval",
  created_at: new Date().toISOString(),
});

const committeeReadyRow = () => ({
  deal_id: DEAL,
  current_status: "ready_for_committee",
  updated_at: new Date().toISOString(),
});

const cleanRecon = () => ({
  deal_id: DEAL,
  overall_status: "CLEAN",
  reconciled_at: new Date().toISOString(),
});

function status(fixtures: Record<string, any[]>) {
  const store = fakeSupabase(fixtures);
  return getDealAnalysisStatus({
    dealId: DEAL,
    callerBankId: BANK,
    _sb: store.sb,
  });
}

function assertSinglePrimaryAction(s: DealAnalysisStatus) {
  assert.ok(s.primaryAction, "primaryAction must always be set");
  assert.equal(typeof s.primaryAction.label, "string");
  assert.ok(s.primaryAction.label.length > 0);
}

// ─── Phase 1: tenant_mismatch ──────────────────────────────────────────────

test("tenant_mismatch when caller bank does not match deal bank", async () => {
  const store = fakeSupabase({ deals: [dealRow()] });
  const s = await getDealAnalysisStatus({
    dealId: DEAL,
    callerBankId: "wrong_bank",
    _sb: store.sb,
  });
  assert.equal(s.phase, "analysis_failed");
  assert.equal(s.blockers[0].code, "TENANT_MISMATCH");
  assert.equal(s.canRunAnalysis, false);
  assert.equal(s.canForceReplay, false);
  assertSinglePrimaryAction(s);
});

test("tenant_mismatch when deal does not exist", async () => {
  const store = fakeSupabase({ deals: [] });
  const s = await getDealAnalysisStatus({
    dealId: DEAL,
    callerBankId: BANK,
    _sb: store.sb,
  });
  assert.equal(s.phase, "analysis_failed");
  assert.equal(s.blockers[0].code, "TENANT_MISMATCH");
});

// ─── Phase 2: running_analysis ─────────────────────────────────────────────

test("running_analysis takes priority over everything but tenant_mismatch", async () => {
  const recent = new Date().toISOString();
  const s = await status({
    deals: [dealRow()],
    deal_loan_requests: [loanReqRow()],
    deal_documents: [docRow()],
    deal_spreads: [readySpread()],
    risk_runs: [
      {
        id: "rr_running",
        deal_id: DEAL,
        status: "running",
        created_at: recent,
      },
    ],
  });
  assert.equal(s.phase, "running_analysis");
  assert.equal(s.canRunAnalysis, false);
  assert.equal(s.canForceReplay, false);
  assertSinglePrimaryAction(s);
  assert.ok(s.primaryAction.disabledReason);
});

// ─── Phase 3: waiting_for_loan_request ─────────────────────────────────────

test("waiting_for_loan_request when no loan amount and no LR", async () => {
  const s = await status({
    deals: [dealRow(null)],
    deal_loan_requests: [],
    deal_documents: [docRow()],
    deal_spreads: [readySpread()],
  });
  assert.equal(s.phase, "waiting_for_loan_request");
  assert.equal(s.blockers[0].code, "LOAN_REQUEST_INCOMPLETE");
  assert.equal(s.blockers[0].severity, "error");
  assertSinglePrimaryAction(s);
});

// ─── Phase 4: waiting_for_documents ────────────────────────────────────────

test("waiting_for_documents when LR present but no docs", async () => {
  const s = await status({
    deals: [dealRow()],
    deal_loan_requests: [loanReqRow()],
    deal_documents: [],
    deal_spreads: [],
  });
  assert.equal(s.phase, "waiting_for_documents");
  assert.equal(s.blockers[0].code, "DOCUMENTS_MISSING");
  assertSinglePrimaryAction(s);
});

// ─── Phase 5: waiting_for_spreads ──────────────────────────────────────────

test("waiting_for_spreads emits SPREADS_NOT_STARTED when no spread row", async () => {
  const s = await status({
    deals: [dealRow()],
    deal_loan_requests: [loanReqRow()],
    deal_documents: [docRow()],
    deal_spreads: [],
  });
  assert.equal(s.phase, "waiting_for_spreads");
  assert.equal(s.blockers[0].code, "SPREADS_NOT_STARTED");
});

test("waiting_for_spreads emits SPREADS_RUNNING when in progress", async () => {
  const s = await status({
    deals: [dealRow()],
    deal_loan_requests: [loanReqRow()],
    deal_documents: [docRow()],
    deal_spreads: [
      { id: "sp_run", deal_id: DEAL, bank_id: BANK, status: "running" },
    ],
  });
  assert.equal(s.phase, "waiting_for_spreads");
  assert.equal(s.blockers[0].code, "SPREADS_RUNNING");
  assert.equal(s.blockers[0].severity, "warning");
});

test("waiting_for_spreads emits SPREADS_FAILED on error", async () => {
  const s = await status({
    deals: [dealRow()],
    deal_loan_requests: [loanReqRow()],
    deal_documents: [docRow()],
    deal_spreads: [
      { id: "sp_fail", deal_id: DEAL, bank_id: BANK, status: "failed" },
    ],
  });
  assert.equal(s.phase, "waiting_for_spreads");
  assert.equal(s.blockers[0].code, "SPREADS_FAILED");
  assert.equal(s.blockers[0].severity, "error");
});

// ─── Phase 6: analysis_failed (terminal failure) ───────────────────────────

test("analysis_failed when latest risk run is failed", async () => {
  const s = await status({
    deals: [dealRow()],
    deal_loan_requests: [loanReqRow()],
    deal_documents: [docRow()],
    deal_spreads: [readySpread()],
    risk_runs: [
      {
        id: "rr_failed",
        deal_id: DEAL,
        status: "failed",
        error: "boom",
        created_at: new Date().toISOString(),
      },
    ],
  });
  assert.equal(s.phase, "analysis_failed");
  assert.equal(s.blockers[0].code, "RISK_RUN_FAILED");
  assert.equal(s.canRunAnalysis, true);
  assert.equal(s.canForceReplay, true);
  assertSinglePrimaryAction(s);
});

// ─── Phase 6b: write-failure detection ─────────────────────────────────────

test("MEMO_SECTION_WRITE_FAILED when memo run completed but no sections", async () => {
  // Risk run completed, memo run completed, BUT zero memo_sections.
  const s = await status({
    deals: [dealRow()],
    deal_loan_requests: [loanReqRow()],
    deal_documents: [docRow()],
    deal_spreads: [readySpread()],
    deal_model_snapshots: [snapshot()],
    risk_runs: [completedRiskRun()],
    ai_risk_runs: [aiRiskRun()],
    memo_runs: [completedMemoRun()],
    memo_sections: [],
    deal_decisions: [],
  });
  assert.equal(s.phase, "analysis_failed");
  assert.equal(s.blockers[0].code, "MEMO_SECTION_WRITE_FAILED");
});

test("DECISION_WRITE_FAILED when memo complete but no decision row", async () => {
  const memoRun = completedMemoRun();
  const s = await status({
    deals: [dealRow()],
    deal_loan_requests: [loanReqRow()],
    deal_documents: [docRow()],
    deal_spreads: [readySpread()],
    deal_model_snapshots: [snapshot()],
    risk_runs: [completedRiskRun()],
    ai_risk_runs: [aiRiskRun()],
    memo_runs: [memoRun],
    memo_sections: [memoSection(memoRun.id)],
    deal_decisions: [],
  });
  assert.equal(s.phase, "analysis_failed");
  assert.equal(s.blockers[0].code, "DECISION_WRITE_FAILED");
});

test("COMMITTEE_READY_WRITE_FAILED when memo+decision+CLEAN but no committee-ready row", async () => {
  const memoRun = completedMemoRun();
  const s = await status({
    deals: [dealRow()],
    deal_loan_requests: [loanReqRow()],
    deal_documents: [docRow()],
    deal_spreads: [readySpread()],
    deal_model_snapshots: [snapshot()],
    risk_runs: [completedRiskRun()],
    ai_risk_runs: [aiRiskRun()],
    memo_runs: [memoRun],
    memo_sections: [memoSection(memoRun.id)],
    deal_decisions: [decisionRow()],
    deal_credit_memo_status: [],
    deal_reconciliation_results: [cleanRecon()],
  });
  assert.equal(s.phase, "analysis_failed");
  assert.equal(s.blockers[0].code, "COMMITTEE_READY_WRITE_FAILED");
});

// ─── Phase 7: review_reconciliation ────────────────────────────────────────

test("review_reconciliation when memo+decision succeeded but recon FLAGS", async () => {
  const memoRun = completedMemoRun();
  const s = await status({
    deals: [dealRow()],
    deal_loan_requests: [loanReqRow()],
    deal_documents: [docRow()],
    deal_spreads: [readySpread()],
    risk_runs: [completedRiskRun()],
    memo_runs: [memoRun],
    memo_sections: [memoSection(memoRun.id)],
    deal_decisions: [decisionRow()],
    deal_reconciliation_results: [
      {
        deal_id: DEAL,
        overall_status: "FLAGS",
        reconciled_at: new Date().toISOString(),
      },
    ],
  });
  assert.equal(s.phase, "review_reconciliation");
  assert.equal(s.blockers[0].code, "RECONCILIATION_FLAGS");
  assert.equal(s.blockers[0].severity, "warning");
});

test("review_reconciliation severity is error when CONFLICTS", async () => {
  const memoRun = completedMemoRun();
  const s = await status({
    deals: [dealRow()],
    deal_loan_requests: [loanReqRow()],
    deal_documents: [docRow()],
    deal_spreads: [readySpread()],
    risk_runs: [completedRiskRun()],
    memo_runs: [memoRun],
    memo_sections: [memoSection(memoRun.id)],
    deal_decisions: [decisionRow()],
    deal_reconciliation_results: [
      {
        deal_id: DEAL,
        overall_status: "CONFLICTS",
        reconciled_at: new Date().toISOString(),
      },
    ],
  });
  assert.equal(s.phase, "review_reconciliation");
  assert.equal(s.blockers[0].code, "RECONCILIATION_CONFLICTS");
  assert.equal(s.blockers[0].severity, "error");
});

// ─── Phase 8: ready_for_committee ──────────────────────────────────────────

test("ready_for_committee when full pipeline + CLEAN + signal flipped", async () => {
  const memoRun = completedMemoRun();
  const s = await status({
    deals: [dealRow()],
    deal_loan_requests: [loanReqRow()],
    deal_documents: [docRow()],
    deal_spreads: [readySpread()],
    deal_model_snapshots: [snapshot()],
    risk_runs: [completedRiskRun()],
    ai_risk_runs: [aiRiskRun()],
    memo_runs: [memoRun],
    memo_sections: [memoSection(memoRun.id)],
    deal_decisions: [decisionRow()],
    deal_credit_memo_status: [committeeReadyRow()],
    deal_reconciliation_results: [cleanRecon()],
  });
  assert.equal(s.phase, "ready_for_committee");
  assert.equal(s.blockers.length, 0);
  assert.equal(s.completed.committeeReady, true);
  assert.equal(s.primaryAction.label, "View credit memo");
  assert.equal(s.canRunAnalysis, false);
  assert.equal(s.canForceReplay, true);
  assertSinglePrimaryAction(s);
});

// ─── Phase 9: not_started ──────────────────────────────────────────────────

test("not_started when gates pass but no analysis tables yet", async () => {
  const s = await status({
    deals: [dealRow()],
    deal_loan_requests: [loanReqRow()],
    deal_documents: [docRow()],
    deal_spreads: [readySpread()],
  });
  assert.equal(s.phase, "not_started");
  assert.equal(s.blockers.length, 0);
  assert.equal(s.canRunAnalysis, true);
  assert.equal(s.canForceReplay, false);
  assert.equal(s.primaryAction.label, "Run analysis");
  assertSinglePrimaryAction(s);
});

// ─── Single-action invariant ───────────────────────────────────────────────

test("every phase yields exactly ONE primaryAction", async () => {
  const cases: Array<Record<string, any[]>> = [
    {}, // tenant_mismatch
    {
      deals: [dealRow()],
      deal_loan_requests: [],
      deal_documents: [],
      deal_spreads: [],
    }, // waiting_for_loan_request
    {
      deals: [dealRow()],
      deal_loan_requests: [loanReqRow()],
      deal_documents: [],
      deal_spreads: [],
    }, // waiting_for_documents
    {
      deals: [dealRow()],
      deal_loan_requests: [loanReqRow()],
      deal_documents: [docRow()],
      deal_spreads: [],
    }, // waiting_for_spreads
    {
      deals: [dealRow()],
      deal_loan_requests: [loanReqRow()],
      deal_documents: [docRow()],
      deal_spreads: [readySpread()],
    }, // not_started
  ];
  for (const fx of cases) {
    const store = fakeSupabase(fx);
    const s = await getDealAnalysisStatus({
      dealId: DEAL,
      callerBankId: BANK,
      _sb: store.sb,
    });
    assertSinglePrimaryAction(s);
  }
});

// ─── latestSuccessful tracking ─────────────────────────────────────────────

// ─── Granular write-failure event surfacing ────────────────────────────────

const writeFailureEvent = (
  code: string,
  opts: {
    createdAt?: string;
    error?: string;
    ids?: Record<string, unknown>;
  } = {},
) => ({
  id: `evt_${code}`,
  deal_id: DEAL,
  kind: "banker_analysis.write_failed",
  payload: {
    meta: {
      blocker: code,
      error: opts.error ?? null,
      ids: opts.ids ?? {},
    },
  },
  created_at: opts.createdAt ?? new Date().toISOString(),
});

test("RISK_RUN_MARKER_UPDATE_FAILED short-circuits running_analysis phase", async () => {
  // risk_runs is stuck in 'running' (the marker update is what failed),
  // so without the event-based override the helper would resolve to
  // running_analysis and disable the action — leaving the banker stuck.
  const recent = new Date().toISOString();
  const s = await status({
    deals: [dealRow()],
    deal_loan_requests: [loanReqRow()],
    deal_documents: [docRow()],
    deal_spreads: [readySpread()],
    risk_runs: [
      {
        id: "rr_stuck",
        deal_id: DEAL,
        status: "running",
        model_name: "banker_analysis_pipeline",
        created_at: recent,
      },
    ],
    ai_risk_runs: [aiRiskRun()],
    deal_events: [
      writeFailureEvent("RISK_RUN_MARKER_UPDATE_FAILED", {
        ids: { riskRunId: "rr_stuck" },
      }),
    ],
  });
  assert.equal(s.phase, "analysis_failed");
  assert.equal(s.blockers.length, 1);
  assert.equal(s.blockers[0].code, "RISK_RUN_MARKER_UPDATE_FAILED");
  assert.equal(s.blockers[0].sourceId, "rr_stuck");
  assert.equal(s.canRunAnalysis, true);
  assert.equal(s.canForceReplay, true);
});

test("AI_RISK_RUN_WRITE_FAILED surfaces granular code instead of generic RISK_RUN_FAILED", async () => {
  const s = await status({
    deals: [dealRow()],
    deal_loan_requests: [loanReqRow()],
    deal_documents: [docRow()],
    deal_spreads: [readySpread()],
    risk_runs: [
      {
        id: "rr_failed",
        deal_id: DEAL,
        status: "failed",
        error: "ai_risk_run_write_failed: db down",
        created_at: new Date().toISOString(),
      },
    ],
    deal_events: [
      writeFailureEvent("AI_RISK_RUN_WRITE_FAILED", {
        error: "db down",
        ids: { riskRunId: "rr_failed" },
      }),
    ],
  });
  assert.equal(s.phase, "analysis_failed");
  assert.equal(s.blockers[0].code, "AI_RISK_RUN_WRITE_FAILED");
  // Specific UX message, not the generic "Risk analysis failed"
  assert.match(s.blockers[0].title, /Risk result write/);
});

test("MEMO_RUN_MARKER_UPDATE_FAILED surfaces from event when memo_runs stuck running", async () => {
  // memo_runs stuck in 'running' (completion update failed), sections wrote
  // successfully. Without the event the helper falls back to the generic
  // "memo run failed" inference; with it, the granular code surfaces.
  const memoRun = {
    id: "mr_stuck",
    deal_id: DEAL,
    status: "running",
    created_at: new Date().toISOString(),
  };
  const s = await status({
    deals: [dealRow()],
    deal_loan_requests: [loanReqRow()],
    deal_documents: [docRow()],
    deal_spreads: [readySpread()],
    risk_runs: [completedRiskRun()],
    memo_runs: [memoRun],
    memo_sections: [memoSection(memoRun.id)],
    deal_events: [
      writeFailureEvent("MEMO_RUN_MARKER_UPDATE_FAILED", {
        ids: { memoRunId: memoRun.id },
      }),
    ],
  });
  assert.equal(s.phase, "analysis_failed");
  assert.equal(s.blockers[0].code, "MEMO_RUN_MARKER_UPDATE_FAILED");
  assert.equal(s.blockers[0].sourceId, memoRun.id);
});

test("write-failure event is suppressed when a successful run completes after it", async () => {
  // Failure event is older than the latest successful risk run → should
  // not appear. This mirrors STALE_RUN_RECOVERED suppression.
  const earlier = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  const later = new Date(Date.now() - 1 * 60 * 1000).toISOString();
  const memoRun = { ...completedMemoRun(), created_at: later };
  const s = await status({
    deals: [dealRow()],
    deal_loan_requests: [loanReqRow()],
    deal_documents: [docRow()],
    deal_spreads: [readySpread()],
    risk_runs: [
      {
        id: "rr_ok",
        deal_id: DEAL,
        status: "completed",
        model_name: "banker_analysis_pipeline",
        created_at: later,
      },
    ],
    memo_runs: [memoRun],
    memo_sections: [memoSection(memoRun.id)],
    deal_decisions: [{ ...decisionRow(), created_at: later }],
    deal_credit_memo_status: [{ ...committeeReadyRow(), updated_at: later }],
    deal_reconciliation_results: [{ ...cleanRecon(), reconciled_at: later }],
    deal_events: [
      writeFailureEvent("MEMO_SECTION_WRITE_FAILED", { createdAt: earlier }),
    ],
  });
  assert.equal(s.phase, "ready_for_committee");
  const failureBlocker = s.blockers.find((b) =>
    [
      "MEMO_SECTION_WRITE_FAILED",
      "DECISION_WRITE_FAILED",
      "COMMITTEE_READY_WRITE_FAILED",
      "AI_RISK_RUN_WRITE_FAILED",
      "RISK_RUN_MARKER_UPDATE_FAILED",
      "MEMO_RUN_MARKER_UPDATE_FAILED",
    ].includes(b.code),
  );
  assert.equal(
    failureBlocker,
    undefined,
    "stale write-failure event should be suppressed by a newer successful run",
  );
});

test("write-failure event is NEVER attached on tenant_mismatch", async () => {
  const store = fakeSupabase({
    deals: [dealRow()],
    deal_events: [writeFailureEvent("AI_RISK_RUN_WRITE_FAILED")],
  });
  const s = await getDealAnalysisStatus({
    dealId: DEAL,
    callerBankId: "wrong_bank",
    _sb: store.sb,
  });
  assert.equal(s.phase, "analysis_failed");
  assert.equal(s.blockers.length, 1);
  assert.equal(s.blockers[0].code, "TENANT_MISMATCH");
});

// ─── STALE_RUN_RECOVERED warning ───────────────────────────────────────────

const staleRecoveredEvent = (createdAt?: string) => ({
  id: "evt_stale",
  deal_id: DEAL,
  kind: "banker_analysis.stale_run_recovered",
  payload: { meta: { risk_run_id: "rr_stale_old" } },
  created_at: createdAt ?? new Date().toISOString(),
});

test("STALE_RUN_RECOVERED warning surfaces when a recent stale recovery exists", async () => {
  const s = await status({
    deals: [dealRow()],
    deal_loan_requests: [loanReqRow()],
    deal_documents: [docRow()],
    deal_spreads: [readySpread()],
    deal_events: [staleRecoveredEvent()],
  });
  // Phase still resolves to not_started — STALE_RUN_RECOVERED is a warning,
  // not a phase override
  assert.equal(s.phase, "not_started");
  const warning = s.blockers.find((b) => b.code === "STALE_RUN_RECOVERED");
  assert.ok(warning, "expected STALE_RUN_RECOVERED warning blocker");
  assert.equal(warning!.severity, "warning");
});

test("STALE_RUN_RECOVERED is suppressed when a successful run completed AFTER the recovery", async () => {
  // Stale recovery happened first, then a fresh successful run finished.
  const earlier = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  const later = new Date(Date.now() - 1 * 60 * 1000).toISOString();
  const memoRun = { ...completedMemoRun(), created_at: later };
  const s = await status({
    deals: [dealRow()],
    deal_loan_requests: [loanReqRow()],
    deal_documents: [docRow()],
    deal_spreads: [readySpread()],
    risk_runs: [
      {
        id: "rr_complete",
        deal_id: DEAL,
        status: "completed",
        model_name: "banker_analysis_pipeline",
        created_at: later,
      },
    ],
    memo_runs: [memoRun],
    memo_sections: [memoSection(memoRun.id)],
    deal_decisions: [{ ...decisionRow(), created_at: later }],
    deal_credit_memo_status: [
      { ...committeeReadyRow(), updated_at: later },
    ],
    deal_reconciliation_results: [{ ...cleanRecon(), reconciled_at: later }],
    deal_events: [staleRecoveredEvent(earlier)],
  });
  assert.equal(s.phase, "ready_for_committee");
  const warning = s.blockers.find((b) => b.code === "STALE_RUN_RECOVERED");
  assert.equal(
    warning,
    undefined,
    "stale-recovery warning should not appear once a newer successful run exists",
  );
});

test("STALE_RUN_RECOVERED surfaces alongside other blockers (does not override phase)", async () => {
  const s = await status({
    deals: [dealRow(null)],
    deal_loan_requests: [],
    deal_documents: [docRow()],
    deal_spreads: [],
    deal_events: [staleRecoveredEvent()],
  });
  // Phase still gates on loan request
  assert.equal(s.phase, "waiting_for_loan_request");
  const codes = s.blockers.map((b) => b.code);
  assert.ok(codes.includes("LOAN_REQUEST_INCOMPLETE"));
  assert.ok(codes.includes("STALE_RUN_RECOVERED"));
});

test("STALE_RUN_RECOVERED is NEVER attached on tenant_mismatch", async () => {
  const store = fakeSupabase({
    deals: [dealRow()],
    deal_events: [staleRecoveredEvent()],
  });
  const s = await getDealAnalysisStatus({
    dealId: DEAL,
    callerBankId: "wrong_bank",
    _sb: store.sb,
  });
  assert.equal(s.phase, "analysis_failed");
  // Only TENANT_MISMATCH — stale recovery must not leak to a foreign caller
  assert.equal(s.blockers.length, 1);
  assert.equal(s.blockers[0].code, "TENANT_MISMATCH");
});

test("latestSuccessful captures last completed run + memo + decision", async () => {
  const memoRun = completedMemoRun();
  const s = await status({
    deals: [dealRow()],
    deal_loan_requests: [loanReqRow()],
    deal_documents: [docRow()],
    deal_spreads: [readySpread()],
    risk_runs: [completedRiskRun()],
    memo_runs: [memoRun],
    memo_sections: [memoSection(memoRun.id)],
    deal_decisions: [decisionRow()],
    deal_credit_memo_status: [committeeReadyRow()],
    deal_reconciliation_results: [cleanRecon()],
  });
  assert.equal(s.latestSuccessful.riskRunId, "rr_complete");
  assert.equal(s.latestSuccessful.memoRunId, memoRun.id);
  assert.ok(s.latestSuccessful.decisionId);
});
