# Checklist Engine v2 - Quickstart

## What's New in v2 🚀

**Year-aware satisfaction** - checklist items marked "received" ONLY when year requirements met.

### The Problem (v1)
```bash
# Upload PTR 2023.pdf → IRS_PERSONAL_2Y shows "Received" ✅
# Problem: Requirement is 2 years, but only 1 year present!
```

### The Solution (v2)
```bash
# Upload PTR 2023.pdf → IRS_PERSONAL_2Y shows "Years: 2023 (1/2)" ⚠️
# Upload PTR 2022.pdf → IRS_PERSONAL_2Y shows "Years: 2023, 2022 (2/2)" ✅
```

---

## Quick Test

```bash
# 1. Apply migration
psql $DATABASE_URL -f supabase/migrations/20251231193000_checklist_engine_v2_year_satisfaction.sql

# 2. Upload first year
curl -F "file=@PTR_2023.pdf" http://localhost:3000/api/deals/DEAL_ID/files/upload

# 3. Check checklist
psql $DATABASE_URL -c "SELECT checklist_key, satisfied_at, satisfaction_json FROM deal_checklist_items WHERE deal_id = 'DEAL_ID' AND checklist_key = 'IRS_PERSONAL_2Y';"

# Expected output:
# checklist_key    | satisfied_at | satisfaction_json
# -----------------+--------------+-------------------
# IRS_PERSONAL_2Y  | NULL         | {"years": [2023], "year_count": 1, "requires_years": 2, "satisfied": false}

# 4. Upload second year
curl -F "file=@PTR_2022.pdf" http://localhost:3000/api/deals/DEAL_ID/files/upload

# 5. Check again
psql $DATABASE_URL -c "SELECT checklist_key, satisfied_at, satisfaction_json FROM deal_checklist_items WHERE deal_id = 'DEAL_ID' AND checklist_key = 'IRS_PERSONAL_2Y';"

# Expected output:
# checklist_key    | satisfied_at          | satisfaction_json
# -----------------+----------------------+-------------------
# IRS_PERSONAL_2Y  | 2025-12-31 10:46:00  | {"years": [2023, 2022], "year_count": 2, "requires_years": 2, "satisfied": true}
```

---

## Key Behavioral Changes

| Scenario | v1 Behavior | v2 Behavior |
|----------|-------------|-------------|
| Upload PTR 2023.pdf | status = "received" ✅ | status = "missing" (1/2 years) ⚠️ |
| Upload PTR 2023 + 2022 | status = "received" ✅ | status = "received" ✅ |
| Upload PTR 2023 twice | status = "received" ✅ | status = "missing" (1 distinct year) ⚠️ |
| Upload PFS.pdf (no year req) | status = "received" ✅ | status = "received" ✅ |

---

## What Gets Tracked

### New `deal_documents` Fields

```sql
SELECT id, original_filename, checklist_key, doc_year, match_confidence, match_reason
FROM deal_documents WHERE deal_id = 'DEAL_ID';
```

Example output:
```
id   | original_filename      | checklist_key   | doc_year | match_confidence | match_reason
-----+------------------------+-----------------+----------+------------------+-----------------
123  | PTR 2023 Halaby.pdf    | IRS_PERSONAL_2Y | 2023     | 0.90             | Personal return token
456  | PTR 2022 Halaby.pdf    | IRS_PERSONAL_2Y | 2022     | 0.90             | Personal return token
789  | Personal Fin Stmt.pdf  | PFS_CURRENT     | NULL     | 0.80             | PFS pattern
```

### New `deal_checklist_items` Fields

```sql
SELECT checklist_key, received_at, satisfied_at, satisfaction_json
FROM deal_checklist_items WHERE deal_id = 'DEAL_ID';
```

Example output:
```json
{
  "checklist_key": "IRS_PERSONAL_2Y",
  "received_at": "2025-12-31T10:45:00Z",  // First doc uploaded
  "satisfied_at": "2025-12-31T10:46:00Z",  // Second year uploaded
  "satisfaction_json": {
    "requires_years": 2,
    "years": [2023, 2022],
    "year_count": 2,
    "satisfied": true
  }
}
```

---

## UI Changes

### Before (v1)
```
✅ Personal tax returns (last 2 years)
   Key: IRS_PERSONAL_2Y
   Received: Dec 31, 10:45 AM
```

### After (v2)
```
✅ Personal tax returns (last 2 years)
   Key: IRS_PERSONAL_2Y Years: 2023, 2022 (2/2)
   Received: Dec 31, 10:45 AM
```

**Pending state (1 year uploaded)**:
```
⚠️ Personal tax returns (last 2 years)
   Key: IRS_PERSONAL_2Y Years: 2023 (1/2)
```

---

## Backfill Existing Deals

For deals created before v2 (docs already uploaded):

```bash
# Run backfill endpoint per deal
curl -X POST "http://localhost:3000/api/admin/deals/DEAL_ID/checklist/backfill-years?token=$ADMIN_DEBUG_TOKEN"

# Response:
{
  "ok": true,
  "updated": 6  // Number of docs that got doc_year extracted
}

# Triggers will automatically recompute satisfaction
```

**Bulk script** (for all deals):
```bash
#!/bin/bash
DEAL_IDS=$(psql $DATABASE_URL -t -c "SELECT DISTINCT deal_id FROM deal_documents WHERE doc_year IS NULL LIMIT 100;")

for DEAL_ID in $DEAL_IDS; do
  echo "Backfilling $DEAL_ID..."
  curl -X POST "http://localhost:3000/api/admin/deals/$DEAL_ID/checklist/backfill-years?token=$ADMIN_DEBUG_TOKEN"
done
```

---

## Satisfaction Rules

Current rules (seeded by migration):

```sql
SELECT * FROM deal_checklist_rules;
```

Output:
```
checklist_key    | requires_years
-----------------+---------------
IRS_BUSINESS_2Y  | 2
IRS_PERSONAL_2Y  | 2
BTR_2Y           | 2
```

**Add new rule**:
```sql
INSERT INTO deal_checklist_rules (checklist_key, requires_years)
VALUES ('BANK_STMT_12M', 12);  -- Future: 12 months of bank statements
```

---

## Debugging Commands

### Check satisfaction computation
```sql
SELECT public._checklist_compute_satisfaction('DEAL_ID'::uuid, 'IRS_PERSONAL_2Y');
```

Example result:
```json
{
  "checklist_key": "IRS_PERSONAL_2Y",
  "requires_years": 2,
  "doc_count": 2,
  "years": [2023, 2022],
  "year_count": 2,
  "satisfied": true
}
```

### Find unsatisfied items
```sql
SELECT checklist_key, satisfaction_json
FROM deal_checklist_items
WHERE deal_id = 'DEAL_ID'
  AND satisfied_at IS NULL
  AND required = true;
```

### Find docs with no year extracted
```sql
SELECT id, original_filename, checklist_key
FROM deal_documents
WHERE deal_id = 'DEAL_ID'
  AND checklist_key IN ('IRS_PERSONAL_2Y', 'IRS_BUSINESS_2Y', 'BTR_2Y')
  AND doc_year IS NULL;
```

**Manual fix**:
```sql
-- Set year manually
UPDATE deal_documents SET doc_year = 2023 WHERE id = 'DOC_ID';
-- Trigger will recompute satisfaction automatically
```

---

## Rollback Plan

If v2 causes issues:

```sql
-- 1. Drop v2 triggers
DROP TRIGGER IF EXISTS deal_documents_checklist_satisfaction_ins ON deal_documents;
DROP TRIGGER IF EXISTS deal_documents_checklist_satisfaction_upd ON deal_documents;

-- 2. Restore v1 triggers
-- (Re-apply: supabase/migrations/20251231190000_checklist_engine_v1_triggers.sql)

-- 3. Optional: Drop v2 columns (can keep for future re-enable)
ALTER TABLE deal_documents DROP COLUMN IF EXISTS doc_year;
ALTER TABLE deal_checklist_items DROP COLUMN IF EXISTS satisfied_at;
```

**Estimated time**: <2 minutes (no data loss)

---

## Common Issues

### Issue: "Years: (0/2)" shows after upload

**Cause**: Filename has no year (e.g., "Personal Tax Return.pdf")

**Fix**:
```sql
-- Set year manually
UPDATE deal_documents SET doc_year = 2023 WHERE id = 'DOC_ID';
```

### Issue: "Years: 2023 (1/1)" when requirement is 2

**Cause**: Rule not seeded (missing from `deal_checklist_rules`)

**Fix**:
```sql
INSERT INTO deal_checklist_rules (checklist_key, requires_years)
VALUES ('YOUR_KEY', 2);

-- Trigger reconciliation
SELECT public._checklist_apply_satisfaction('DEAL_ID'::uuid, 'YOUR_KEY', 'DOC_ID'::uuid);
```

### Issue: Upload 2 years but still shows (1/2)

**Cause**: Both docs have same `doc_year` (duplicate year)

**Debug**:
```sql
SELECT doc_year, COUNT(*)
FROM deal_documents
WHERE deal_id = 'DEAL_ID' AND checklist_key = 'IRS_PERSONAL_2Y'
GROUP BY doc_year;
```

**Fix**: Update one doc to correct year.

---

## Next Steps

1. **Test in staging**: Upload PTR 2023 + 2022, verify satisfaction
2. **Monitor triggers**: Check `pg_stat_statements` for execution time
3. **Run backfill**: Execute backfill endpoint for existing deals
4. **Review UI**: Confirm year coverage displays correctly
5. **Expand rules**: Add new checklist keys to rules table as needed

---

## API Endpoints Summary

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/deals/[dealId]/checklist/list` | GET | Returns items with `satisfied_at` + `satisfaction_json` |
| `/api/deals/[dealId]/checklist/doc-summary` | GET | Returns `counts` + `years` per key |
| `/api/deals/[dealId]/checklist/reconcile` | POST | Re-runs matcher, updates `doc_year` |
| `/api/admin/deals/[dealId]/checklist/backfill-years` | POST | One-time backfill for existing docs |

---

## Files Changed (11 total)

**Database**:
- Migration: `supabase/migrations/20251231193000_checklist_engine_v2_year_satisfaction.sql`

**Core Engine** (3 files):
- `src/lib/checklist/types.ts` - Added `docYear`, `yearsFound`, `source` to `MatchResult`
- `src/lib/checklist/matchers.ts` - Added year extraction logic
- `src/lib/checklist/engine.ts` - Updated to handle `doc_year`

**API Routes** (4 files):
- `src/app/api/deals/[dealId]/files/record/route.ts` - Write match metadata
- `src/app/api/portal/upload/commit/route.ts` - Same
- `src/app/api/deals/[dealId]/checklist/list/route.ts` - Return `satisfied_at`
- `src/app/api/deals/[dealId]/checklist/doc-summary/route.ts` - Return `years`
- `src/app/api/admin/deals/[dealId]/checklist/backfill-years/route.ts` - **New**

**UI** (1 file):
- `src/components/deals/EnhancedChecklistCard.tsx` - Show year coverage

---

**PR**: https://github.com/29xh24fm6r-ctrl/Buddy-The-Underwriter/pull/new/feat/checklist-engine-v2  
**Full docs**: [CHECKLIST_ENGINE_V2_COMPLETE.md](./CHECKLIST_ENGINE_V2_COMPLETE.md)  
**Ship date**: December 31, 2025
