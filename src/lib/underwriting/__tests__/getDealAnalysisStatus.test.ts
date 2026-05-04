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
