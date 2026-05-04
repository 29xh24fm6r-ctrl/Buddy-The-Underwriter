/**
 * Functional tests for runBankerAnalysisPipeline.
 *
 * Uses a lightweight in-memory Supabase fake (`fakeSupabase`) so we can
 * exercise the orchestrator end-to-end without a real DB. The fake supports
 * the subset of Supabase JS query-builder methods the pipeline actually uses.
 *
 * Test seams: the pipeline accepts an optional `_deps` parameter for
 * collaborator injection (sb, computeEngine, reconcile, provider, writeEvent,
 * logPipelineLedger). Production callers leave it undefined.
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  runBankerAnalysisPipeline,
  recommendationFromGrade,
  type BankerAnalysisDeps,
} from "../runBankerAnalysisPipeline";
import type { AIProvider, RiskOutput, MemoOutput } from "@/lib/ai/provider";

// ─── Recommendation helper ──────────────────────────────────────────────────

test("recommendationFromGrade: A-grades → approved", () => {
  assert.equal(recommendationFromGrade("A"), "approved");
  assert.equal(recommendationFromGrade("A+"), "approved");
  assert.equal(recommendationFromGrade("A-"), "approved");
});

test("recommendationFromGrade: B-grades → conditional_approval", () => {
  assert.equal(recommendationFromGrade("B"), "conditional_approval");
  assert.equal(recommendationFromGrade("B+"), "conditional_approval");
});

test("recommendationFromGrade: C-grades → escalate", () => {
  assert.equal(recommendationFromGrade("C"), "escalate");
  assert.equal(recommendationFromGrade("C-"), "escalate");
});

test("recommendationFromGrade: D / F / unknown → tabled (never auto-decline)", () => {
  assert.equal(recommendationFromGrade("D"), "tabled");
  assert.equal(recommendationFromGrade("F"), "tabled");
  assert.equal(recommendationFromGrade(""), "tabled");
  assert.equal(recommendationFromGrade(null), "tabled");
  assert.equal(recommendationFromGrade(undefined), "tabled");
});

// ─── Fake Supabase ──────────────────────────────────────────────────────────

type Row = Record<string, any>;

interface FakeFixtures {
  deals?: Row[];
  deal_loan_requests?: Row[];
  deal_spreads?: Row[];
  risk_runs?: Row[];
  ai_risk_runs?: Row[];
  memo_runs?: Row[];
  memo_sections?: Row[];
  deal_decisions?: Row[];
  deal_credit_memo_status?: Row[];
  deal_financial_facts?: Row[];
  deal_documents?: Row[];
  borrowers?: Row[];
}

type FailureSpec = { table: string; op: "insert" | "update" | "upsert" | "select" };

function fakeSupabase(
  initial: FakeFixtures = {},
  failures: FailureSpec[] = [],
) {
  const tables: Record<string, Row[]> = {
    deals: initial.deals ?? [],
    deal_loan_requests: initial.deal_loan_requests ?? [],
    deal_spreads: initial.deal_spreads ?? [],
    risk_runs: initial.risk_runs ?? [],
    ai_risk_runs: initial.ai_risk_runs ?? [],
    memo_runs: initial.memo_runs ?? [],
    memo_sections: initial.memo_sections ?? [],
    deal_decisions: initial.deal_decisions ?? [],
    deal_credit_memo_status: initial.deal_credit_memo_status ?? [],
    deal_financial_facts: initial.deal_financial_facts ?? [],
    deal_documents: initial.deal_documents ?? [],
    borrowers: initial.borrowers ?? [],
  };

  const inserts: { table: string; rows: Row[] }[] = [];
  const updates: { table: string; patch: Row; filter: Row[] }[] = [];
  const upserts: { table: string; rows: Row[] }[] = [];

  function newId(): string {
    return `id_${Math.random().toString(36).slice(2, 12)}`;
  }

  function builder(table: string) {
    let rows: Row[] = (tables[table] ??= []).slice();
    let action: "select" | "insert" | "update" | "upsert" = "select";
    let _patch: Row | null = null;
    let _insertRows: Row[] = [];
    let _upsertRows: Row[] = [];
    let _orderKey: string | null = null;
    let _orderAsc = true;
    let _limit: number | null = null;
    let _wantSingle: "single" | "maybeSingle" | null = null;
    const _hasError = false;

    function shouldFail(): boolean {
      return failures.some((f) => f.table === table && f.op === action);
    }

    const apply = (filter: (r: Row) => boolean) => {
      rows = rows.filter(filter);
      return chain;
    };

    const chain: any = {
      select(_cols?: string) {
        return chain;
      },
      insert(rowOrRows: Row | Row[]) {
        action = "insert";
        _insertRows = Array.isArray(rowOrRows) ? rowOrRows : [rowOrRows];
        return chain;
      },
      update(patch: Row) {
        action = "update";
        _patch = patch;
        return chain;
      },
      upsert(rowOrRows: Row | Row[]) {
        action = "upsert";
        _upsertRows = Array.isArray(rowOrRows) ? rowOrRows : [rowOrRows];
        return chain;
      },
      eq(col: string, val: unknown) {
        return apply((r) => r[col] === val);
      },
      neq(col: string, val: unknown) {
        return apply((r) => r[col] !== val);
      },
      not(_col: string, _op: string, _val: unknown) {
        // Permissive: only used for `.not(fact_value_num, "is", null)`.
        return chain;
      },
      in(col: string, vals: unknown[]) {
        return apply((r) => vals.includes(r[col]));
      },
      gte(col: string, val: any) {
        return apply((r) => r[col] >= val);
      },
      lt(col: string, val: any) {
        return apply((r) => r[col] < val);
      },
      gt(col: string, val: any) {
        return apply((r) => r[col] > val);
      },
      is(col: string, val: any) {
        if (val === null) return apply((r) => r[col] == null);
        return apply((r) => r[col] === val);
      },
      or(_expr: string) {
        return chain;
      },
      filter() {
        return chain;
      },
      order(col: string, opts?: { ascending?: boolean }) {
        _orderKey = col;
        _orderAsc = opts?.ascending ?? true;
        return chain;
      },
      limit(n: number) {
        _limit = n;
        return chain;
      },
      single() {
        _wantSingle = "single";
        return resolve();
      },
      maybeSingle() {
        _wantSingle = "maybeSingle";
        return resolve();
      },
      then(onF: any, onR?: any) {
        return resolve().then(onF, onR);
      },
    };

    function resolve(): Promise<{ data: any; error: any; count?: number }> {
      if (_hasError) return Promise.resolve({ data: null, error: { message: "fake_error" } });
      if (shouldFail()) {
        return Promise.resolve({
          data: null,
          error: { message: `fake_${action}_failed` },
        });
      }

      if (action === "insert") {
        const stamped = _insertRows.map((r) => ({
          id: r.id ?? newId(),
          created_at: r.created_at ?? new Date().toISOString(),
          ...r,
        }));
        tables[table].push(...stamped);
        inserts.push({ table, rows: stamped });
        const data =
          _wantSingle === "single" || _wantSingle === "maybeSingle"
            ? stamped[0] ?? null
            : stamped;
        return Promise.resolve({ data, error: null });
      }
      if (action === "upsert") {
        const stamped: Row[] = _upsertRows.map((r) => ({
          id: r.id ?? newId(),
          ...r,
        }));
        // Naive: replace by deal_id when present (good enough for these tests).
        for (const r of stamped) {
          const idx = tables[table].findIndex(
            (t: Row) => t.deal_id === r.deal_id,
          );
          if (idx >= 0) tables[table][idx] = { ...tables[table][idx], ...r };
          else tables[table].push(r);
        }
        upserts.push({ table, rows: stamped });
        return Promise.resolve({ data: stamped, error: null });
      }
      if (action === "update") {
        // Update the live store rows that pass the cumulative filter.
        const matching = rows;
        for (const r of matching) {
          const idx = tables[table].indexOf(r);
          if (idx >= 0) {
            tables[table][idx] = { ...tables[table][idx], ..._patch };
          }
        }
        updates.push({ table, patch: _patch ?? {}, filter: matching });
        return Promise.resolve({ data: matching, error: null });
      }

      // select
      let result = rows.slice();
      if (_orderKey) {
        result.sort((a, b) =>
          _orderAsc
            ? String(a[_orderKey!] ?? "") > String(b[_orderKey!] ?? "")
              ? 1
              : -1
            : String(a[_orderKey!] ?? "") < String(b[_orderKey!] ?? "")
              ? 1
              : -1,
        );
      }
      if (_limit != null) result = result.slice(0, _limit);
      const data =
        _wantSingle === "single"
          ? result[0] ?? null
          : _wantSingle === "maybeSingle"
            ? result[0] ?? null
            : result;
      return Promise.resolve({ data, error: null });
    }

    return chain;
  }

  const sb: any = {
    from: (t: string) => builder(t),
    rpc: async () => ({ data: null, error: null }),
  };

  return { sb, tables, inserts, updates, upserts };
}

// ─── Stub AI provider ───────────────────────────────────────────────────────

function stubProvider(grade: string = "B+"): AIProvider {
  const risk: RiskOutput = {
    grade,
    baseRateBps: 450,
    riskPremiumBps: 200,
    pricingExplain: [],
    factors: [],
  };
  const memo: MemoOutput = {
    sections: [
      { sectionKey: "executive_summary", title: "Executive", content: "ok", citations: [] },
      { sectionKey: "risk", title: "Risk", content: "ok", citations: [] },
    ],
  };
  return {
    generateRisk: async () => risk,
    generateMemo: async () => memo,
    chatAboutDeal: async () => ({ answer: "stub", citations: [], followups: [] }),
  };
}

// ─── Common deps factory ────────────────────────────────────────────────────

function makeDeps(opts: {
  fixtures?: FakeFixtures;
  reconcileStatus?: "CLEAN" | "FLAGS" | "CONFLICTS";
  grade?: string;
  failures?: FailureSpec[];
  /** Skip wiring cleanupStaleAnalysisRuns; default uses a no-op stub. */
  realCleanup?: boolean;
}): {
  deps: BankerAnalysisDeps;
  store: ReturnType<typeof fakeSupabase>;
  events: any[];
} {
  const store = fakeSupabase(opts.fixtures, opts.failures ?? []);
  const events: any[] = [];
  const deps: BankerAnalysisDeps = {
    sb: store.sb,
    computeEngine: async () => ({ snapshotId: "snap_test_1" }),
    reconcile: async (dealId: string) => ({
      dealId,
      checksRun: 1,
      checksPassed: 1,
      checksFailed: 0,
      checksSkipped: 0,
      hardFailures: [],
      softFlags: [],
      overallStatus: opts.reconcileStatus ?? "CLEAN",
      reconciledAt: new Date().toISOString(),
    }),
    provider: stubProvider(opts.grade),
    writeEvent: async (args) => {
      events.push(args);
      return { ok: true };
    },
    logPipelineLedger: async () => {},
    // Default cleanup stub — most tests don't care about reaping. Tests that
    // exercise the cleanup path opt in via realCleanup=true.
    cleanupStaleAnalysisRuns: opts.realCleanup
      ? undefined
      : async () => ({ reaped: [] }),
  };
  return { deps, store, events };
}

const DEAL = "deal_1";
const BANK = "bank_1";

const dealRow = (loan_amount: number | null = 250_000) => ({
  id: DEAL,
  bank_id: BANK,
  loan_amount,
});

const loanReqRow = (requested_amount: number | null = 250_000) => ({
  id: "lr_1",
  deal_id: DEAL,
  request_number: 1,
  requested_amount,
  product_type: "LINE_OF_CREDIT",
});

const readySpreadRow = () => ({
  id: "sp_1",
  deal_id: DEAL,
  bank_id: BANK,
  status: "ready",
});

// ─── Gates ──────────────────────────────────────────────────────────────────

test("pipeline blocks when loan request incomplete (no LR row, deals.loan_amount null)", async () => {
  const { deps, store } = makeDeps({
    fixtures: {
      deals: [dealRow(null)],
      deal_loan_requests: [],
      deal_spreads: [readySpreadRow()],
    },
  });

  const result = await runBankerAnalysisPipeline({
    dealId: DEAL,
    bankId: BANK,
    reason: "manual_run",
    _deps: deps,
  });

  assert.equal(result.status, "blocked");
  assert.deepEqual(result.blockers, ["LOAN_REQUEST_INCOMPLETE"]);
  // No analysis tables were written
  assert.equal(store.tables.risk_runs.length, 0);
  assert.equal(store.tables.memo_runs.length, 0);
  assert.equal(store.tables.deal_decisions.length, 0);
});

test("pipeline blocks when spreads not ready", async () => {
  const { deps, store } = makeDeps({
    fixtures: {
      deals: [dealRow()],
      deal_loan_requests: [loanReqRow()],
      deal_spreads: [], // none ready
    },
  });

  const result = await runBankerAnalysisPipeline({
    dealId: DEAL,
    bankId: BANK,
    reason: "spreads_ready",
    _deps: deps,
  });

  assert.equal(result.status, "blocked");
  assert.deepEqual(result.blockers, ["SPREADS_NOT_READY"]);
  assert.equal(store.tables.risk_runs.length, 0);
});

test("pipeline blocks on tenant mismatch", async () => {
  const { deps } = makeDeps({
    fixtures: {
      deals: [dealRow()],
      deal_loan_requests: [loanReqRow()],
      deal_spreads: [readySpreadRow()],
    },
  });

  const result = await runBankerAnalysisPipeline({
    dealId: DEAL,
    bankId: "wrong_bank",
    reason: "manual_run",
    _deps: deps,
  });

  assert.equal(result.status, "blocked");
  assert.deepEqual(result.blockers, ["TENANT_MISMATCH"]);
});

test("pipeline blocks on unknown deal", async () => {
  const { deps } = makeDeps({
    fixtures: { deals: [] },
  });
  const result = await runBankerAnalysisPipeline({
    dealId: "missing",
    bankId: BANK,
    reason: "manual_run",
    _deps: deps,
  });
  assert.equal(result.status, "blocked");
  assert.deepEqual(result.blockers, ["DEAL_NOT_FOUND"]);
});

// ─── Idempotency ────────────────────────────────────────────────────────────

test("pipeline blocks ALREADY_RUNNING when a recent risk_run is in flight", async () => {
  const recent = new Date().toISOString();
  const { deps, store } = makeDeps({
    fixtures: {
      deals: [dealRow()],
      deal_loan_requests: [loanReqRow()],
      deal_spreads: [readySpreadRow()],
      risk_runs: [
        { id: "rr_inflight", deal_id: DEAL, status: "running", created_at: recent },
      ],
    },
  });

  const result = await runBankerAnalysisPipeline({
    dealId: DEAL,
    bankId: BANK,
    reason: "spreads_ready",
    _deps: deps,
  });

  assert.equal(result.status, "blocked");
  assert.deepEqual(result.blockers, ["ALREADY_RUNNING"]);
  // No additional risk_runs row was opened
  assert.equal(store.tables.risk_runs.length, 1);
});

test("forceRun=true with stale running run is allowed (cleanup recovers, replay proceeds)", async () => {
  // Stale = older than 10 minutes AND model_name matches the pipeline.
  const stale = new Date(Date.now() - 11 * 60 * 1000).toISOString();
  const { deps, store } = makeDeps({
    fixtures: {
      deals: [dealRow()],
      deal_loan_requests: [loanReqRow()],
      deal_spreads: [readySpreadRow()],
      risk_runs: [
        {
          id: "rr_stale",
          deal_id: DEAL,
          status: "running",
          model_name: "banker_analysis_pipeline",
          created_at: stale,
        },
      ],
    },
    realCleanup: true,
  });
  const result = await runBankerAnalysisPipeline({
    dealId: DEAL,
    bankId: BANK,
    reason: "admin_replay",
    forceRun: true,
    _deps: deps,
  });
  assert.equal(result.status, "succeeded");
  // Cleanup flipped the stale row to failed
  const reaped = store.tables.risk_runs.find((r) => r.id === "rr_stale");
  assert.equal(reaped?.status, "failed");
  assert.equal(reaped?.error, "stale_running_timeout");
});

test("forceRun=true with FRESH running run is rejected when no stale recovery / no failed latest", async () => {
  const recent = new Date().toISOString();
  const { deps } = makeDeps({
    fixtures: {
      deals: [dealRow()],
      deal_loan_requests: [loanReqRow()],
      deal_spreads: [readySpreadRow()],
      risk_runs: [
        {
          id: "rr_fresh",
          deal_id: DEAL,
          status: "running",
          // No model_name — wouldn't qualify for cleanup either way.
          created_at: recent,
        },
      ],
    },
  });
  const result = await runBankerAnalysisPipeline({
    dealId: DEAL,
    bankId: BANK,
    reason: "admin_replay",
    forceRun: true,
    _deps: deps,
  });
  assert.equal(result.status, "blocked");
  assert.deepEqual(result.blockers, ["ALREADY_RUNNING"]);
});

test("forceRun=true with FRESH running but latest run failed is allowed", async () => {
  // Two rows: latest is failed (newest), older one is still running.
  // Replay should proceed because the latest terminal state is `failed`.
  const newest = new Date(Date.now() - 1_000).toISOString();
  const older = new Date(Date.now() - 30_000).toISOString();
  const { deps } = makeDeps({
    fixtures: {
      deals: [dealRow()],
      deal_loan_requests: [loanReqRow()],
      deal_spreads: [readySpreadRow()],
      risk_runs: [
        { id: "rr_fail", deal_id: DEAL, status: "failed", created_at: newest },
        {
          id: "rr_running",
          deal_id: DEAL,
          status: "running",
          created_at: older,
        },
      ],
    },
  });
  const result = await runBankerAnalysisPipeline({
    dealId: DEAL,
    bankId: BANK,
    reason: "admin_replay",
    forceRun: true,
    _deps: deps,
  });
  assert.equal(result.status, "succeeded");
});

// ─── Happy path: writes everything when CLEAN ───────────────────────────────

test("pipeline writes model snapshot, risk run, memo run, decision when CLEAN", async () => {
  const { deps, store } = makeDeps({
    fixtures: {
      deals: [dealRow()],
      deal_loan_requests: [loanReqRow()],
      deal_spreads: [readySpreadRow()],
    },
    reconcileStatus: "CLEAN",
    grade: "B+",
  });

  const result = await runBankerAnalysisPipeline({
    dealId: DEAL,
    bankId: BANK,
    reason: "spreads_ready",
    _deps: deps,
  });

  assert.equal(result.status, "succeeded");
  assert.deepEqual(result.blockers, []);
  assert.equal(result.ids.snapshotId, "snap_test_1");

  // risk_runs opened then completed
  const completedRiskRun = store.tables.risk_runs.find(
    (r) => r.status === "completed",
  );
  assert.ok(completedRiskRun, "risk_runs row must end in completed");
  assert.equal(result.ids.riskRunId, completedRiskRun!.id);

  // ai_risk_runs row written
  assert.equal(store.tables.ai_risk_runs.length, 1);
  assert.equal(store.tables.ai_risk_runs[0].grade, "B+");

  // memo_runs row written + memo_sections
  assert.equal(store.tables.memo_runs.length, 1);
  assert.equal(store.tables.memo_runs[0].status, "completed");
  assert.ok(store.tables.memo_sections.length >= 1);

  // deal_decisions row written
  assert.equal(store.tables.deal_decisions.length, 1);
  assert.equal(store.tables.deal_decisions[0].decision, "conditional_approval");
  assert.equal(store.tables.deal_decisions[0].reconciliation_status, "CLEAN");

  // committee-ready signal
  assert.equal(result.ids.committeeReady, true);
  const cr = store.tables.deal_credit_memo_status.find((r) => r.deal_id === DEAL);
  assert.ok(cr);
  assert.equal(cr!.current_status, "ready_for_committee");
});

// ─── Reconciliation gate ────────────────────────────────────────────────────

test("pipeline writes everything but does NOT mark committee-ready when FLAGS", async () => {
  const { deps, store } = makeDeps({
    fixtures: {
      deals: [dealRow()],
      deal_loan_requests: [loanReqRow()],
      deal_spreads: [readySpreadRow()],
    },
    reconcileStatus: "FLAGS",
    grade: "B",
  });

  const result = await runBankerAnalysisPipeline({
    dealId: DEAL,
    bankId: BANK,
    reason: "spreads_ready",
    _deps: deps,
  });

  assert.equal(result.status, "blocked");
  assert.deepEqual(result.blockers, ["RECONCILIATION_FLAGS"]);
  assert.equal(result.ids.committeeReady, false);

  // Snapshot + risk + memo + decision were still written — only committee-ready is gated
  assert.ok(result.ids.snapshotId);
  assert.equal(store.tables.ai_risk_runs.length, 1);
  assert.equal(store.tables.memo_runs.length, 1);
  assert.equal(store.tables.deal_decisions.length, 1);

  // No committee-ready row
  assert.equal(store.tables.deal_credit_memo_status.length, 0);
});

test("pipeline blocks committee-ready on CONFLICTS", async () => {
  const { deps, store } = makeDeps({
    fixtures: {
      deals: [dealRow()],
      deal_loan_requests: [loanReqRow()],
      deal_spreads: [readySpreadRow()],
    },
    reconcileStatus: "CONFLICTS",
  });
  const result = await runBankerAnalysisPipeline({
    dealId: DEAL,
    bankId: BANK,
    reason: "spreads_ready",
    _deps: deps,
  });
  assert.equal(result.status, "blocked");
  assert.deepEqual(result.blockers, ["RECONCILIATION_CONFLICTS"]);
  assert.equal(result.ids.committeeReady, false);
  assert.equal(store.tables.deal_credit_memo_status.length, 0);
});

// ─── Result shape never has reconciliation_status null after a run ──────────

test("reconciliation_status is never null in the result after pipeline executes past gates", async () => {
  for (const recon of ["CLEAN", "FLAGS", "CONFLICTS"] as const) {
    const { deps } = makeDeps({
      fixtures: {
        deals: [dealRow()],
        deal_loan_requests: [loanReqRow()],
        deal_spreads: [readySpreadRow()],
      },
      reconcileStatus: recon,
    });
    const r = await runBankerAnalysisPipeline({
      dealId: DEAL,
      bankId: BANK,
      reason: "spreads_ready",
      _deps: deps,
    });
    assert.equal(r.ids.reconciliationStatus, recon, `recon=${recon}`);
  }
});

// ─── Strict success: write-failure paths block the pipeline ────────────────

test("pipeline returns MEMO_SECTION_WRITE_FAILED when memo_sections insert fails", async () => {
  const { deps, store } = makeDeps({
    fixtures: {
      deals: [dealRow()],
      deal_loan_requests: [loanReqRow()],
      deal_spreads: [readySpreadRow()],
    },
    reconcileStatus: "CLEAN",
    grade: "B+",
    failures: [{ table: "memo_sections", op: "insert" }],
  });

  const result = await runBankerAnalysisPipeline({
    dealId: DEAL,
    bankId: BANK,
    reason: "spreads_ready",
    _deps: deps,
  });

  assert.equal(result.status, "blocked");
  assert.deepEqual(result.blockers, ["MEMO_SECTION_WRITE_FAILED"]);

  // memo_run was opened, then flipped to failed
  assert.equal(store.tables.memo_runs.length, 1);
  assert.equal(store.tables.memo_runs[0].status, "failed");

  // No decision was written, no committee-ready
  assert.equal(store.tables.deal_decisions.length, 0);
  assert.equal(store.tables.deal_credit_memo_status.length, 0);
});

test("pipeline returns DECISION_WRITE_FAILED when deal_decisions insert fails", async () => {
  const { deps, store } = makeDeps({
    fixtures: {
      deals: [dealRow()],
      deal_loan_requests: [loanReqRow()],
      deal_spreads: [readySpreadRow()],
    },
    reconcileStatus: "CLEAN",
    grade: "B+",
    failures: [{ table: "deal_decisions", op: "insert" }],
  });

  const result = await runBankerAnalysisPipeline({
    dealId: DEAL,
    bankId: BANK,
    reason: "spreads_ready",
    _deps: deps,
  });

  assert.equal(result.status, "blocked");
  assert.deepEqual(result.blockers, ["DECISION_WRITE_FAILED"]);

  // memo_run + sections did write, but decision did not
  assert.equal(store.tables.memo_runs.length, 1);
  assert.ok(store.tables.memo_sections.length >= 1);
  assert.equal(store.tables.deal_decisions.length, 0);
  // Committee-ready not set — pipeline never reached that gate
  assert.equal(store.tables.deal_credit_memo_status.length, 0);
});

test("pipeline returns COMMITTEE_READY_WRITE_FAILED when committee-ready upsert fails", async () => {
  const { deps, store } = makeDeps({
    fixtures: {
      deals: [dealRow()],
      deal_loan_requests: [loanReqRow()],
      deal_spreads: [readySpreadRow()],
    },
    reconcileStatus: "CLEAN",
    grade: "B+",
    failures: [{ table: "deal_credit_memo_status", op: "upsert" }],
  });

  const result = await runBankerAnalysisPipeline({
    dealId: DEAL,
    bankId: BANK,
    reason: "spreads_ready",
    _deps: deps,
  });

  assert.equal(result.status, "blocked");
  assert.deepEqual(result.blockers, ["COMMITTEE_READY_WRITE_FAILED"]);

  // Decision was written; committee-ready was attempted but rejected
  assert.equal(store.tables.deal_decisions.length, 1);
  assert.equal(store.tables.deal_credit_memo_status.length, 0);
});

// ─── Stale-run recovery emits an event ─────────────────────────────────────

test("stale running risk_run is marked failed and emits stale_run_recovered", async () => {
  const stale = new Date(Date.now() - 11 * 60 * 1000).toISOString();
  const { deps, store, events } = makeDeps({
    fixtures: {
      deals: [dealRow()],
      deal_loan_requests: [loanReqRow()],
      deal_spreads: [readySpreadRow()],
      risk_runs: [
        {
          id: "rr_stale",
          deal_id: DEAL,
          status: "running",
          model_name: "banker_analysis_pipeline",
          created_at: stale,
        },
      ],
    },
    realCleanup: true,
  });

  const result = await runBankerAnalysisPipeline({
    dealId: DEAL,
    bankId: BANK,
    reason: "spreads_ready",
    _deps: deps,
  });

  assert.equal(result.status, "succeeded");
  const reaped = store.tables.risk_runs.find((r) => r.id === "rr_stale");
  assert.equal(reaped?.status, "failed");
  assert.equal(reaped?.error, "stale_running_timeout");

  const recovery = events.find(
    (e) => e.kind === "banker_analysis.stale_run_recovered",
  );
  assert.ok(recovery, "expected a banker_analysis.stale_run_recovered event");
  assert.equal((recovery as any).meta.risk_run_id, "rr_stale");
});

// ─── Strict success: ai_risk_runs + marker-update failures ─────────────────

test("pipeline returns AI_RISK_RUN_WRITE_FAILED when ai_risk_runs insert fails", async () => {
  const { deps, store } = makeDeps({
    fixtures: {
      deals: [dealRow()],
      deal_loan_requests: [loanReqRow()],
      deal_spreads: [readySpreadRow()],
    },
    reconcileStatus: "CLEAN",
    grade: "B+",
    failures: [{ table: "ai_risk_runs", op: "insert" }],
  });

  const result = await runBankerAnalysisPipeline({
    dealId: DEAL,
    bankId: BANK,
    reason: "spreads_ready",
    _deps: deps,
  });

  assert.equal(result.status, "blocked");
  assert.deepEqual(result.blockers, ["AI_RISK_RUN_WRITE_FAILED"]);

  // risk_runs marker was opened then flipped to failed
  const failedRiskRun = store.tables.risk_runs.find(
    (r) => r.status === "failed",
  );
  assert.ok(failedRiskRun, "risk_runs marker should be flipped to failed");
  // No ai_risk_runs row landed
  assert.equal(store.tables.ai_risk_runs.length, 0);
  // Memo + decision never reached
  assert.equal(store.tables.memo_runs.length, 0);
  assert.equal(store.tables.deal_decisions.length, 0);
});

test("pipeline returns RISK_RUN_MARKER_UPDATE_FAILED when risk_runs completion update fails", async () => {
  // Failure injection on `update` table=risk_runs causes ALL risk_runs
  // updates to fail — both the completion update (the one we care about)
  // and the failRiskRunMarker call that follows. The pipeline must still
  // surface RISK_RUN_MARKER_UPDATE_FAILED, not return succeeded.
  const { deps, store } = makeDeps({
    fixtures: {
      deals: [dealRow()],
      deal_loan_requests: [loanReqRow()],
      deal_spreads: [readySpreadRow()],
    },
    reconcileStatus: "CLEAN",
    grade: "B+",
    failures: [{ table: "risk_runs", op: "update" }],
  });

  const result = await runBankerAnalysisPipeline({
    dealId: DEAL,
    bankId: BANK,
    reason: "spreads_ready",
    _deps: deps,
  });

  assert.equal(result.status, "blocked");
  assert.deepEqual(result.blockers, ["RISK_RUN_MARKER_UPDATE_FAILED"]);
  // ai_risk_runs DID succeed before the marker update was attempted
  assert.equal(store.tables.ai_risk_runs.length, 1);
  // Memo + decision never reached
  assert.equal(store.tables.memo_runs.length, 0);
  assert.equal(store.tables.deal_decisions.length, 0);
});

test("pipeline returns MEMO_RUN_MARKER_UPDATE_FAILED when memo_runs completion update fails", async () => {
  const { deps, store } = makeDeps({
    fixtures: {
      deals: [dealRow()],
      deal_loan_requests: [loanReqRow()],
      deal_spreads: [readySpreadRow()],
    },
    reconcileStatus: "CLEAN",
    grade: "B+",
    failures: [{ table: "memo_runs", op: "update" }],
  });

  const result = await runBankerAnalysisPipeline({
    dealId: DEAL,
    bankId: BANK,
    reason: "spreads_ready",
    _deps: deps,
  });

  assert.equal(result.status, "blocked");
  assert.deepEqual(result.blockers, ["MEMO_RUN_MARKER_UPDATE_FAILED"]);
  // memo_sections did write
  assert.ok(store.tables.memo_sections.length >= 1);
  // No decision row
  assert.equal(store.tables.deal_decisions.length, 0);
});
