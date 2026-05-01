# franchise-fdd-extractor

Cloud Run worker that reads FDD PDFs from GCS, extracts items 5/6/7/19/20 via Gemini Vision, and writes structured economics + Item 19 metrics back to Postgres. Companion to `franchise-sync-worker` (which fetches the PDFs in the first place).

## Endpoints

- `POST /extract-fdd?batchSize=5&delayMs=5000` — runs one extraction batch. Auth via `x-cron-secret` header (matches `franchise-sync-worker` pattern). Picks up to `batchSize` `fdd_filings` rows where `extraction_status='pending' AND gcs_path IS NOT NULL`, ordered by `created_at`.
- `GET /health` — liveness probe.

## Three productivity levers

1. **sha256 dedup cache.** Before any Gemini call, look for another `fdd_filings` row with the same `pdf_sha256` and `extraction_status='complete'`. If found, copy its `item_*_json` columns and reuse — no Gemini calls for the duplicate. NASAA brands typically have 3+ identical PDFs (one per state).
2. **Page-targeted extraction.** TOC scan on pages 1-5 reveals the page numbers for each item. We then send only the relevant page slice (5-15 pages) per item to Gemini. ~98% input-token reduction vs. full-PDF.
3. **Most-recent-filing-wins.** A brand with multiple filings (different states, different years) gets its brand-level economics populated only from the highest `filing_year`. See `franchise_brands.economics_source_filing_id` / `economics_source_year`.

## Model selection

Mirror of `src/lib/ai/models.ts` `MODEL_EXTRACTION` (currently `gemini-3-flash-preview`). On HTTP 404/400 from the REST endpoint, the worker automatically falls back to `gemini-2.5-flash` and remembers which model worked for subsequent calls. Update `PRIMARY_MODEL` in `src/geminiClient.ts` in lockstep with the registry.

## Env vars

| Variable | Source |
|---|---|
| `BUDDY_DB_URL` | Secret Manager |
| `GEMINI_API_KEY` | Secret Manager |
| `CRON_SECRET` | Secret Manager |
| `GCS_BUCKET` | env var (`buddy-franchise-fdds`) |

## Deploy

```bash
./scripts/gcp/fdd-extractor-deploy.sh
```

Tags the image with the current git short SHA, builds via Cloud Build, deploys to Cloud Run with 2 CPU / 1Gi memory / 3600s timeout / max-instances 1.
