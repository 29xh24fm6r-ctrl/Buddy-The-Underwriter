# Runbook: franchise-sync-worker cadence

## Intended cadence

**Weekly**, Mondays 6am America/Chicago. This is a Cloud Scheduler job
(`franchise-sync-weekly`), not something driven by application code — the
worker (`services/franchise-sync-worker`) is a Cloud Run HTTP service with no
self-scheduling loop; it only runs a sync when `POST /` is invoked.

Scheduler config lives in GCP, created via the command documented in
`services/franchise-sync-worker/README.md` and printed by
`scripts/gcp/franchise-sync-deploy.sh`:

```bash
gcloud scheduler jobs create http franchise-sync-weekly \
  --location=us-central1 \
  --schedule='0 6 * * 1' \
  --time-zone='America/Chicago' \
  --uri="$SERVICE_URL" \
  --http-method=POST \
  --oidc-service-account-email=buddy-core-worker@buddy-the-underwriter.iam.gserviceaccount.com \
  --headers='Content-Type=application/json'
```

To inspect or fix the live schedule (GCP-owned, not repo-owned):

```bash
gcloud scheduler jobs describe franchise-sync-weekly --location=us-central1
```

## Verification query

```sql
SELECT count(*) FROM franchise_sync_runs WHERE started_at > now() - interval '7 days';
```

At the intended cadence this should be **≤ 3** (one weekly run, plus headroom
for a manual re-trigger or retry). A count in the hundreds/thousands means the
scheduler is firing far more often than weekly (audit baseline 2026-07-29:
1,513 runs/7 days, ≈ every 6-7 minutes).

## Self-throttle (code-side safety net)

Since the misconfiguration lives in Cloud Scheduler, not in this repo, the
worker cannot fix its own trigger cadence. What it *can* do is refuse to
compound the problem: before running a sync, `POST /` counts
`franchise_sync_runs` rows in the trailing 24h
(`services/franchise-sync-worker/src/cadenceGuard.ts`). If that count exceeds
`MAX_RUNS_PER_24H` (3), the worker:

1. Logs a `sync_cadence_anomaly` event to `buddy_system_events`
   (`source_system = 'franchise-sync-worker'`).
2. Returns `200 { ok: true, throttled: true, runsTrailing24h }` **without**
   touching `franchise_brands` or `franchise_sba_directory_snapshots` —
   idempotent, no data change.

This is a safety net, not the fix — if you see `sync_cadence_anomaly` events,
go fix the Cloud Scheduler job, don't just let the throttle absorb it
indefinitely (it does not by itself reduce Cloud Run invocation cost).

Check for anomaly events:

```sql
SELECT created_at, payload FROM buddy_system_events
WHERE event_type = 'sync_cadence_anomaly'
ORDER BY created_at DESC LIMIT 20;
```

## Override

There is no env var to disable the throttle — if you need to force a sync
despite the trailing-24h count (e.g. after fixing the scheduler and wanting to
confirm behavior immediately), lower `franchise_sync_runs` volume first, or
raise `MAX_RUNS_PER_24H` temporarily in code for a one-off manual test.
