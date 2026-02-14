# Phase 12 Ops — Exact Answers

Generated: 2026-02-13
Source of truth: codebase at commit `31c4084` + live Supabase production state

## Ops Execution Log (2026-02-13)

| Step | Status | Details |
|------|--------|---------|
| Migration | APPLIED | `phase_12_metric_registry_versions` via Supabase MCP |
| Tables verified | PASS | `metric_registry_versions` + `metric_registry_entries` exist |
| Columns verified | PASS | 6 new columns on `deal_model_snapshots` |
| Draft created | DONE | `version_name=v1`, `id=0ef4f3a3-e931-4ba0-b89e-2578e3737177` |
| Entries populated | DONE | 7 metrics, all definition_hash set |
| Published | DONE | `content_hash=89ff9255ba3b2f6bba19d2cd564bdf03eb47e6b3c6893bd1e7e10c6302c5b5f4` |
| Health verified | PENDING | Requires deployed app to hit `/api/health/model-v2` |
| Snapshot binding | PENDING | Requires `/model-v2/kick` for 3 deals |
| Replay verification | PENDING | Requires snapshots from above step |

---

## A) Production Base URL

```
https://buddytheunderwriter.com
```

- `NEXT_PUBLIC_APP_URL` in production `.env.local` is `"http://buddytheunderwriter.com"` (custom domain)
- Vercel deployment URL: `https://buddy-the-underwriter.vercel.app`
- Either works; the custom domain is canonical

---

## B) Migration — Status & Application

### B.1) Current state (verified live)

```sql
-- Tables DO NOT exist yet
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN ('metric_registry_versions', 'metric_registry_entries');
-- Result: [] (empty)

-- Snapshot binding columns DO NOT exist yet
SELECT column_name FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'deal_model_snapshots'
  AND column_name IN ('registry_version_id', 'registry_content_hash',
                      'registry_version_name', 'engine_version',
                      'compute_trace_id', 'outputs_hash');
-- Result: [] (empty)
```

### B.2) Migration file

```
supabase/migrations/20260213_metric_registry_versions.sql
```

Creates:
1. `metric_registry_versions` table (id, version_name, version_number, content_hash, status, published_at, etc.)
2. `metric_registry_entries` table (id, registry_version_id, metric_key, definition_json, definition_hash)
3. ALTER `deal_model_snapshots` — adds 6 new columns (registry_version_id, registry_content_hash, registry_version_name, engine_version, compute_trace_id, outputs_hash)
4. RLS policies: service_role only on both new tables

### B.3) Apply (via Supabase MCP or dashboard)

Apply the migration. Then verify:

```sql
-- Verify tables exist
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN ('metric_registry_versions', 'metric_registry_entries');
-- Expected: 2 rows

-- Verify snapshot binding columns
SELECT column_name, data_type FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'deal_model_snapshots'
  AND column_name IN ('registry_version_id', 'registry_content_hash',
                      'registry_version_name', 'engine_version',
                      'compute_trace_id', 'outputs_hash');
-- Expected: 6 rows
```

---

## C) Admin API Endpoints + Auth

All admin endpoints use `requireSuperAdmin()`:
- Reads Clerk session from the request (cookie `__session` or `Authorization: Bearer <token>`)
- Checks `userId` against `ADMIN_CLERK_USER_IDS` env var (comma-separated Clerk user IDs)
- Returns 401 if not authenticated, 403 if not in allowlist

### Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/admin/metric-registry/versions` | List all registry versions |
| POST | `/api/admin/metric-registry/versions` | Create a draft version |
| GET | `/api/admin/metric-registry/versions/<VERSION_ID>/entries` | List entries |
| POST | `/api/admin/metric-registry/versions/<VERSION_ID>/entries` | Upsert entries (draft only) |
| POST | `/api/admin/metric-registry/versions/<VERSION_ID>/publish` | Publish draft → immutable |
| GET | `/api/admin/deals/<DEAL_ID>/underwrite/replay?engine=v2&snapshot_id=<ID>` | Replay verification |
| GET | `/api/health/model-v2` | Health (unauthenticated) |

### Auth header (curl)

```bash
# Cookie-based (from browser session)
-b "__session=<CLERK_SESSION_TOKEN>"

# Or Bearer token
-H "Authorization: Bearer <CLERK_SESSION_TOKEN>"
```

---

## D) Exact Payload Shapes

### D.1) Create draft version

```bash
curl -X POST "$BASE/api/admin/metric-registry/versions" \
  -b "__session=$COOKIE" \
  -H "Content-Type: application/json" \
  -d '{"version_name": "v1"}'
```

Response (201):
```json
{
  "ok": true,
  "version": {
    "id": "<UUID>",
    "version_name": "v1",
    "version_number": 1,
    "content_hash": null,
    "status": "draft",
    "published_at": null,
    "created_at": "2026-02-13T...",
    "updated_at": "2026-02-13T...",
    "created_by": "<CLERK_USER_ID>"
  }
}
```

### D.2) Upsert entries

```bash
curl -X POST "$BASE/api/admin/metric-registry/versions/$VERSION_ID/entries" \
  -b "__session=$COOKIE" \
  -H "Content-Type: application/json" \
  -d @entries.json
```

Where `entries.json` is:
```json
{
  "entries": [
    {
      "metric_key": "CURRENT_RATIO",
      "definition_json": {
        "description": "Current Ratio",
        "depends_on": ["CURRENT_ASSETS", "CURRENT_LIABILITIES"],
        "formula": {"type": "divide", "left": "CURRENT_ASSETS", "right": "CURRENT_LIABILITIES"}
      }
    },
    {
      "metric_key": "DEBT_TO_EQUITY",
      "definition_json": {
        "description": "Debt-to-Equity Ratio",
        "depends_on": ["TOTAL_DEBT", "EQUITY"],
        "formula": {"type": "divide", "left": "TOTAL_DEBT", "right": "EQUITY"}
      }
    },
    {
      "metric_key": "DSCR",
      "definition_json": {
        "description": "Debt Service Coverage Ratio",
        "depends_on": ["CFADS", "DEBT_SERVICE"],
        "formula": {"type": "divide", "left": "CFADS", "right": "DEBT_SERVICE"},
        "regulatory_reference": "OCC 2020-32"
      }
    },
    {
      "metric_key": "GROSS_MARGIN",
      "definition_json": {
        "description": "Gross Margin (%)",
        "depends_on": ["GROSS_PROFIT", "REVENUE"],
        "formula": {"type": "divide", "left": "GROSS_PROFIT", "right": "REVENUE"}
      }
    },
    {
      "metric_key": "LEVERAGE",
      "definition_json": {
        "description": "Leverage Ratio (Total Debt / EBITDA)",
        "depends_on": ["TOTAL_DEBT", "EBITDA"],
        "formula": {"type": "divide", "left": "TOTAL_DEBT", "right": "EBITDA"}
      }
    },
    {
      "metric_key": "NET_MARGIN",
      "definition_json": {
        "description": "Net Income Margin (%)",
        "depends_on": ["NET_INCOME", "REVENUE"],
        "formula": {"type": "divide", "left": "NET_INCOME", "right": "REVENUE"}
      }
    },
    {
      "metric_key": "ROA",
      "definition_json": {
        "description": "Return on Assets",
        "depends_on": ["NET_INCOME", "TOTAL_ASSETS"],
        "formula": {"type": "divide", "left": "NET_INCOME", "right": "TOTAL_ASSETS"}
      }
    }
  ]
}
```

Response (200):
```json
{
  "ok": true,
  "upserted": 7,
  "entries": [
    {"id": "<UUID>", "metric_key": "CURRENT_RATIO", "definition_hash": "<64-char-hex>"},
    {"id": "<UUID>", "metric_key": "DEBT_TO_EQUITY", "definition_hash": "<64-char-hex>"},
    {"id": "<UUID>", "metric_key": "DSCR", "definition_hash": "<64-char-hex>"},
    {"id": "<UUID>", "metric_key": "GROSS_MARGIN", "definition_hash": "<64-char-hex>"},
    {"id": "<UUID>", "metric_key": "LEVERAGE", "definition_hash": "<64-char-hex>"},
    {"id": "<UUID>", "metric_key": "NET_MARGIN", "definition_hash": "<64-char-hex>"},
    {"id": "<UUID>", "metric_key": "ROA", "definition_hash": "<64-char-hex>"}
  ]
}
```

### D.3) Publish

```bash
curl -X POST "$BASE/api/admin/metric-registry/versions/$VERSION_ID/publish" \
  -b "__session=$COOKIE"
```

Response (200):
```json
{
  "ok": true,
  "version": {
    "id": "<VERSION_ID>",
    "version_name": "v1",
    "version_number": 1,
    "content_hash": "<64-char-hex-SHA256>",
    "status": "published",
    "published_at": "2026-02-13T..."
  }
}
```

---

## E) What Metrics Must Be in Registry v1

### Source of truth

The V2 model engine uses **7 metrics** loaded from the `metric_definitions` table via `loadMetricRegistry(sb, "v1")` in [metricRegistryLoader.ts](src/lib/modelEngine/metricRegistryLoader.ts).

These are the same 7 metrics already in the `metric_definitions` table in production:

| metric_key | formula | depends_on | description |
|------------|---------|------------|-------------|
| CURRENT_RATIO | CURRENT_ASSETS / CURRENT_LIABILITIES | CURRENT_ASSETS, CURRENT_LIABILITIES | Current Ratio |
| DEBT_TO_EQUITY | TOTAL_DEBT / EQUITY | TOTAL_DEBT, EQUITY | Debt-to-Equity Ratio |
| DSCR | CFADS / DEBT_SERVICE | CFADS, DEBT_SERVICE | Debt Service Coverage Ratio |
| GROSS_MARGIN | GROSS_PROFIT / REVENUE | GROSS_PROFIT, REVENUE | Gross Margin (%) |
| LEVERAGE | TOTAL_DEBT / EBITDA | TOTAL_DEBT, EBITDA | Leverage Ratio (Total Debt / EBITDA) |
| NET_MARGIN | NET_INCOME / REVENUE | NET_INCOME, REVENUE | Net Income Margin (%) |
| ROA | NET_INCOME / TOTAL_ASSETS | NET_INCOME, TOTAL_ASSETS | Return on Assets |

### Important distinction

- **Phase 12 registry** (`metric_registry_versions` + `metric_registry_entries`): NEW versioned audit system. Entries use `definition_json` (freeform JSONB with formula, depends_on, description, etc.)
- **V2 model engine** (`metric_definitions`): Existing table. Uses `FormulaNode` (`{type, left, right}`), `depends_on` array, etc. This is what the engine actually evaluates.
- **Legacy standard spread** (`src/lib/metrics/registry.ts`): 32 static metrics. Expression-based (`"NOI / TOTAL_INCOME"`). Completely separate system.

The Phase 12 registry is a **versioned audit snapshot** of metric definitions. It captures the definitions for provenance and replay verification, but it does NOT replace the model engine's `metric_definitions` table.

### One-shot publish

The 3-step API flow (create draft → upsert entries → publish) IS the one-shot method. See Section I below for the complete command sequence.

---

## F) Health Endpoint — Expected Response After Publish

```bash
curl -s https://buddytheunderwriter.com/api/health/model-v2 | jq .
```

Expected (after migration + publish):
```json
{
  "ok": true,
  "status": "healthy",
  "v2_enabled": true,
  "v2_mode": "v2_primary",
  "v2_mode_reason": "env:MODEL_ENGINE_MODE=v2_primary",
  "metric_definitions": {
    "count": 7,
    "error": null
  },
  "deal_model_snapshots": {
    "count": 0,
    "error": null
  },
  "v1_renderer_disabled": false,
  "diff_events": { "count": 0 },
  "v1_render_blocked": { "count": 0 },
  "registry": {
    "loaded": true,
    "source": "db"
  },
  "registry_versioning": {
    "activeVersionName": "v1",
    "activeContentHash": "<64-char-hex>",
    "publishedVersionsCount": 1,
    "lastPublishedAt": "2026-02-13T...",
    "replayMismatchCount24h": 0
  },
  "checked_at": "2026-02-13T..."
}
```

Key fields to validate:
- `registry_versioning.activeVersionName` == `"v1"`
- `registry_versioning.publishedVersionsCount` >= 1
- `registry_versioning.activeContentHash` is a 64-char hex string
- `registry_versioning.replayMismatchCount24h` == 0

---

## G) Snapshot Binding Verification

### G.1) Create snapshots

Trigger V2 compute for 3 deals. Use any of these endpoints:
- `GET /api/deals/<DEAL_ID>/model-v2/preview` — primary V2 compute path
- `POST /api/deals/<DEAL_ID>/model-v2/kick` — force V2 recompute

Test deal IDs (most recent in production):
```
d5c10a53-e447-4e05-b83c-fc5788f0fb36
098850d1-39bc-4c31-8244-43b41c53ca5a
0733d2da-f52c-4c93-8bae-318e7b666c10
```

```bash
for DEAL in d5c10a53-e447-4e05-b83c-fc5788f0fb36 098850d1-39bc-4c31-8244-43b41c53ca5a 0733d2da-f52c-4c93-8bae-318e7b666c10; do
  echo "--- Kicking $DEAL ---"
  curl -s -X POST "$BASE/api/deals/$DEAL/model-v2/kick" \
    -b "__session=$COOKIE" | jq '{ok, snapshotId}'
done
```

### G.2) Verify snapshot binding in DB

```sql
SELECT
  id,
  deal_id,
  registry_version_id,
  registry_content_hash,
  registry_version_name,
  engine_version,
  compute_trace_id,
  outputs_hash,
  calculated_at
FROM deal_model_snapshots
ORDER BY calculated_at DESC
LIMIT 3;
```

Expected for each row:
- `registry_version_id` IS NOT NULL (UUID of the published v1 version)
- `registry_content_hash` IS NOT NULL (64-char hex, matches `metric_registry_versions.content_hash`)
- `registry_version_name` = `'v1'`
- `outputs_hash` IS NOT NULL (64-char hex)
- `compute_trace_id` IS NOT NULL (UUID)

---

## H) Replay Verification

For each of the 3 snapshots created in step G:

```bash
SNAPSHOT_ID="<from G.2 query>"
DEAL_ID="<corresponding deal_id>"

curl -s "$BASE/api/admin/deals/$DEAL_ID/underwrite/replay?engine=v2&snapshot_id=$SNAPSHOT_ID" \
  -b "__session=$COOKIE" | jq '{
    ok,
    engine,
    registryVerification: .registryVerification,
    outputsVerification: .outputsVerification
  }'
```

Expected:
```json
{
  "ok": true,
  "engine": "v2",
  "registryVerification": {
    "status": "match",
    "snapshotHash": "<64-char-hex>",
    "currentHash": "<64-char-hex>",
    "registryVersionId": "<UUID>"
  },
  "outputsVerification": {
    "status": "match",
    "replayHash": "<64-char-hex>",
    "storedHash": "<64-char-hex>"
  }
}
```

Both `registryVerification.status` and `outputsVerification.status` must be `"match"`.

If `registryVerification.status` == `"mismatch"` → the published registry has been tampered with. Investigate.
If `outputsVerification.status` == `"mismatch"` → computation is non-deterministic. Check for floating-point or time-dependent logic.
If `registryVerification.status` == `"no_binding"` → the snapshot was created before v1 was published. Re-kick the deal and retry.

---

## I) Complete Phase 12 Ops Command List

### Prerequisites
```bash
export BASE="https://buddytheunderwriter.com"
export COOKIE="__session=<YOUR_CLERK_SESSION_TOKEN>"
```

### Step 1: Apply Migration

Apply `supabase/migrations/20260213_metric_registry_versions.sql` via Supabase dashboard or MCP.

Verify:
```sql
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN ('metric_registry_versions', 'metric_registry_entries');
-- Expected: 2 rows

SELECT column_name FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'deal_model_snapshots'
  AND column_name IN ('registry_version_id', 'registry_content_hash',
                      'registry_version_name', 'engine_version',
                      'compute_trace_id', 'outputs_hash');
-- Expected: 6 rows
```

### Step 2: Create Draft Version

```bash
curl -s -X POST "$BASE/api/admin/metric-registry/versions" \
  -b "$COOKIE" \
  -H "Content-Type: application/json" \
  -d '{"version_name": "v1"}' | jq .
```

Save the `version.id` value:
```bash
export VERSION_ID="<id from response>"
```

### Step 3: Populate Entries (7 metrics)

```bash
curl -s -X POST "$BASE/api/admin/metric-registry/versions/$VERSION_ID/entries" \
  -b "$COOKIE" \
  -H "Content-Type: application/json" \
  -d '{
  "entries": [
    {
      "metric_key": "CURRENT_RATIO",
      "definition_json": {
        "description": "Current Ratio",
        "depends_on": ["CURRENT_ASSETS", "CURRENT_LIABILITIES"],
        "formula": {"type": "divide", "left": "CURRENT_ASSETS", "right": "CURRENT_LIABILITIES"}
      }
    },
    {
      "metric_key": "DEBT_TO_EQUITY",
      "definition_json": {
        "description": "Debt-to-Equity Ratio",
        "depends_on": ["TOTAL_DEBT", "EQUITY"],
        "formula": {"type": "divide", "left": "TOTAL_DEBT", "right": "EQUITY"}
      }
    },
    {
      "metric_key": "DSCR",
      "definition_json": {
        "description": "Debt Service Coverage Ratio",
        "depends_on": ["CFADS", "DEBT_SERVICE"],
        "formula": {"type": "divide", "left": "CFADS", "right": "DEBT_SERVICE"},
        "regulatory_reference": "OCC 2020-32"
      }
    },
    {
      "metric_key": "GROSS_MARGIN",
      "definition_json": {
        "description": "Gross Margin (%)",
        "depends_on": ["GROSS_PROFIT", "REVENUE"],
        "formula": {"type": "divide", "left": "GROSS_PROFIT", "right": "REVENUE"}
      }
    },
    {
      "metric_key": "LEVERAGE",
      "definition_json": {
        "description": "Leverage Ratio (Total Debt / EBITDA)",
        "depends_on": ["TOTAL_DEBT", "EBITDA"],
        "formula": {"type": "divide", "left": "TOTAL_DEBT", "right": "EBITDA"}
      }
    },
    {
      "metric_key": "NET_MARGIN",
      "definition_json": {
        "description": "Net Income Margin (%)",
        "depends_on": ["NET_INCOME", "REVENUE"],
        "formula": {"type": "divide", "left": "NET_INCOME", "right": "REVENUE"}
      }
    },
    {
      "metric_key": "ROA",
      "definition_json": {
        "description": "Return on Assets",
        "depends_on": ["NET_INCOME", "TOTAL_ASSETS"],
        "formula": {"type": "divide", "left": "NET_INCOME", "right": "TOTAL_ASSETS"}
      }
    }
  ]
}' | jq .
```

Expected: `"upserted": 7`

### Step 4: Publish

```bash
curl -s -X POST "$BASE/api/admin/metric-registry/versions/$VERSION_ID/publish" \
  -b "$COOKIE" | jq .
```

Expected: `"status": "published"`, `"content_hash": "<64-char-hex>"`

Save the content hash:
```bash
export CONTENT_HASH="<content_hash from response>"
```

### Step 5: Verify Health

```bash
curl -s "$BASE/api/health/model-v2" | jq '.registry_versioning'
```

Expected:
```json
{
  "activeVersionName": "v1",
  "activeContentHash": "<matches CONTENT_HASH>",
  "publishedVersionsCount": 1,
  "lastPublishedAt": "2026-02-13T...",
  "replayMismatchCount24h": 0
}
```

### Step 6: Create 3 Test Snapshots

```bash
for DEAL in d5c10a53-e447-4e05-b83c-fc5788f0fb36 098850d1-39bc-4c31-8244-43b41c53ca5a 0733d2da-f52c-4c93-8bae-318e7b666c10; do
  echo "--- Kicking $DEAL ---"
  curl -s -X POST "$BASE/api/deals/$DEAL/model-v2/kick" \
    -b "$COOKIE" | jq '{ok, snapshotId}'
  echo ""
done
```

### Step 7: Verify Snapshot Bindings

```sql
SELECT id, deal_id, registry_version_id, registry_content_hash,
       registry_version_name, outputs_hash
FROM deal_model_snapshots
ORDER BY calculated_at DESC LIMIT 3;
```

All 3 rows must have non-null `registry_version_id`, `registry_content_hash`, `outputs_hash`.

### Step 8: Replay Verification (3 deals)

For each snapshot from Step 7:

```bash
# Replace DEAL_ID and SNAPSHOT_ID for each of the 3 snapshots
curl -s "$BASE/api/admin/deals/$DEAL_ID/underwrite/replay?engine=v2&snapshot_id=$SNAPSHOT_ID" \
  -b "$COOKIE" | jq '{
    ok,
    registryVerification: .registryVerification.status,
    outputsVerification: .outputsVerification.status
  }'
```

All 3 must return:
```json
{
  "ok": true,
  "registryVerification": "match",
  "outputsVerification": "match"
}
```

### Step 9: Final Health Check

```bash
curl -s "$BASE/api/health/model-v2" | jq '{
  ok,
  v2_mode: .v2_mode,
  registry_source: .registry.source,
  active_registry: .registry_versioning.activeVersionName,
  content_hash: .registry_versioning.activeContentHash,
  published_count: .registry_versioning.publishedVersionsCount,
  replay_mismatches_24h: .registry_versioning.replayMismatchCount24h,
  snapshot_count: .deal_model_snapshots.count
}'
```

Expected:
```json
{
  "ok": true,
  "v2_mode": "v2_primary",
  "registry_source": "db",
  "active_registry": "v1",
  "content_hash": "<64-char-hex>",
  "published_count": 1,
  "replay_mismatches_24h": 0,
  "snapshot_count": 3
}
```

---

## Exit Criteria Checklist

| # | Criterion | Verification |
|---|-----------|-------------|
| 1 | Migration applied | Tables exist (Step 1 SQL) |
| 2 | v1 registry published | content_hash set (Step 4 response) |
| 3 | Health shows active registry | `activeVersionName == "v1"` (Step 5) |
| 4 | 3+ snapshots bind registry | Non-null registry_version_id, outputs_hash (Step 7) |
| 5 | Replay returns match (3 deals) | registryVerification + outputsVerification == match (Step 8) |

All 5 must pass to mark Phase 12 as **COMPLETE**.
