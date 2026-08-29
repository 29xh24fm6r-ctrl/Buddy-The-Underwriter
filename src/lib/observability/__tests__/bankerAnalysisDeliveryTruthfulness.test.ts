import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

import {
  loadBankerAnalysisSla,
  type BankerAnalysisSlaResponse,
  type RiskRunRow,
} from "../bankerAnalysisSla";
import { sendBankerAnalysisAlert } from "../sendBankerAnalysisAlert";

const NOW = new Date("2026-08-29T20:00:00.000Z");

function metrics(): BankerAnalysisSlaResponse {
  return {
    ok: true,
    windowHours: 24,
    generatedAt: NOW.toISOString(),
    latency: { p50Seconds: 1, p95Seconds: 2, sampleCount: 1 },
    failures: { total: 0, byCode: [] },
    staleRecoveries: 0,
    retry: { failedRunsInWindow: 0, recoveredDeals: 0, successRate: null },
    runVolume: 1,
    sla: {
      latencyP95: "ok",
      writeFailureRate: "ok",
      staleRecoveryRate: "ok",
      retrySuccessRate: "no_data",
    },
    alerts: [],
  };
}

function senderSb(opts: {
  recent?: { data: any[] | null; error: { message: string } | null };
  persisted?: { data: any; error: { message: string } | null };
}) {
  return {
    from() {
      let operation: "select" | "insert" = "select";
      const api: any = {
        select: () => api,
        gte: () => api,
        eq: () => api,
        limit: () => api,
        insert: () => {
          operation = "insert";
          return api;
        },
        single: async () =>
          opts.persisted ?? {
            data: {
              id: "event-1",
              payload: {
                kind: "banker_analysis.sla_alert_sent",
                alert_id: "latency_breach",
              },
            },
            error: null,
          },
        then: (onFulfilled: any, onRejected: any) =>
          Promise.resolve(
            operation === "select"
              ? (opts.recent ?? { data: [], error: null })
              : opts.persisted,
          ).then(onFulfilled, onRejected),
      };
      return api;
    },
  };
}

function alertInput(sb: any, fetchImpl?: typeof fetch) {
  return {
    alert: {
      id: "latency_breach" as const,
      severity: "warning" as const,
      message: "p95 latency exceeded",
    },
    metricsSummary: metrics(),
    _deps: {
      sb,
      fetchImpl:
        fetchImpl ??
        (async () => new Response("ok", { status: 200 })),
      webhookUrl: "https://hooks.slack.invalid/test",
      now: NOW,
    },
  };
}

test("banker alert refuses provider delivery when cooldown evidence is unavailable", async () => {
  let fetchCalls = 0;
  const result = await sendBankerAnalysisAlert(
    alertInput(
      senderSb({
        recent: { data: null, error: { message: "database unavailable" } },
      }) as any,
      (async () => {
        fetchCalls++;
        return new Response("ok", { status: 200 });
      }) as typeof fetch,
    ),
  );

  assert.equal(fetchCalls, 0);
  assert.deepEqual(result, {
    sent: false,
    reason: "cooldown_check_failed",
    detail: "database_error",
  });
});

test("banker alert never reports provider acceptance as proven without its audit row", async () => {
  const result = await sendBankerAnalysisAlert(
    alertInput(
      senderSb({
        persisted: { data: null, error: { message: "write unavailable" } },
      }) as any,
    ),
  );

  assert.deepEqual(result, {
    sent: false,
    providerAccepted: true,
    reason: "evidence_persistence_failed",
    detail: "database_error",
  });
});

test("banker alert requires the exact returned audit identity", async () => {
  const result = await sendBankerAnalysisAlert(
    alertInput(
      senderSb({
        persisted: {
          data: {
            id: "event-1",
            payload: {
              kind: "banker_analysis.sla_alert_sent",
              alert_id: "different-alert",
            },
          },
          error: null,
        },
      }) as any,
    ),
  );

  assert.equal(result.sent, false);
  assert.equal(result.providerAccepted, true);
  assert.equal(result.reason, "evidence_persistence_failed");
});

test("banker alert reports sent only after Slack and canonical evidence succeed", async () => {
  const result = await sendBankerAnalysisAlert(alertInput(senderSb({}) as any));
  assert.deepEqual(result, {
    sent: true,
    providerAccepted: true,
    reason: "ok",
  });
});

type PagedSeed = Record<
  string,
  { rows?: any[]; error?: { message: string } | null }
>;

function pagedSb(seed: PagedSeed) {
  return {
    from(table: string) {
      const api: any = {
        select: () => api,
        eq: () => api,
        gte: () => api,
        in: () => api,
        order: () => api,
        range: async (from: number, to: number) => {
          const entry = seed[table] ?? { rows: [] };
          if (entry.error) return { data: null, error: entry.error };
          return {
            data: (entry.rows ?? []).slice(from, to + 1),
            error: null,
          };
        },
      };
      return api;
    },
  };
}

test("banker SLA loading fails closed when any authoritative source read fails", async () => {
  await assert.rejects(
    () =>
      loadBankerAnalysisSla({
        now: NOW,
        _sb: pagedSb({
          risk_runs: { error: { message: "schema unavailable" } },
        }) as any,
      }),
    /risk_runs_read_failed: schema unavailable/,
  );
});

test("banker SLA loading paginates past the first Supabase response boundary", async () => {
  const riskRuns: RiskRunRow[] = Array.from({ length: 1_001 }, (_, index) => ({
    id: `run-${String(index).padStart(4, "0")}`,
    deal_id: `deal-${index}`,
    status: "running",
    created_at: new Date(NOW.getTime() - index * 1_000).toISOString(),
  }));

  const result = await loadBankerAnalysisSla({
    now: NOW,
    _sb: pagedSb({ risk_runs: { rows: riskRuns } }) as any,
  });

  assert.equal(result.runVolume, 1_001);
});

test("banker alert cron makes incomplete delivery non-green", () => {
  const route = readFileSync(
    resolve(
      process.cwd(),
      "src/app/api/observability/banker-analysis/alerts/route.ts",
    ),
    "utf8",
  );

  assert.match(route, /else failed\+\+/);
  assert.match(route, /providerAccepted: r\.providerAccepted === true/);
  assert.match(route, /status: ok \? 200 : 503/);
});
