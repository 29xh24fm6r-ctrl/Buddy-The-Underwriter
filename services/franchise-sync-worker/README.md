# franchise-sync-worker

Cloud Run service that syncs the SBA Franchise Directory into Supabase.

Triggered by Cloud Scheduler on a weekly cron (Mondays, 6 am Central). On each run it:

1. Creates a `franchise_sync_runs` row with status `running`.
2. Downloads the SBA Franchise Directory `.xlsx` from sba.gov.
3. Parses the xlsx and normalizes columns into `SbaDirectoryRow`.
4. Diffs the current rows against the most recent completed run's snapshot (by `brand_name`, via `row_hash`).
5. Upserts canonical `franchise_brands` rows (keyed on `sba_directory_id`).
6. Writes one `franchise_sba_directory_snapshots` row per brand for this run (content-addressed by `row_hash`).
7. Marks brands absent from the new directory as `sba_eligible = false`, status `removed`.
8. Completes the `franchise_sync_runs` row with counts, duration, and any errors.

## Endpoints

| Method | Path              | Purpose                                                         |
|--------|-------------------|-----------------------------------------------------------------|
| POST   | `/`               | Trigger an SBA directory sync.                                  |
| POST   | `/scrape-wi-fdd`  | Batch-scrape WI DFI for FDDs. Query: `batchSize`, `delayMs`, `downloadPdf`, `brandFilter`. |
| POST   | `/scrape-mn-fdd`  | Batch-scrape MN CARDS for FDDs. Query: `batchSize`, `delayMs`, `downloadPdf`, `brandFilter`, `yearLookback`. |
| GET    | `/health`         | Liveness check for Cloud Run.                                   |

All POST endpoints require `x-cron-secret` or `Bearer` auth when `CRON_SECRET` is set.

## Environment

| Variable              | Required | Notes                                                       |
|-----------------------|----------|-------------------------------------------------------------|
| `BUDDY_DB_URL`        | yes      | Supabase pooler connection string (shared with `buddy-core-worker`). |
| `BUDDY_DB_CA_BUNDLE`  | no       | PEM CA chain for TLS. Falls back to `rejectUnauthorized: false`. |
| `CRON_SECRET`         | no       | If set, POST `/` requires `x-cron-secret` or `Bearer` header. |
| `SBA_DIRECTORY_URL`   | no       | Override default SBA xlsx URL (for testing/fallback).       |
| `PORT`                | no       | Defaults to `8080` (Cloud Run convention).                  |

## Local dev

```bash
npm install
BUDDY_DB_URL='postgres://...' npm run dev
# In another terminal:
curl -X POST http://localhost:8080/
```

## Deploy

```bash
scripts/gcp/franchise-sync-deploy.sh
```

Deploys to Cloud Run with `min-instances=0`, `max-instances=1`, 512Mi memory, 300s timeout.
The service is `--no-allow-unauthenticated` — Cloud Scheduler authenticates via OIDC token.

## Cloud Scheduler

Create once after first deploy:

```bash
SERVICE_URL=$(gcloud run services describe franchise-sync-worker \
  --region us-central1 --format='value(status.url)')

gcloud scheduler jobs create http franchise-sync-weekly \
  --location=us-central1 \
  --schedule='0 6 * * 1' \
  --time-zone='America/Chicago' \
  --uri="$SERVICE_URL" \
  --http-method=POST \
  --oidc-service-account-email=buddy-core-worker@buddy-the-underwriter.iam.gserviceaccount.com \
  --headers="Content-Type=application/json"
```

## Column-name discovery

The SBA xlsx column headers are not a stable contract. `src/xlsxParser.ts` has a
`COLUMN_MAP` with multiple aliases per canonical field (e.g. "Brand Name", "Brand",
"Franchise Name" all map to `brand_name`). If the SBA changes headers and the parser
can't find a `brand_name` column, it throws with the observed headers so the map can
be updated.

First-run sanity check:

```bash
curl -o /tmp/sba_directory.xlsx 'https://www.sba.gov/sites/default/files/franchise_directory.xlsx'
npx xlsx-cli /tmp/sba_directory.xlsx --head 1
```
