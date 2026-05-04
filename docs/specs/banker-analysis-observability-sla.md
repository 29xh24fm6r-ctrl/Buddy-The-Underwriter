# Banker Analysis Observability + SLA

**Status:** Draft spec — implementation pending
**Predecessors:** PR #396 (banker E2E flow status and recovery)
**Owner area:** `src/lib/observability/`, `src/app/api/observability/`

---

## Goal

Provide real-time visibility into banker analysis performance and reliability.

Detect:

- slow runs
- failed runs
- write failures
- stale recoveries
- retry loops

No silent degradation.

---

## Metrics

### 1. Run latency

**Note on schema:** `risk_runs` does not currently have an `updated_at` /
`completed_at` column (see `20251226999999_explainable_risk_memo.sql`). To
avoid a schema/pipeline change, completion time is derived from
`deal_pipeline_ledger.created_at` where `event_key='banker_analysis_completed'`
and `payload->>'risk_run_id'` matches the risk_runs row id. This is what the
pipeline already writes at the end of every successful run.

```sql
-- Per-run latency in seconds for completed runs in the last 24h
select extract(epoch from (l.created_at - r.created_at)) as duration_seconds
from risk_runs r
join deal_pipeline_ledger l
  on (l.payload->>'risk_run_id') = r.id::text
where r.model_name = 'banker_analysis_pipeline'
  and r.status = 'completed'
  and l.event_key = 'banker_analysis_completed'
  and r.created_at > now() - interval '24 hours';

-- p50 / p95 over those durations is computed in app code (sort + index).
```

### 2. Failure rate by code

**Source:** `deal_events` (kind = `banker_analysis.write_failed`)

```sql
select
  payload->'meta'->>'blocker' as failure_code,
  count(*) as count
from deal_events
where kind = 'banker_analysis.write_failed'
  and created_at > now() - interval '24 hours'
group by failure_code
order by count desc;
```

### 3. Stale recovery rate

```sql
select count(*) as stale_recoveries
from deal_events
where kind = 'banker_analysis.stale_run_recovered'
  and created_at > now() - interval '24 hours';
```

### 4. Retry effectiveness

```sql
-- runs that failed, then succeeded for the same deal within 1 hour
select count(distinct r1.deal_id) as recovered_deals
from risk_runs r1
join risk_runs r2
  on r1.deal_id = r2.deal_id
where r1.status = 'failed'
  and r2.status = 'completed'
  and r2.created_at > r1.created_at
  and r2.created_at < r1.created_at + interval '1 hour'
  and r1.created_at > now() - interval '24 hours';
```

### 5. Run volume

```sql
select count(*) as runs
from risk_runs
where model_name = 'banker_analysis_pipeline'
  and created_at > now() - interval '24 hours';
```

---

## SLA targets

| Metric                | Target  |
|-----------------------|---------|
| p50 latency           | < 10 s  |
| p95 latency           | < 30 s  |
| write failure rate    | < 1 %   |
| stale recovery rate   | ~ 0     |
| retry success rate    | > 90 %  |

---

## Alerts

Trigger alert when:

1. **Latency breach** — `p95 > 30s` for 10 minutes
2. **Write failures spike** — `> 5` write_failed events in 10 minutes
3. **Stale recovery appears** — any `stale_run_recovered` in last 10 minutes
4. **Retry loop suspicion** — same `deal_id` fails > 3 times in 10 minutes

This spec defines the alert thresholds. Wiring to a paging system (PagerDuty,
Slack) is out of scope for the initial implementation; the SLA verdict per
metric is exposed in the API response so any external watcher can poll it.

---

## API

```
GET /api/observability/banker-analysis?windowHours=24
```

**Auth:** super-admin only (`requireSuperAdmin`).

**Response:**

```ts
{
  ok: true,
  windowHours: number,
  generatedAt: string,             // ISO timestamp
  latency: {
    p50Seconds: number | null,
    p95Seconds: number | null,
    sampleCount: number
  },
  failures: {
    total: number,
    byCode: Array<{ code: string; count: number }>
  },
  staleRecoveries: number,
  retry: {
    failedRunsInWindow: number,
    recoveredDeals: number,
    successRate: number | null     // recoveredDeals / failedRunsInWindow
  },
  runVolume: number,
  sla: {
    latencyP95: "ok" | "breach" | "no_data",
    writeFailureRate: "ok" | "breach" | "no_data",
    staleRecoveryRate: "ok" | "breach",
    retrySuccessRate: "ok" | "breach" | "no_data"
  },
  alerts: Array<{ id: string; severity: "warning" | "error"; message: string }>
}
```

---

## Dashboard

Out of scope for this PR. The API is consumable by an external dashboard.

---

## Acceptance criteria

- Metrics queryable via SQL (queries documented above).
- API returns aggregated metrics with SLA verdict per metric.
- Alerts derived deterministically from the same data the API returns.
- No silent failure goes undetected.
- Pure aggregation logic (no DB) is independently unit-tested.
- `pnpm test:unit`, `pnpm typecheck`, `pnpm lint`, `pnpm build` all pass.

---

## Non-goals

- No new tables.
- No pipeline changes.
- No RLS changes.
- No paging/notification integration in this PR.

---

## Deliverable

One PR titled:

```
feat(observability): add banker analysis SLA metrics
```
