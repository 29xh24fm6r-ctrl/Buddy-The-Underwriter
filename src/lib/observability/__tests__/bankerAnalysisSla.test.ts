/**
 * Tests for the banker-analysis SLA aggregator.
 *
 * Exercises the pure aggregation against synthetic inputs — no DB. Covers:
 *  - latency p50/p95 from risk_runs ↔ ledger join
 *  - failure grouping by blocker code
 *  - stale-recovery counting
 *  - retry effectiveness (failed → completed within 1h)
 *  - SLA verdict per metric (ok / breach / no_data)
 *  - alert firing thresholds (10-min look-back)
 *  - empty dataset handling
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  aggregateBankerAnalysisSla,
  computePercentile,
  computeSlaVerdicts,
  computeAlerts,
  SLA_THRESHOLDS,
  ALERT_LIMITS,
  type RiskRunRow,
  type LedgerCompletionRow,
  type EventRow,
} from "../bankerAnalysisSla";

// ─── computePercentile ─────────────────────────────────────────────────────

test("computePercentile: empty input returns null", () => {
  assert.equal(computePercentile([], 0.5), null);
  assert.equal(computePercentile([], 0.95), null);
});

test("computePercentile: single value returns that value at any p", () => {
  assert.equal(computePercentile([42], 0.5), 42);
  assert.equal(computePercentile([42], 0.95), 42);
});

test("computePercentile: matches expected values for known input", () => {
  // [1,2,3,4,5,6,7,8,9,10] — p50 should be 5.5, p95 should be 9.55
  const v = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  assert.equal(computePercentile(v, 0.5), 5.5);
  assert.ok(Math.abs((computePercentile(v, 0.95) ?? 0) - 9.55) < 1e-9);
});

test("computePercentile: handles unsorted input", () => {
  const v = [10, 1, 5, 3, 7];
  assert.equal(computePercentile(v, 0.5), 5);
});

// ─── aggregator: empty dataset ─────────────────────────────────────────────

test("aggregator: empty inputs return safe nulls and zero counts", () => {
  const r = aggregateBankerAnalysisSla({
    windowHours: 24,
    now: new Date(),
    riskRuns: [],
    ledgerCompletions: [],
    events: [],
  });
  assert.equal(r.runVolume, 0);
  assert.equal(r.latency.sampleCount, 0);
  assert.equal(r.latency.p50Seconds, null);
  assert.equal(r.latency.p95Seconds, null);
  assert.equal(r.failures.total, 0);
  assert.deepEqual(r.failures.byCode, []);
  assert.equal(r.staleRecoveries, 0);
  assert.equal(r.retry.failedRunsInWindow, 0);
  assert.equal(r.retry.recoveredDeals, 0);
  assert.equal(r.retry.successRate, null);
  // SLA verdicts surface no_data where appropriate
  assert.equal(r.sla.latencyP95, "no_data");
  assert.equal(r.sla.writeFailureRate, "no_data");
  assert.equal(r.sla.retrySuccessRate, "no_data");
  assert.equal(r.sla.staleRecoveryRate, "ok");
  assert.deepEqual(r.alerts, []);
});

// ─── aggregator: latency join ──────────────────────────────────────────────

test("aggregator: pairs risk_runs ↔ ledger by risk_run_id and computes seconds", () => {
  const t0 = new Date("2026-05-04T12:00:00Z").getTime();
  const riskRuns: RiskRunRow[] = [
    { id: "r1", deal_id: "d1", status: "completed", created_at: new Date(t0).toISOString() },
    { id: "r2", deal_id: "d2", status: "completed", created_at: new Date(t0 + 1_000).toISOString() },
    { id: "r3", deal_id: "d3", status: "completed", created_at: new Date(t0 + 2_000).toISOString() },
  ];
  const ledgerCompletions: LedgerCompletionRow[] = [
    { risk_run_id: "r1", created_at: new Date(t0 + 5_000).toISOString() },   // 5s
    { risk_run_id: "r2", created_at: new Date(t0 + 1_000 + 15_000).toISOString() }, // 15s
    { risk_run_id: "r3", created_at: new Date(t0 + 2_000 + 45_000).toISOString() }, // 45s
  ];
  const r = aggregateBankerAnalysisSla({
    windowHours: 24,
    now: new Date(t0 + 60_000),
    riskRuns,
    ledgerCompletions,
    events: [],
  });
  assert.equal(r.latency.sampleCount, 3);
  assert.equal(r.latency.p50Seconds, 15);
  // p95 of [5,15,45] with 0.95*(n-1)=1.9 → linear interp: 15*(1-0.9)+45*0.9=42
  assert.ok(Math.abs((r.latency.p95Seconds ?? 0) - 42) < 1e-6);
});

test("aggregator: ignores risk_runs with no matching ledger row", () => {
  const t0 = new Date("2026-05-04T12:00:00Z").getTime();
  const riskRuns: RiskRunRow[] = [
    { id: "r1", deal_id: "d1", status: "completed", created_at: new Date(t0).toISOString() },
    { id: "r2", deal_id: "d2", status: "completed", created_at: new Date(t0).toISOString() },
  ];
  const ledgerCompletions: LedgerCompletionRow[] = [
    { risk_run_id: "r1", created_at: new Date(t0 + 10_000).toISOString() },
  ];
  const r = aggregateBankerAnalysisSla({
    windowHours: 24,
    now: new Date(t0 + 60_000),
    riskRuns,
    ledgerCompletions,
    events: [],
  });
  assert.equal(r.latency.sampleCount, 1);
  assert.equal(r.latency.p50Seconds, 10);
});

test("aggregator: ignores non-completed risk_runs in latency calc", () => {
  const t0 = new Date("2026-05-04T12:00:00Z").getTime();
  const riskRuns: RiskRunRow[] = [
    { id: "r1", deal_id: "d1", status: "running", created_at: new Date(t0).toISOString() },
    { id: "r2", deal_id: "d2", status: "failed", created_at: new Date(t0).toISOString() },
  ];
  const ledgerCompletions: LedgerCompletionRow[] = [
    { risk_run_id: "r1", created_at: new Date(t0 + 5_000).toISOString() },
    { risk_run_id: "r2", created_at: new Date(t0 + 5_000).toISOString() },
  ];
  const r = aggregateBankerAnalysisSla({
    windowHours: 24,
    now: new Date(t0 + 60_000),
    riskRuns,
    ledgerCompletions,
    events: [],
  });
  assert.equal(r.latency.sampleCount, 0);
});

// ─── aggregator: failure grouping ──────────────────────────────────────────

test("aggregator: groups write_failed by blocker code, sorted by count desc", () => {
  const now = new Date();
  const events: EventRow[] = [
    {
      kind: "banker_analysis.write_failed",
      created_at: now.toISOString(),
      blocker: "MEMO_SECTION_WRITE_FAILED",
    },
    {
      kind: "banker_analysis.write_failed",
      created_at: now.toISOString(),
      blocker: "MEMO_SECTION_WRITE_FAILED",
    },
    {
      kind: "banker_analysis.write_failed",
      created_at: now.toISOString(),
      blocker: "DECISION_WRITE_FAILED",
    },
    {
      kind: "banker_analysis.write_failed",
      created_at: now.toISOString(),
      blocker: "RISK_RUN_MARKER_UPDATE_FAILED",
    },
    {
      kind: "banker_analysis.write_failed",
      created_at: now.toISOString(),
      blocker: null, // surfaces as UNKNOWN
    },
  ];
  const r = aggregateBankerAnalysisSla({
    windowHours: 24,
    now,
    riskRuns: [],
    ledgerCompletions: [],
    events,
  });
  assert.equal(r.failures.total, 5);
  assert.deepEqual(r.failures.byCode, [
    { code: "MEMO_SECTION_WRITE_FAILED", count: 2 },
    { code: "DECISION_WRITE_FAILED", count: 1 },
    { code: "RISK_RUN_MARKER_UPDATE_FAILED", count: 1 },
    { code: "UNKNOWN", count: 1 },
  ]);
});

// ─── aggregator: stale recovery ────────────────────────────────────────────

test("aggregator: counts stale_run_recovered events", () => {
  const now = new Date();
  const events: EventRow[] = [
    {
      kind: "banker_analysis.stale_run_recovered",
      created_at: now.toISOString(),
      blocker: null,
    },
    {
      kind: "banker_analysis.stale_run_recovered",
      created_at: now.toISOString(),
      blocker: null,
    },
  ];
  const r = aggregateBankerAnalysisSla({
    windowHours: 24,
    now,
    riskRuns: [],
    ledgerCompletions: [],
    events,
  });
  assert.equal(r.staleRecoveries, 2);
  assert.equal(r.sla.staleRecoveryRate, "breach");
});

// ─── aggregator: retry effectiveness ───────────────────────────────────────

test("aggregator: counts a deal as recovered when failed → completed within 1h", () => {
  const t0 = new Date("2026-05-04T12:00:00Z").getTime();
  const r = aggregateBankerAnalysisSla({
    windowHours: 24,
    now: new Date(t0 + 60 * 60 * 1000),
    riskRuns: [
      // Deal 1: failed then completed within 1h → recovered
      { id: "r1", deal_id: "d1", status: "failed", created_at: new Date(t0).toISOString() },
      { id: "r2", deal_id: "d1", status: "completed", created_at: new Date(t0 + 30 * 60 * 1000).toISOString() },
      // Deal 2: failed, no recovery within 1h
      { id: "r3", deal_id: "d2", status: "failed", created_at: new Date(t0).toISOString() },
      // Deal 3: completed only (not counted as failed)
      { id: "r4", deal_id: "d3", status: "completed", created_at: new Date(t0).toISOString() },
    ],
    ledgerCompletions: [],
    events: [],
  });
  assert.equal(r.retry.failedRunsInWindow, 2);
  assert.equal(r.retry.recoveredDeals, 1);
  assert.equal(r.retry.successRate, 0.5);
});

test("aggregator: a recovery >1h after failure does NOT count", () => {
  const t0 = new Date("2026-05-04T12:00:00Z").getTime();
  const r = aggregateBankerAnalysisSla({
    windowHours: 24,
    now: new Date(t0 + 4 * 60 * 60 * 1000),
    riskRuns: [
      { id: "r1", deal_id: "d1", status: "failed", created_at: new Date(t0).toISOString() },
      // 2h later → outside the 1h window
      { id: "r2", deal_id: "d1", status: "completed", created_at: new Date(t0 + 2 * 60 * 60 * 1000).toISOString() },
    ],
    ledgerCompletions: [],
    events: [],
  });
  assert.equal(r.retry.failedRunsInWindow, 1);
  assert.equal(r.retry.recoveredDeals, 0);
  assert.equal(r.retry.successRate, 0);
});

// ─── aggregator: run volume ────────────────────────────────────────────────

test("aggregator: runVolume is total risk_runs in window regardless of status", () => {
  const now = new Date();
  const r = aggregateBankerAnalysisSla({
    windowHours: 24,
    now,
    riskRuns: [
      { id: "a", deal_id: "d1", status: "completed", created_at: now.toISOString() },
      { id: "b", deal_id: "d2", status: "failed", created_at: now.toISOString() },
      { id: "c", deal_id: "d3", status: "running", created_at: now.toISOString() },
    ],
    ledgerCompletions: [],
    events: [],
  });
  assert.equal(r.runVolume, 3);
});

// ─── computeSlaVerdicts ────────────────────────────────────────────────────

test("SLA verdict: latency p95 above threshold = breach", () => {
  const v = computeSlaVerdicts({
    latency: { p50Seconds: 5, p95Seconds: SLA_THRESHOLDS.latencyP95Seconds + 1, sampleCount: 10 },
    failures: { total: 0, byCode: [] },
    staleRecoveries: 0,
    retry: { failedRunsInWindow: 0, recoveredDeals: 0, successRate: null },
    runVolume: 10,
  });
  assert.equal(v.latencyP95, "breach");
});

test("SLA verdict: write failure rate above 1% = breach", () => {
  const v = computeSlaVerdicts({
    latency: { p50Seconds: null, p95Seconds: null, sampleCount: 0 },
    failures: { total: 2, byCode: [] },
    staleRecoveries: 0,
    retry: { failedRunsInWindow: 0, recoveredDeals: 0, successRate: null },
    runVolume: 100, // 2/100 = 2% > 1% threshold
  });
  assert.equal(v.writeFailureRate, "breach");
});

test("SLA verdict: write failure rate at exactly 1% is ok (threshold is strict >)", () => {
  const v = computeSlaVerdicts({
    latency: { p50Seconds: null, p95Seconds: null, sampleCount: 0 },
    failures: { total: 1, byCode: [] },
    staleRecoveries: 0,
    retry: { failedRunsInWindow: 0, recoveredDeals: 0, successRate: null },
    runVolume: 100,
  });
  assert.equal(v.writeFailureRate, "ok");
});

test("SLA verdict: retry success rate < 90% = breach", () => {
  const v = computeSlaVerdicts({
    latency: { p50Seconds: null, p95Seconds: null, sampleCount: 0 },
    failures: { total: 0, byCode: [] },
    staleRecoveries: 0,
    retry: { failedRunsInWindow: 10, recoveredDeals: 8, successRate: 0.8 },
    runVolume: 10,
  });
  assert.equal(v.retrySuccessRate, "breach");
});

test("SLA verdict: stale recovery > 0 = breach", () => {
  const v = computeSlaVerdicts({
    latency: { p50Seconds: null, p95Seconds: null, sampleCount: 0 },
    failures: { total: 0, byCode: [] },
    staleRecoveries: 1,
    retry: { failedRunsInWindow: 0, recoveredDeals: 0, successRate: null },
    runVolume: 0,
  });
  assert.equal(v.staleRecoveryRate, "breach");
});

// ─── computeAlerts ─────────────────────────────────────────────────────────

test("alerts: latency_breach fires when window p95 > target", () => {
  const alerts = computeAlerts({
    now: new Date(),
    events: [],
    riskRuns: [],
    latencyP95: SLA_THRESHOLDS.latencyP95Seconds + 5,
  });
  assert.ok(alerts.find((a) => a.id === "latency_breach"));
});

test("alerts: write_failures_spike fires when > 5 write_failed in last 10 min", () => {
  const now = new Date();
  const recent = new Date(now.getTime() - 60 * 1000).toISOString(); // 1 min ago
  const events: EventRow[] = Array.from({ length: 6 }, () => ({
    kind: "banker_analysis.write_failed",
    created_at: recent,
    blocker: "MEMO_SECTION_WRITE_FAILED",
  }));
  const alerts = computeAlerts({
    now,
    events,
    riskRuns: [],
    latencyP95: null,
  });
  assert.ok(alerts.find((a) => a.id === "write_failures_spike"));
});

test("alerts: write_failures_spike does NOT fire for failures older than 10 min", () => {
  const now = new Date();
  const old = new Date(now.getTime() - 20 * 60 * 1000).toISOString();
  const events: EventRow[] = Array.from({ length: 10 }, () => ({
    kind: "banker_analysis.write_failed",
    created_at: old,
    blocker: "X",
  }));
  const alerts = computeAlerts({
    now,
    events,
    riskRuns: [],
    latencyP95: null,
  });
  assert.equal(alerts.find((a) => a.id === "write_failures_spike"), undefined);
});

test("alerts: stale_recovery_recent fires for any stale recovery in last 10 min", () => {
  const now = new Date();
  const alerts = computeAlerts({
    now,
    events: [
      {
        kind: "banker_analysis.stale_run_recovered",
        created_at: new Date(now.getTime() - 60_000).toISOString(),
        blocker: null,
      },
    ],
    riskRuns: [],
    latencyP95: null,
  });
  assert.ok(alerts.find((a) => a.id === "stale_recovery_recent"));
});

test("alerts: retry_loop_suspected fires when same deal fails > 3 times in 10 min", () => {
  const now = new Date();
  const recent = new Date(now.getTime() - 60_000).toISOString();
  const riskRuns: RiskRunRow[] = Array.from({ length: 4 }, (_, i) => ({
    id: `r${i}`,
    deal_id: "d-loopy",
    status: "failed",
    created_at: recent,
  }));
  const alerts = computeAlerts({
    now,
    events: [],
    riskRuns,
    latencyP95: null,
  });
  const loop = alerts.find((a) => a.id === "retry_loop_suspected");
  assert.ok(loop);
  assert.match(loop!.message, /d-loopy/);
});

test("alerts: retry_loop_suspected does NOT fire below threshold", () => {
  const now = new Date();
  const recent = new Date(now.getTime() - 60_000).toISOString();
  const riskRuns: RiskRunRow[] = Array.from(
    { length: ALERT_LIMITS.retryLoopFailuresPerDealIn10Min },
    (_, i) => ({
      id: `r${i}`,
      deal_id: "d-ok",
      status: "failed",
      created_at: recent,
    }),
  );
  const alerts = computeAlerts({
    now,
    events: [],
    riskRuns,
    latencyP95: null,
  });
  assert.equal(alerts.find((a) => a.id === "retry_loop_suspected"), undefined);
});

// ─── End-to-end response shape ─────────────────────────────────────────────

test("response shape: includes all top-level keys", () => {
  const r = aggregateBankerAnalysisSla({
    windowHours: 24,
    now: new Date(),
    riskRuns: [],
    ledgerCompletions: [],
    events: [],
  });
  for (const key of [
    "ok",
    "windowHours",
    "generatedAt",
    "latency",
    "failures",
    "staleRecoveries",
    "retry",
    "runVolume",
    "sla",
    "alerts",
  ]) {
    assert.ok(key in r, `missing key ${key}`);
  }
  assert.equal(r.ok, true);
  assert.equal(r.windowHours, 24);
});
