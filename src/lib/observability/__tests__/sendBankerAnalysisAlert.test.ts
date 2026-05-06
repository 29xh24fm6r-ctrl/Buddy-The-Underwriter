/**
 * Tests for sendBankerAnalysisAlert.
 *
 * Inline fake Supabase: supports the specific query shapes the alert sender
 * uses — gte('created_at', cutoff) + eq('payload->>kind', ...) +
 * eq('payload->>alert_id', ...) + limit(1) for dedupe, and insert for the
 * alert-sent record. Keeps the test self-contained.
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  sendBankerAnalysisAlert,
  COOLDOWN_MINUTES,
  ALERT_SENT_KIND,
} from "../sendBankerAnalysisAlert";
import type { SlaAlert, BankerAnalysisSlaResponse } from "../bankerAnalysisSla";

// ─── Inline fake supabase ──────────────────────────────────────────────────

type Row = Record<string, any>;

function fakeSb(initial: Row[] = []) {
  const buddy: Row[] = initial.slice();
  const inserts: Row[] = [];

  function builder() {
    let action: "select" | "insert" = "select";
    let _insertRow: Row | null = null;
    const filters: Array<(r: Row) => boolean> = [];
    let _limit = Infinity;

    const chain: any = {
      select() {
        return chain;
      },
      insert(row: Row) {
        action = "insert";
        _insertRow = row;
        return chain;
      },
      gte(col: string, val: string) {
        filters.push((r) => String(r[col] ?? "") >= val);
        return chain;
      },
      eq(col: string, val: any) {
        if (col.startsWith("payload->>")) {
          const key = col.slice("payload->>".length);
          filters.push((r) => (r.payload ?? {})[key] === val);
        } else {
          filters.push((r) => r[col] === val);
        }
        return chain;
      },
      limit(n: number) {
        _limit = n;
        return chain;
      },
      then(onF: any, onR?: any) {
        return resolve().then(onF, onR);
      },
    };

    function resolve() {
      if (action === "insert" && _insertRow) {
        const stamped = {
          id: `id_${Math.random().toString(36).slice(2, 12)}`,
          created_at: new Date().toISOString(),
          ..._insertRow,
        };
        buddy.push(stamped);
        inserts.push(stamped);
        return Promise.resolve({ data: stamped, error: null });
      }
      const matched = buddy.filter((r) => filters.every((f) => f(r)));
      const slice = matched.slice(0, _limit);
      return Promise.resolve({ data: slice, error: null });
    }

    return chain;
  }

  return {
    sb: { from: () => builder() } as any,
    inserts,
    rows: buddy,
  };
}

// ─── Fixtures ───────────────────────────────────────────────────────────────

const ALERT: SlaAlert = {
  id: "latency_breach",
  severity: "warning",
  message: "p95 45s exceeds 30s",
};

const METRICS: BankerAnalysisSlaResponse = {
  ok: true,
  windowHours: 24,
  generatedAt: "2026-05-04T12:00:00Z",
  latency: { p50Seconds: 12, p95Seconds: 45, sampleCount: 50 },
  failures: { total: 1, byCode: [{ code: "MEMO_SECTION_WRITE_FAILED", count: 1 }] },
  staleRecoveries: 0,
  retry: { failedRunsInWindow: 1, recoveredDeals: 1, successRate: 1 },
  runVolume: 50,
  sla: {
    latencyP95: "breach",
    writeFailureRate: "ok",
    staleRecoveryRate: "ok",
    retrySuccessRate: "ok",
  },
  alerts: [ALERT],
};

function fakeFetch(opts: { ok?: boolean; status?: number } = {}) {
  const calls: Array<{ url: string; body: any }> = [];
  const fn = (async (url: any, init?: any) => {
    calls.push({
      url: String(url),
      body: init?.body ? JSON.parse(String(init.body)) : null,
    });
    return {
      ok: opts.ok !== false,
      status: opts.status ?? 200,
    } as any;
  }) as unknown as typeof fetch;
  return { fn, calls };
}

// ─── Tests ──────────────────────────────────────────────────────────────────

test("missing SLACK_WEBHOOK_URL → alert_not_configured (no throw)", async () => {
  const { sb } = fakeSb();
  const { fn } = fakeFetch();
  const r = await sendBankerAnalysisAlert({
    alert: ALERT,
    metricsSummary: METRICS,
    _deps: { sb, fetchImpl: fn, webhookUrl: null },
  });
  assert.equal(r.sent, false);
  assert.equal(r.reason, "alert_not_configured");
});

test("happy path → posts to Slack and writes dedupe row", async () => {
  const { sb, inserts } = fakeSb();
  const { fn, calls } = fakeFetch();
  const r = await sendBankerAnalysisAlert({
    alert: ALERT,
    metricsSummary: METRICS,
    _deps: { sb, fetchImpl: fn, webhookUrl: "https://hooks.slack.test/abc" },
  });
  assert.equal(r.sent, true);
  assert.equal(r.reason, "ok");

  // Slack call
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://hooks.slack.test/abc");
  assert.match(calls[0].body.text, /latency_breach/);

  // Dedupe row written
  assert.equal(inserts.length, 1);
  const row = inserts[0];
  assert.equal(row.payload.kind, ALERT_SENT_KIND);
  assert.equal(row.payload.alert_id, ALERT.id);
  assert.equal(row.payload.severity, ALERT.severity);
  assert.equal(row.payload.window_hours, METRICS.windowHours);
});

test("cooldown: existing alert-sent row within 30min → skip send, no Slack call", async () => {
  const now = new Date();
  const recentSentAt = new Date(now.getTime() - 5 * 60 * 1000).toISOString();
  const { sb, inserts } = fakeSb([
    {
      id: "prior",
      created_at: recentSentAt,
      payload: {
        kind: ALERT_SENT_KIND,
        alert_id: ALERT.id,
      },
    },
  ]);
  const { fn, calls } = fakeFetch();
  const r = await sendBankerAnalysisAlert({
    alert: ALERT,
    metricsSummary: METRICS,
    _deps: {
      sb,
      fetchImpl: fn,
      webhookUrl: "https://hooks.slack.test/abc",
      now,
    },
  });
  assert.equal(r.sent, false);
  assert.equal(r.reason, "cooldown");
  assert.equal(calls.length, 0, "Slack must NOT be called when cooled down");
  assert.equal(inserts.length, 0, "no new dedupe row");
});

test("cooldown: existing row OLDER than 30min → does NOT block send", async () => {
  const now = new Date();
  const old = new Date(
    now.getTime() - (COOLDOWN_MINUTES + 5) * 60 * 1000,
  ).toISOString();
  const { sb, inserts } = fakeSb([
    {
      id: "old",
      created_at: old,
      payload: { kind: ALERT_SENT_KIND, alert_id: ALERT.id },
    },
  ]);
  const { fn } = fakeFetch();
  const r = await sendBankerAnalysisAlert({
    alert: ALERT,
    metricsSummary: METRICS,
    _deps: {
      sb,
      fetchImpl: fn,
      webhookUrl: "https://hooks.slack.test/abc",
      now,
    },
  });
  assert.equal(r.sent, true);
  assert.equal(inserts.length, 1);
});

test("cooldown: scoped per alert_id — different id is independent", async () => {
  const now = new Date();
  const recent = new Date(now.getTime() - 60_000).toISOString();
  const { sb } = fakeSb([
    {
      id: "other",
      created_at: recent,
      payload: { kind: ALERT_SENT_KIND, alert_id: "other_alert_id" },
    },
  ]);
  const { fn } = fakeFetch();
  const r = await sendBankerAnalysisAlert({
    alert: ALERT,
    metricsSummary: METRICS,
    _deps: {
      sb,
      fetchImpl: fn,
      webhookUrl: "https://hooks.slack.test/abc",
      now,
    },
  });
  assert.equal(r.sent, true);
});

test("Slack 4xx → returns slack_failed and does NOT write dedupe row", async () => {
  const { sb, inserts } = fakeSb();
  const { fn } = fakeFetch({ ok: false, status: 400 });
  const r = await sendBankerAnalysisAlert({
    alert: ALERT,
    metricsSummary: METRICS,
    _deps: { sb, fetchImpl: fn, webhookUrl: "https://hooks.slack.test/abc" },
  });
  assert.equal(r.sent, false);
  assert.equal(r.reason, "slack_failed");
  assert.equal(inserts.length, 0);
});

test("Slack network error → returns slack_failed (no throw)", async () => {
  const { sb } = fakeSb();
  const fetchImpl = (async () => {
    throw new Error("network down");
  }) as unknown as typeof fetch;
  const r = await sendBankerAnalysisAlert({
    alert: ALERT,
    metricsSummary: METRICS,
    _deps: { sb, fetchImpl, webhookUrl: "https://hooks.slack.test/abc" },
  });
  assert.equal(r.sent, false);
  assert.equal(r.reason, "slack_failed");
});

test("Slack body includes alert metadata + metrics link when appUrl set", async () => {
  const { sb } = fakeSb();
  const { fn, calls } = fakeFetch();
  await sendBankerAnalysisAlert({
    alert: ALERT,
    metricsSummary: METRICS,
    appUrl: "https://buddy.example.com",
    _deps: { sb, fetchImpl: fn, webhookUrl: "https://hooks.slack.test/abc" },
  });
  const body = calls[0].body;
  // Alert id + severity + message all serialized
  assert.match(JSON.stringify(body), /latency_breach/);
  assert.match(JSON.stringify(body), /warning/i);
  // Metrics link points at the SLA endpoint
  assert.match(
    JSON.stringify(body),
    /https:\/\/buddy\.example\.com\/api\/observability\/banker-analysis\?windowHours=24/,
  );
});
