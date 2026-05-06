/**
 * Banker Analysis Observability + SLA — pure aggregation module.
 *
 * The data fetch (`loadBankerAnalysisSla`) lives at the bottom; everything
 * above it is pure so the aggregation can be exercised in unit tests with
 * synthetic inputs and no DB. The module is server-only because the loader
 * touches Supabase, but the pure functions are safe to import anywhere.
 *
 * Schema notes:
 *   `risk_runs` does not have a `completed_at` / `updated_at` column today,
 *   so latency is derived by joining each completed `risk_runs` row to the
 *   matching `deal_pipeline_ledger` row written at end-of-pipeline (event_key
 *   `banker_analysis_completed`, payload.risk_run_id = risk_runs.id). See the
 *   spec for the full rationale.
 */

import { assertServerOnly } from "@/lib/serverOnly";
import type { SupabaseClient } from "@supabase/supabase-js";

assertServerOnly();

// ─── Public types ────────────────────────────────────────────────────────────

export type SlaVerdict = "ok" | "breach" | "no_data";
export type AlertSeverity = "warning" | "error";

export type SlaAlert = {
  id:
    | "latency_breach"
    | "write_failures_spike"
    | "stale_recovery_recent"
    | "retry_loop_suspected";
  severity: AlertSeverity;
  message: string;
};

export type LatencyMetrics = {
  p50Seconds: number | null;
  p95Seconds: number | null;
  sampleCount: number;
};

export type FailuresMetrics = {
  total: number;
  byCode: Array<{ code: string; count: number }>;
};

export type RetryMetrics = {
  failedRunsInWindow: number;
  recoveredDeals: number;
  successRate: number | null;
};

export type SlaVerdicts = {
  latencyP95: SlaVerdict;
  writeFailureRate: SlaVerdict;
  staleRecoveryRate: SlaVerdict;
  retrySuccessRate: SlaVerdict;
};

export type BankerAnalysisSlaResponse = {
  ok: true;
  windowHours: number;
  generatedAt: string;
  latency: LatencyMetrics;
  failures: FailuresMetrics;
  staleRecoveries: number;
  retry: RetryMetrics;
  runVolume: number;
  sla: SlaVerdicts;
  alerts: SlaAlert[];
};

// ─── Constants ──────────────────────────────────────────────────────────────

export const SLA_THRESHOLDS = {
  latencyP95Seconds: 30,
  writeFailureRatePct: 1, // > 1 % = breach
  retrySuccessRatePct: 90, // < 90 % = breach
} as const;

export const ALERT_LOOKBACK_MS = 10 * 60 * 1000;
export const ALERT_LIMITS = {
  writeFailuresIn10Min: 5, // > 5 = error
  retryLoopFailuresPerDealIn10Min: 3, // > 3 = warning
} as const;

const PIPELINE_MODEL = "banker_analysis_pipeline";
const COMPLETION_LEDGER_KEY = "banker_analysis_completed";
const WRITE_FAILED_KIND = "banker_analysis.write_failed";
const STALE_RECOVERED_KIND = "banker_analysis.stale_run_recovered";

// ─── Pure: percentile ───────────────────────────────────────────────────────

/**
 * Linear-interpolation percentile (matches Postgres `percentile_cont`).
 * Returns null for an empty input. Pure.
 */
export function computePercentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  if (p <= 0) return Math.min(...values);
  if (p >= 1) return Math.max(...values);
  const sorted = [...values].sort((a, b) => a - b);
  const rank = p * (sorted.length - 1);
  const lower = Math.floor(rank);
  const upper = Math.ceil(rank);
  if (lower === upper) return sorted[lower];
  const weight = rank - lower;
  return sorted[lower] * (1 - weight) + sorted[upper] * weight;
}

// ─── Pure: aggregation inputs ───────────────────────────────────────────────

export type RiskRunRow = {
  id: string;
  deal_id: string;
  status: "queued" | "running" | "completed" | "failed" | string;
  created_at: string; // ISO
};

export type LedgerCompletionRow = {
  risk_run_id: string;
  created_at: string; // ISO
};

export type EventRow = {
  kind: string;
  created_at: string; // ISO
  blocker?: string | null; // for write_failed events
};

export type AggregateInputs = {
  windowHours: number;
  now: Date;
  riskRuns: RiskRunRow[];
  ledgerCompletions: LedgerCompletionRow[];
  events: EventRow[];
};

// ─── Pure: aggregator ───────────────────────────────────────────────────────

export function aggregateBankerAnalysisSla(
  inputs: AggregateInputs,
): BankerAnalysisSlaResponse {
  const { windowHours, now, riskRuns, ledgerCompletions, events } = inputs;

  // 1. Latency: pair each completed risk_run with its completion ledger row.
  const ledgerByRunId = new Map<string, string>();
  for (const row of ledgerCompletions) {
    if (row.risk_run_id) ledgerByRunId.set(row.risk_run_id, row.created_at);
  }
  const latencyDurations: number[] = [];
  for (const run of riskRuns) {
    if (run.status !== "completed") continue;
    const completedAt = ledgerByRunId.get(run.id);
    if (!completedAt) continue;
    const start = Date.parse(run.created_at);
    const end = Date.parse(completedAt);
    if (Number.isNaN(start) || Number.isNaN(end)) continue;
    const seconds = (end - start) / 1000;
    if (seconds < 0) continue;
    latencyDurations.push(seconds);
  }
  const latency: LatencyMetrics = {
    p50Seconds: computePercentile(latencyDurations, 0.5),
    p95Seconds: computePercentile(latencyDurations, 0.95),
    sampleCount: latencyDurations.length,
  };

  // 2. Write failures by code
  const failureCounts = new Map<string, number>();
  let writeFailureTotal = 0;
  for (const e of events) {
    if (e.kind !== WRITE_FAILED_KIND) continue;
    writeFailureTotal++;
    const code = e.blocker ?? "UNKNOWN";
    failureCounts.set(code, (failureCounts.get(code) ?? 0) + 1);
  }
  const failures: FailuresMetrics = {
    total: writeFailureTotal,
    byCode: Array.from(failureCounts.entries())
      .map(([code, count]) => ({ code, count }))
      .sort((a, b) => b.count - a.count || a.code.localeCompare(b.code)),
  };

  // 3. Stale recoveries
  const staleRecoveries = events.filter((e) => e.kind === STALE_RECOVERED_KIND)
    .length;

  // 4. Retry effectiveness — for each failed run, did the same deal get a
  //    completed run within 1 hour AFTER it?
  const runsByDeal = new Map<string, RiskRunRow[]>();
  for (const run of riskRuns) {
    const list = runsByDeal.get(run.deal_id) ?? [];
    list.push(run);
    runsByDeal.set(run.deal_id, list);
  }
  // Sort each deal's runs by created_at ascending so we can scan forward.
  for (const list of runsByDeal.values()) {
    list.sort(
      (a, b) => Date.parse(a.created_at) - Date.parse(b.created_at),
    );
  }
  const recoveredDeals = new Set<string>();
  let failedRunsInWindow = 0;
  const ONE_HOUR_MS = 60 * 60 * 1000;
  for (const [dealId, runs] of runsByDeal) {
    for (let i = 0; i < runs.length; i++) {
      const run = runs[i];
      if (run.status !== "failed") continue;
      failedRunsInWindow++;
      const failedAt = Date.parse(run.created_at);
      // Look for any later completed run within 1 hour
      for (let j = i + 1; j < runs.length; j++) {
        const next = runs[j];
        if (next.status !== "completed") continue;
        const nextAt = Date.parse(next.created_at);
        if (nextAt - failedAt < ONE_HOUR_MS) {
          recoveredDeals.add(dealId);
          break;
        }
      }
    }
  }
  const retry: RetryMetrics = {
    failedRunsInWindow,
    recoveredDeals: recoveredDeals.size,
    successRate:
      failedRunsInWindow > 0
        ? recoveredDeals.size / failedRunsInWindow
        : null,
  };

  // 5. Run volume
  const runVolume = riskRuns.length;

  // 6. SLA verdicts
  const sla = computeSlaVerdicts({ latency, failures, staleRecoveries, retry, runVolume });

  // 7. Alerts (10-min look-back window).
  const alerts = computeAlerts({
    now,
    events,
    riskRuns,
    latencyP95: latency.p95Seconds,
  });

  return {
    ok: true,
    windowHours,
    generatedAt: now.toISOString(),
    latency,
    failures,
    staleRecoveries,
    retry,
    runVolume,
    sla,
    alerts,
  };
}

// ─── Pure: SLA verdicts ─────────────────────────────────────────────────────

export function computeSlaVerdicts(args: {
  latency: LatencyMetrics;
  failures: FailuresMetrics;
  staleRecoveries: number;
  retry: RetryMetrics;
  runVolume: number;
}): SlaVerdicts {
  const { latency, failures, staleRecoveries, retry, runVolume } = args;
  return {
    latencyP95:
      latency.p95Seconds === null
        ? "no_data"
        : latency.p95Seconds > SLA_THRESHOLDS.latencyP95Seconds
          ? "breach"
          : "ok",
    writeFailureRate:
      runVolume === 0
        ? "no_data"
        : (failures.total / runVolume) * 100 > SLA_THRESHOLDS.writeFailureRatePct
          ? "breach"
          : "ok",
    staleRecoveryRate: staleRecoveries > 0 ? "breach" : "ok",
    retrySuccessRate:
      retry.successRate === null
        ? "no_data"
        : retry.successRate * 100 < SLA_THRESHOLDS.retrySuccessRatePct
          ? "breach"
          : "ok",
  };
}

// ─── Pure: alerts ───────────────────────────────────────────────────────────

export function computeAlerts(args: {
  now: Date;
  events: EventRow[];
  riskRuns: RiskRunRow[];
  latencyP95: number | null;
}): SlaAlert[] {
  const { now, events, riskRuns, latencyP95 } = args;
  const alerts: SlaAlert[] = [];
  const lookbackStart = now.getTime() - ALERT_LOOKBACK_MS;

  // 1. Latency breach (uses window-level p95, since 10-min p95 may be noisy)
  if (
    latencyP95 !== null &&
    latencyP95 > SLA_THRESHOLDS.latencyP95Seconds
  ) {
    alerts.push({
      id: "latency_breach",
      severity: "warning",
      message: `p95 latency ${latencyP95.toFixed(1)}s exceeds ${SLA_THRESHOLDS.latencyP95Seconds}s target.`,
    });
  }

  // 2. Write failures spike (last 10 min)
  const recentWriteFailures = events.filter(
    (e) =>
      e.kind === WRITE_FAILED_KIND &&
      Date.parse(e.created_at) >= lookbackStart,
  );
  if (recentWriteFailures.length > ALERT_LIMITS.writeFailuresIn10Min) {
    alerts.push({
      id: "write_failures_spike",
      severity: "error",
      message: `${recentWriteFailures.length} write_failed events in the last 10 minutes (threshold: ${ALERT_LIMITS.writeFailuresIn10Min}).`,
    });
  }

  // 3. Stale recovery in last 10 min
  const recentStale = events.filter(
    (e) =>
      e.kind === STALE_RECOVERED_KIND &&
      Date.parse(e.created_at) >= lookbackStart,
  );
  if (recentStale.length > 0) {
    alerts.push({
      id: "stale_recovery_recent",
      severity: "warning",
      message: `${recentStale.length} stale-run recovery event(s) in the last 10 minutes.`,
    });
  }

  // 4. Retry loop suspicion: any deal with > 3 failed risk_runs in last 10 min
  const recentFailuresByDeal = new Map<string, number>();
  for (const r of riskRuns) {
    if (r.status !== "failed") continue;
    if (Date.parse(r.created_at) < lookbackStart) continue;
    recentFailuresByDeal.set(r.deal_id, (recentFailuresByDeal.get(r.deal_id) ?? 0) + 1);
  }
  for (const [dealId, count] of recentFailuresByDeal) {
    if (count > ALERT_LIMITS.retryLoopFailuresPerDealIn10Min) {
      alerts.push({
        id: "retry_loop_suspected",
        severity: "warning",
        message: `Deal ${dealId}: ${count} failed runs in the last 10 minutes (threshold: ${ALERT_LIMITS.retryLoopFailuresPerDealIn10Min}).`,
      });
    }
  }

  return alerts;
}

// ─── DB loader (server-only) ────────────────────────────────────────────────

export type LoadOpts = {
  windowHours?: number;
  now?: Date;
  /** Test seam — production callers leave undefined. */
  _sb?: SupabaseClient;
};

export async function loadBankerAnalysisSla(
  opts: LoadOpts = {},
): Promise<BankerAnalysisSlaResponse> {
  const windowHours = opts.windowHours ?? 24;
  const now = opts.now ?? new Date();
  const windowStart = new Date(now.getTime() - windowHours * 60 * 60 * 1000)
    .toISOString();
  const sb = opts._sb ?? (await loadAdmin());

  const [riskRunsRes, ledgerRes, eventsRes] = await Promise.all([
    sb
      .from("risk_runs")
      .select("id, deal_id, status, created_at")
      .eq("model_name", PIPELINE_MODEL)
      .gte("created_at", windowStart)
      .limit(5000),
    sb
      .from("deal_pipeline_ledger")
      .select("payload, created_at")
      .eq("event_key", COMPLETION_LEDGER_KEY)
      .gte("created_at", windowStart)
      .limit(5000),
    sb
      .from("deal_events")
      .select("kind, payload, created_at")
      .in("kind", [WRITE_FAILED_KIND, STALE_RECOVERED_KIND])
      .gte("created_at", windowStart)
      .limit(5000),
  ]);

  const riskRuns: RiskRunRow[] = (riskRunsRes.data ?? []) as RiskRunRow[];

  const ledgerCompletions: LedgerCompletionRow[] = (
    (ledgerRes.data ?? []) as Array<{
      payload: any;
      created_at: string;
    }>
  )
    .map((r) => {
      const runId = (r.payload as any)?.risk_run_id;
      if (typeof runId !== "string" || runId.length === 0) return null;
      return { risk_run_id: runId, created_at: r.created_at };
    })
    .filter((r): r is LedgerCompletionRow => r !== null);

  const events: EventRow[] = (
    (eventsRes.data ?? []) as Array<{
      kind: string;
      payload: any;
      created_at: string;
    }>
  ).map((r) => ({
    kind: r.kind,
    created_at: r.created_at,
    blocker:
      r.kind === WRITE_FAILED_KIND
        ? (r.payload?.meta?.blocker ?? null)
        : null,
  }));

  return aggregateBankerAnalysisSla({
    windowHours,
    now,
    riskRuns,
    ledgerCompletions,
    events,
  });
}

async function loadAdmin(): Promise<SupabaseClient> {
  const { supabaseAdmin } = await import("@/lib/supabase/admin");
  return supabaseAdmin();
}
