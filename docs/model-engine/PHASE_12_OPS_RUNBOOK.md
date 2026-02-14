# Phase 12 Ops Runbook — Metric Registry Audit Mode

Code shipped: 31c4084
Remaining: Supabase migration + initial registry publish + verification

## 0) Preconditions
- Deploy containing 31c4084 is live
- Admin auth works for:
  - POST /api/admin/metric-registry/versions
  - POST /api/admin/metric-registry/versions/:id/entries
  - POST /api/admin/metric-registry/versions/:id/publish
  - GET /api/admin/deals/:dealId/underwrite/replay
- Aegis events visible (optional but ideal)

---

## 1) Run Supabase Migration
File:
- `supabase/migrations/20260213_metric_registry_versions.sql`

Action:
- Apply to production Supabase (and staging first if you have it)

Validation SQL (run after):

```sql
-- Confirm tables exist
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN ('metric_registry_versions', 'metric_registry_entries');

-- Confirm snapshot binding columns exist
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'deal_model_snapshots'
  AND column_name IN (
    'registry_version_id',
    'registry_content_hash',
    'registry_version_name',
    'engine_version',
    'compute_trace_id',
    'outputs_hash'
  );
```

---

## 2) Publish Initial Registry Version ("v1")

### 2.1 Create draft
```
POST /api/admin/metric-registry/versions
Body: { "version_name": "v1" }
```

Save the returned `id` as `REGISTRY_VERSION_ID`.

### 2.2 Populate entries

Build entry payload from the current `METRIC_REGISTRY` in `src/lib/metrics/registry.ts` (32 definitions). Each entry needs `metric_key` and `definition_json`.

```
POST /api/admin/metric-registry/versions/<REGISTRY_VERSION_ID>/entries
Body: {
  "entries": [
    {
      "metric_key": "DSCR",
      "definition_json": {
        "label": "Debt Service Coverage Ratio",
        "expr": "CASH_FLOW_AVAILABLE / ANNUAL_DEBT_SERVICE",
        "precision": 2,
        "requiredFacts": ["CASH_FLOW_AVAILABLE", "ANNUAL_DEBT_SERVICE"],
        "applicableTo": ["OPERATING_COMPANY", "REAL_ESTATE", "MIXED"],
        "version": 1
      }
    },
    ...
  ]
}
```

### 2.3 Publish
```
POST /api/admin/metric-registry/versions/<REGISTRY_VERSION_ID>/publish
```

Expected:
- `status` becomes `"published"`
- `published_at` set
- `content_hash` computed and returned

---

## 3) Verify Active Registry in Health
```
GET /api/health/model-v2
```

Expect:
- `registry_versioning.activeVersionName` == `"v1"`
- `registry_versioning.publishedVersionsCount` >= 1
- `registry_versioning.activeContentHash` is a 64-char hex string

---

## 4) Verify New Snapshots Bind Registry Fields

### 4.1 Force a snapshot
Trigger any V2 compute path:
- `GET /api/deals/:dealId/underwrite`
- `GET /api/deals/:dealId/spreads/standard`
- `POST /api/deals/:dealId/model-v2/kick`

### 4.2 Validate snapshot DB row
```sql
SELECT
  id,
  registry_version_id,
  registry_content_hash,
  registry_version_name,
  engine_version,
  compute_trace_id,
  outputs_hash
FROM deal_model_snapshots
ORDER BY calculated_at DESC
LIMIT 1;
```

Expect:
- `registry_version_id` is NOT NULL
- `registry_content_hash` is NOT NULL
- `outputs_hash` is NOT NULL

---

## 5) Replay Validation (3 deals minimum)

For each test deal:
```
GET /api/admin/deals/:dealId/underwrite/replay?engine=v2&snapshot_id=<latest_snapshot_id>
```

Expect:
- `registryVerification.status` == `"match"`
- `outputsVerification.status` == `"match"`

If mismatch:
- Confirm snapshot references correct `registry_version_id`
- Confirm `registry_content_hash` on snapshot matches computed hash from entries
- Confirm canonicalization excludes non-semantic fields consistently
- Check Aegis for `METRIC_REGISTRY_HASH_MISMATCH` or `METRIC_REGISTRY_REPLAY_MISMATCH` events

---

## 6) Post-Rollout Guardrails (Recommended)

- Alert on `METRIC_REGISTRY_HASH_MISMATCH` (should never fire if registry is immutable)
- Alert on `METRIC_REGISTRY_REPLAY_MISMATCH` count > 0 per 24h
- Freeze "publish" permissions to a small set of super admins
- Monitor health endpoint `registry_versioning.replayMismatchCount24h`

---

## Exit Criteria

Phase 12 is **COMPLETE** when:
1. Migration applied (tables exist, snapshot columns added)
2. v1 registry published (content_hash set)
3. New snapshots bind registry fields (verified on 3+ deals)
4. Replay returns `match` for all verification checks (3+ deals)
5. Health endpoint shows active registry version
