# AAR — Phase 84 T-10 Part B — Test-data flag on deals

**Date:** 2026-04-20
**Ticket:** T-10 Part B (Wave 4 — prerequisite for T-08 governance smoke)
**Scope:** Add `is_test` column to `deals` + flag known test data
**Migration file:** `supabase/migrations/20260420_phase_84_t10b_add_deals_is_test_flag.sql`
**Completion event:** `buddy_system_events` id `e0bcf5d4-3e57-4b67-b6d3-7499a1a7a1ce`

**Execution note:** The DDL for this ticket landed in production out-of-band via Supabase MCP `execute_sql` (not through `apply_migration`) prior to this AAR being written. The migration file now committed in the repo mirrors the applied state and is idempotent (`ADD COLUMN IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`, `UPDATE` by name match). It is NOT re-applied via `apply_migration` to avoid duplicate tracking records in Supabase's migration history.

---

## Pre-work — deals to flag (preview)

5 deals matched `ILIKE 'ChatGPT Fix%'`, all on bank `2cd15251-ecc7-452a-9a52-f8e88d23ff44` (test bank), all created `2026-04-01`:

```
ChatGPT Fix 11
ChatGPT Fix 12
ChatGPT Fix 13
ChatGPT Fix 14
ChatGPT Fix 15
```

No real deals in scope. The 4 real deals (Ellmann + 3 others) are left `is_test=false`.

---

## Migration

Idempotent 3-step DDL:

```sql
ALTER TABLE public.deals
  ADD COLUMN IF NOT EXISTS is_test boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_deals_is_test
  ON public.deals (is_test)
  WHERE is_test = false;

UPDATE public.deals
  SET is_test = true
WHERE name ILIKE 'ChatGPT Fix%';

COMMENT ON COLUMN public.deals.is_test IS
  'Test-data flag. Production dashboards and analytics queries should filter WHERE is_test = false. ...';
```

Partial index `WHERE is_test = false` minimizes storage — we expect the vast majority of queries to read real deals only, and the planner short-circuits via the partial-index match.

---

## Acceptance (verbatim)

### 1. Column definition

```sql
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema='public' AND table_name='deals' AND column_name='is_test';
```

Result:
```
column_name | data_type | is_nullable | column_default
is_test     | boolean   | NO          | false
```
✓

### 2. Distribution

```sql
SELECT is_test, COUNT(*) AS cnt FROM deals GROUP BY is_test ORDER BY is_test;
```

Result:
```
is_test | cnt
false   | 4
true    | 5
```
✓ (4 real + 5 test = 9 total)

### 3. Index exists

```sql
SELECT indexname, indexdef FROM pg_indexes
WHERE schemaname='public' AND tablename='deals' AND indexname LIKE '%is_test%';
```

Result:
```
indexname:   idx_deals_is_test
indexdef:    CREATE INDEX idx_deals_is_test ON public.deals USING btree (is_test) WHERE (is_test = false)
```
✓

### 4. ChatGPT Fix deals flagged

```sql
SELECT name, is_test, bank_id, created_at::date AS created
FROM deals WHERE name ILIKE 'ChatGPT Fix%' ORDER BY name;
```

Result:
```
ChatGPT Fix 11 | true | 2cd15251-ecc7-452a-9a52-f8e88d23ff44 | 2026-04-01
ChatGPT Fix 12 | true | 2cd15251-ecc7-452a-9a52-f8e88d23ff44 | 2026-04-01
ChatGPT Fix 13 | true | 2cd15251-ecc7-452a-9a52-f8e88d23ff44 | 2026-04-01
ChatGPT Fix 14 | true | 2cd15251-ecc7-452a-9a52-f8e88d23ff44 | 2026-04-01
ChatGPT Fix 15 | true | 2cd15251-ecc7-452a-9a52-f8e88d23ff44 | 2026-04-01
```
✓ (all 5 stamped, same bank, same day)

### 5. Completion event

```sql
SELECT id, event_type, source_system, resolution_status, payload, created_at
FROM buddy_system_events WHERE id = 'e0bcf5d4-3e57-4b67-b6d3-7499a1a7a1ce';
```

Result (payload excerpted):
```
id:                 e0bcf5d4-3e57-4b67-b6d3-7499a1a7a1ce
event_type:         deploy
source_system:      phase_84
resolution_status:  resolved
payload.kind:       phase.84.t10b.completed
payload.total_deals: 9
payload.deals_flagged_real: 4
payload.deals_flagged_test: 5
payload.note:       T-06 will extend is_test flagging to duplicate_of deals when that column is added
created_at:         2026-04-20 14:02:39.262915+00
```
✓

---

## Spec deviations

**One deviation.** v2 spec UPDATE included `OR duplicate_of IS NOT NULL`, but `duplicate_of` is a T-06 column that does not yet exist. Clause removed from this migration. Duplicate-deal flagging ownership shifted explicitly to T-06 — its migration must `UPDATE deals SET is_test=true WHERE duplicate_of IS NOT NULL` in the same transaction that adds the column. Spec corrected in `main` (see Phase 84 T-10B spec commit).

---

## Follow-ups

- **T-06 cleanup step must stamp `is_test=true` on any row whose `duplicate_of` is set.** Encoded in the spec comment on `deals.is_test`. Without this, duplicate-shell deals pollute dashboards even after T-10 Part B.
- **Phase 84.1: Audit dashboards + analytics queries to add `WHERE is_test = false`.** The index is now present; consumer queries need to actually use it. Surfaces any query that currently mixes real + test data.
- **Phase 84.1: Consider extending `is_test` flagging beyond name-based matching.** Current rule is fragile — anyone who creates a deal named "ChatGPT Fix 16" gets auto-flagged; anyone who creates a deal named "test" does not. A staging-bank allowlist (e.g., `is_test = true` if `bank_id IN (<staging banks>)`) is less fragile.

---

## Next

Wave 2 — T-06 → T-04 → T-05 in parallel per the phase execution order. T-06 first per user direction (smallest + unblocks the duplicate-flagging deferred above).
