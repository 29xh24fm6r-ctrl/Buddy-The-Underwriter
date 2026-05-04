# Banker E2E Analysis Pipeline (V2) — Runbook

## What this is

`runBankerAnalysisPipeline` is the single authoritative path that runs after a
deal's spreads are ready and produces, in this order:

1. **Model Engine V2 snapshot** — `deal_model_snapshots`
2. **Reconciliation** — `deal_reconciliation_results.overall_status`
3. **Risk run** — `risk_runs` (audit) + `ai_risk_runs` (read by credit-memo route)
4. **Memo run** — `memo_runs` + `memo_sections`
5. **Deal decision** — `deal_decisions` (system recommendation)
6. **Committee-ready signal** — `deal_credit_memo_status.current_status = ready_for_committee`

Source: [src/lib/underwriting/runBankerAnalysisPipeline.ts](../../src/lib/underwriting/runBankerAnalysisPipeline.ts)

## Triggers

There are exactly two production triggers:

1. **Automatic, after spreads succeed** — the spreads worker awaits the
   pipeline directly after writing `deal_spread_jobs.status = 'SUCCEEDED'`.
   See [src/lib/jobs/processors/spreadsProcessor.ts](../../src/lib/jobs/processors/spreadsProcessor.ts).

2. **Explicit, banker-driven** — `POST /api/deals/[dealId]/banker-analysis/run`
   with optional body `{ "reason": "manual_run" | "admin_replay", "forceRun": false }`.
   The route awaits the full pipeline before responding (`maxDuration = 300s`).

To disable the automatic post-spreads trigger (e.g. during incident response):
`BANKER_ANALYSIS_AUTO_RUN=false`. The explicit POST route is unaffected.

## Vercel-safe contract

- No fire-and-forget. Every analysis write is `await`-ed before the worker /
  route returns.
- The pipeline holds an in-flight marker (`risk_runs.status='running'`) for
  the duration of the run. Concurrent triggers within a 60-second window are
  rejected with `ALREADY_RUNNING`. `forceRun=true` bypasses that guard for
  admin replay.

## Gates (and what they return)

| Gate                     | Blocker code                  | Cause |
|--------------------------|--------------------------------|-------|
| Deal lookup              | `DEAL_NOT_FOUND`              | No row in `deals`. |
| Tenant match             | `TENANT_MISMATCH`             | `deals.bank_id` ≠ caller's bank. |
| Loan request             | `LOAN_REQUEST_INCOMPLETE`     | No `deal_loan_requests.requested_amount` and `deals.loan_amount` is null. |
| Spread readiness         | `SPREADS_NOT_READY`           | No `deal_spreads` row with `status = 'ready'`. |
| In-flight idempotency    | `ALREADY_RUNNING`             | A recent `risk_runs` row with `status='running'` exists for the deal. |
| Model snapshot           | `MODEL_SNAPSHOT_FAILED`       | `computeAuthoritativeEngine` returned no `snapshotId`. |
| Risk generation          | `RISK_RUN_FAILED`             | AI provider threw. |
| Memo generation          | `MEMO_RUN_FAILED`             | AI provider threw. |
| Reconciliation           | `RECONCILIATION_FLAGS` / `RECONCILIATION_CONFLICTS` | Soft / hard cross-document checks failed. Memo + decision still written; committee-ready is **not** flipped. |

`reconciliationStatus` in the result is **never** null after the pipeline runs
past the spread-readiness gate — it is always `CLEAN`, `FLAGS`, or `CONFLICTS`.

## Verification SQL

### Cluster-wide row counts

```sql
select count(*) from deal_model_snapshots;
select count(*) from ai_risk_runs;
select count(*) from risk_runs;
select count(*) from memo_runs;
select count(*) from deal_decisions;
select count(*) from deal_committee_decisions;
select count(*) from deal_decision_finalization;
```

After the first end-to-end banker run on a fresh deal, expect non-zero counts
in `deal_model_snapshots`, `ai_risk_runs`, `risk_runs`, `memo_runs`, and
`deal_decisions`. `deal_committee_decisions` and `deal_decision_finalization`
remain zero until a banker / committee user takes a formal action — those are
not written by the system pipeline.

### Per-deal verification

Replace `<deal_id>` and run in order. Each query points at the specific table
the pipeline writes.

```sql
-- Lifecycle + reconciliation status for the deal
select id, lifecycle_stage, updated_at
  from deals
 where id = '<deal_id>';

select deal_id, overall_status, checks_run, checks_passed, checks_failed, reconciled_at
  from deal_reconciliation_results
 where deal_id = '<deal_id>';

-- Model Engine V2 snapshot (latest first)
select *
  from deal_model_snapshots
 where deal_id = '<deal_id>'
 order by calculated_at desc;

-- Risk runs
select id, status, model_name, model_version, created_at
  from risk_runs
 where deal_id = '<deal_id>'
 order by created_at desc;

select id, grade, base_rate_bps, risk_premium_bps, created_at
  from ai_risk_runs
 where deal_id = '<deal_id>'
 order by created_at desc;

-- Memo run + sections
select id, status, risk_run_id, model_name, model_version, created_at
  from memo_runs
 where deal_id = '<deal_id>'
 order by created_at desc;

select section_key, title, length(content) as content_len, jsonb_array_length(citations) as citation_count
  from memo_sections
 where memo_run_id = (select id from memo_runs
                      where deal_id = '<deal_id>'
                      order by created_at desc
                      limit 1);

-- System recommendation
select id, decision, decided_by, reconciliation_status, evidence, created_at
  from deal_decisions
 where deal_id = '<deal_id>'
 order by created_at desc;

-- Committee-ready signal
select deal_id, current_status, active_memo_snapshot_id, updated_at, updated_by
  from deal_credit_memo_status
 where deal_id = '<deal_id>';

-- Banker / committee actions (written by humans, not the pipeline)
select * from deal_committee_decisions where deal_id = '<deal_id>';
select * from deal_decision_finalization where deal_id = '<deal_id>';
```

## Operational guard: detect runaway re-spawning

The pipeline is awaited in the spreads worker, so each `deal_spread_jobs.status
= 'SUCCEEDED'` triggers exactly one banker analysis run (subject to the
60-second `ALREADY_RUNNING` guard). Watch for any deal repeatedly spawning
runs — that means upstream is recomputing spreads in a loop.

```sql
-- Per-deal run frequency in the last hour (ai_risk_runs has no status column —
-- one row per attempted run).
select deal_id, count(*) as runs_last_hour
  from ai_risk_runs
 where created_at > now() - interval '1 hour'
 group by deal_id
 order by runs_last_hour desc
 limit 20;
```

```sql
-- Same window, broken down by terminal state (risk_runs is the audit table
-- with status: queued | running | completed | failed).
select deal_id, status, count(*) as runs
  from risk_runs
 where created_at > now() - interval '1 hour'
 group by deal_id, status
 order by runs desc
 limit 30;
```

Expected steady state: most deals have 0 runs in the last hour, an actively-
processed deal has 1–3 (one initial run + at most a couple of post-spread
recomputes). Any deal showing **double-digit runs/hour** points to either a
spread-recompute storm upstream or a failure mode where `risk_runs` keeps
ending in `failed` and triggers don't back off — investigate before reverting
the kill switch.

Kill switch (set in Vercel project env, no redeploy required for the next cron
tick to pick it up):

```text
BANKER_ANALYSIS_AUTO_RUN=false
```

That disables only the post-spreads auto-trigger. The explicit
`POST /api/deals/[dealId]/banker-analysis/run` route is unaffected — bankers
can still drive runs manually while you investigate.

## End-to-end smoke test

1. Create a fresh banker line-of-credit deal.
2. Upload required docs (T12, balance sheet, tax return).
3. Wait for the spreads worker to succeed
   (`select status from deal_spread_jobs where deal_id = '<deal_id>' order by created_at desc limit 1;`
   should be `SUCCEEDED`).
4. Within ~60s the worker will have called `runBankerAnalysisPipeline` —
   verify the per-deal SQL above. Expect:
   - `deal_model_snapshots`: 1+ row
   - `risk_runs`: 1 row, `status='completed'`
   - `ai_risk_runs`: 1 row with a grade
   - `memo_runs`: 1 row, `status='completed'`
   - `memo_sections`: ≥ 1 row
   - `deal_decisions`: 1 row, `decided_by='system:spreads-worker'` (or your
     Clerk userId if you triggered manually)
   - `deal_reconciliation_results.overall_status`: not null

If any of those rows are missing on a deal that had a `SUCCEEDED` spreads job:

- Check `deal_pipeline_ledger` for `event_key='banker_analysis_completed'`
  or `event_key='banker_analysis.post_spreads_failed'` — both carry the run's
  `status` and `blockers`.
- Check `deal_events` for `kind='banker_analysis.blocked'` — `meta.blocker`
  identifies which gate fired (`SPREADS_NOT_READY`, `LOAN_REQUEST_INCOMPLETE`,
  etc.).

## Replay

To force a re-run for a single deal (admin only):

```bash
curl -X POST "$ORIGIN/api/deals/<deal_id>/banker-analysis/run" \
     -H 'Content-Type: application/json' \
     -d '{"reason": "admin_replay", "forceRun": true}' \
     --cookie "<session>"
```

`forceRun=true` bypasses the in-flight guard. The pipeline still respects all
other gates (loan request, spreads ready, tenant). Each replay writes a new
`risk_runs`, `memo_runs`, and `deal_decisions` row — they are append-only.

## Why each table is touched

- **`deal_model_snapshots`**: authoritative V2 financial model. Driven by
  `computeAuthoritativeEngine` — the only function allowed to persist
  snapshots.
- **`risk_runs`**: explainable-risk audit table from
  `20251226999999_explainable_risk_memo.sql`. The pipeline uses this row both
  as the in-flight marker and as the FK target for `memo_runs.risk_run_id`.
- **`ai_risk_runs`**: legacy parallel table read by
  `POST /api/deals/[dealId]/credit-memo/generate`. Kept in sync to avoid
  breaking the existing memo route.
- **`memo_runs` + `memo_sections`**: explainable-memo audit tables. Sections
  carry citations for memo provenance.
- **`deal_decisions`**: append-only system recommendation derived from the
  risk grade. `decided_by='system:banker-analysis'` (or the worker name).
  Banker-driven approve/decline actions still flow through
  `POST /api/deals/[dealId]/actions`.
- **`deal_credit_memo_status.current_status='ready_for_committee'`**:
  committee-ready signal. Only flipped when reconciliation is `CLEAN` and the
  recommendation is not `tabled`.

## Out of scope

The pipeline does not:

- Mutate `deals.lifecycle_stage`. Stage transitions remain owned by
  `src/buddy/lifecycle/`.
- Write `deal_committee_decisions` or `deal_decision_finalization` — those are
  human disposition records, written by the banker / committee user via the
  governance routes.
- Replace `POST /api/deals/[dealId]/credit-memo/generate`. The legacy memo
  route still works for re-running just the memo step against an existing
  `ai_risk_runs` row. The pipeline writes a fresh memo each invocation.
