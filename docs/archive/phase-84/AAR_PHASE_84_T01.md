# AAR — Phase 84 T-01 — RLS Tenant Wall (Batch A)

**Date:** 2026-04-17
**Ticket:** T-01 (Wave 0 — Safety fence)
**Scope:** Enable RLS + service-role + tenant-scoped policies on 14 highest-risk tables
**Migration:** `supabase/migrations/20260418_phase_84_rls_tenant_wall_batch_a.sql`
**Completion event:** `buddy_system_events` id `50362ebb-549a-4724-b064-f8e7f99756a7`

---

## Pre-work (verbatim)

### Step 1 — RLS status on Batch A before migration

Query:
```sql
SELECT c.relname, c.relrowsecurity AS rls_enabled, COUNT(p.policyname) AS policy_count
FROM pg_class c
LEFT JOIN pg_policies p ON p.tablename = c.relname AND p.schemaname = 'public'
WHERE c.relname IN (
  'deal_financial_facts','deal_spreads','canonical_memo_narratives',
  'credit_memo_drafts','credit_memo_snapshots','credit_memo_citations',
  'document_artifacts','document_ocr_words','document_ocr_page_map',
  'deal_truth_events','deal_upload_sessions','deal_upload_session_files',
  'memo_runs','risk_runs'
) AND c.relkind='r'
GROUP BY c.relname, c.relrowsecurity
ORDER BY c.relname;
```

Result (verbatim):
```
canonical_memo_narratives        | false | 0
credit_memo_citations            | false | 0
credit_memo_drafts               | false | 0
credit_memo_snapshots            | false | 0
deal_financial_facts             | false | 0
deal_spreads                     | false | 0
deal_truth_events                | false | 0
deal_upload_session_files        | false | 0
deal_upload_sessions             | false | 0
document_artifacts               | false | 0
document_ocr_page_map            | false | 0
document_ocr_words               | false | 0
memo_runs                        | false | 0
risk_runs                        | false | 0
```

All 14 tables confirmed RLS disabled with zero policies.

### Step 2 — JWT `bank_id` claim verification

Query:
```sql
SELECT current_setting('request.jwt.claims', true)::jsonb->>'bank_id' AS jwt_bank_id,
       current_setting('request.jwt.claims', true) AS full_claims,
       current_user AS executing_role;
```

Result (verbatim):
```
jwt_bank_id | full_claims | executing_role
null        | null        | postgres
```

MCP runs as `postgres`, not `authenticated`, so the live claim shape cannot be read from here. Static inspection of `src/app/api/auth/supabase-jwt/route.ts:80-90` shows the Clerk→Supabase JWT minter signs these claims only: `role`, `app_user_id`, `clerk_user_id`, `email`. **No `bank_id`.** See "Dormant-policy disclosure" below.

### Step 3 — Non-service-role caller grep

Command:
```
grep -rn "createServerClient|createBrowserClient|getAuthedSupabase" src/ --include="*.ts" --include="*.tsx"
```

Result summary:
- `createServerClient` / `createBrowserClient` / `@supabase/ssr` / `@supabase/auth-helpers`: **zero matches** repo-wide.
- `getAuthedSupabase()`: 12 API route files, all under `src/app/api/deals/[dealId]/interview/sessions/*`. **None** touch any Batch A table.
- Every other API route uses `supabaseAdmin()` (service role, bypasses RLS).

**Blast radius of the `authenticated` policy on Batch A = zero for current traffic.**

### Step 4 — Tenancy model check (in addition to spec pre-work)

Production tenancy is resolved entirely in TypeScript via `ensureDealBankAccess()` + `getCurrentBankId()` in `src/lib/tenant/`, which reads `bank_memberships` via service-role keyed on `clerk_user_id`. No RLS involvement today. `bank_memberships` holds the canonical mapping (4 real rows); `bank_users` and `user_banks` are empty.

---

## Spec deviations

Four deviations from the v2 spec were discovered during execution. All four were the same root cause: the v1/v2 spec was written against assumed schemas rather than verified ones. Each deviation was committed to `specs/phase-84-audit-remediation.md` before proceeding.

### 1. `credit_memo_drafts`, `credit_memo_snapshots` reclassified to deal_only

**Symptom:** First migration attempt failed with `ERROR 42703: column "bank_id" does not exist` on `credit_memo_drafts`.

**Verification:**
```sql
SELECT table_name, ... FROM information_schema.columns WHERE column_name='bank_id' AND table_name IN (...);
```
Only 7 of the "with_bank_id" tables actually have a `bank_id` column. `credit_memo_drafts` and `credit_memo_snapshots` have `deal_id` only.

**Fix:** Moved these two tables from `tables_with_bank_id` to `tables_deal_only_uuid`. Policy intent preserved — tenant scope resolved via `deals.bank_id` EXISTS lookup instead of direct column.

**Spec commit:** `dd0c67da` — "Phase 84 T-01 — correct column classification for credit_memo_drafts, credit_memo_snapshots"

### 2. `memo_runs`, `risk_runs` use text-typed `deal_id`

**Symptom:** Second migration attempt failed with `ERROR 42883: operator does not exist: uuid = text` on `memo_runs`.

**Verification:**
```sql
SELECT table_name, column_name, data_type FROM information_schema.columns WHERE column_name='deal_id' AND table_name IN (...);
```
5 of 7 deal_only tables have `deal_id` as `uuid`. `memo_runs` and `risk_runs` have `deal_id` as `text`. Both tables are empty (0 rows), so no existing-data risk.

**Fix:** Split `tables_deal_only` into two arrays with separate loops. Uuid-typed tables use `d.id = t.deal_id`; text-typed tables use `d.id::text = t.deal_id` (cast the uuid side, always safe). If either text-typed table ever receives a non-UUID string, writes fail loudly — preferred over a silently-broken RLS check.

**Spec commit:** `0cf266da` — "Phase 84 T-01 — correct column type classification (memo_runs, risk_runs use text deal_id)"

### 3. Completion marker written to `buddy_system_events`, not `deal_events`

**Symptom:** Spec's `INSERT INTO deal_events (kind, payload, created_at) VALUES ('phase.84.t01a.completed', ...)` failed with `ERROR 23502: null value in column "deal_id"`.

**Verification:**
```sql
SELECT column_name, is_nullable FROM information_schema.columns WHERE table_name='deal_events';
```
`deal_events.deal_id` is `NOT NULL` — the table is strictly per-deal. `deal_pipeline_ledger.deal_id` and `deal_pipeline_ledger.bank_id` are both `NOT NULL` too. `buddy_system_events` has nullable `deal_id` and `bank_id` — it's the system-event surface.

**Fix:** Use `buddy_system_events` for the phase-level completion marker.

**Spec commit:** `534468f5` — "Phase 84 T-01 — write completion marker to buddy_system_events (deal_events requires deal_id)"

### 4. `event_type='deploy'` (enum constraint), `payload.kind` holds phase marker

**Symptom:** `INSERT INTO buddy_system_events ... event_type='phase.84.t01a.completed'` failed with `ERROR 23514: violates check constraint "buddy_system_events_event_type_check"`.

**Verification:**
```sql
SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid='public.buddy_system_events'::regclass AND contype='c';
-- event_type enum: error/warning/retry/recovery/success/heartbeat/deploy/stuck_job/lease_expired/suppressed
```
`'phase.84.t01a.completed'` is not in the allowed enum.

**Fix:** Use `event_type='deploy'` (semantically correct — RLS migration is a schema deployment). Move the original string to `payload.kind` so downstream queries by kind still work. Establishes convention for future phase completion markers (`'deploy'` had zero prior uses; this write is the first).

**Spec commit:** `20100c25` — "Phase 84 T-01 — completion marker uses event_type=deploy with kind in payload"

---

## Dormant-policy disclosure

The `authenticated` policy shipped in this migration is **dormant today**. Three points:

1. The `authenticated` policy references `request.jwt.claims->>'bank_id'`, which is **not currently minted** by `src/app/api/auth/supabase-jwt/route.ts` (confirmed by static inspection — the minter signs `role`, `app_user_id`, `clerk_user_id`, `email`).

2. **No production code path** currently uses an RLS-respecting Supabase client against Batch A tables (confirmed by grep — the only users of `getAuthedSupabase()` are 12 routes under `src/app/api/deals/[dealId]/interview/sessions/*`, and none touch Batch A tables).

3. **Effective current behavior:**
   - Service-role path: passes (as designed — all production traffic).
   - Authenticated role: write-only-by-matching-no-rows (no reads succeed because no minted JWT carries `bank_id`).

**Phase 84.1 follow-up ticket:** "Wire `bank_id` into Clerk JWT template OR switch `authenticated` policy to a `bank_memberships` JOIN, whichever fits the first real authenticated caller against these tables." The choice between those two deferred until an actual caller exists — a join through `bank_memberships` would add 3 hops per row check against a claim (`app_user_id`) that needs a separate lookup chain, which is premature optimization of a dormant policy.

---

## Files changed

| File | Change |
|---|---|
| `specs/phase-84-audit-remediation.md` | 4 commits (dd0c67da, 0cf266da, 534468f5, 20100c25) applying spec deviations 1-4 above. |
| `supabase/migrations/20260418_phase_84_rls_tenant_wall_batch_a.sql` | New migration file mirroring the version applied via Supabase MCP. |
| `docs/archive/phase-84/AAR_PHASE_84_T01.md` | This file. |

Migration applied via `mcp__supabase__apply_migration` with name `phase_84_rls_tenant_wall_batch_a` (return value: `{"success":true}`).

---

## Acceptance (verbatim)

### 1. Post-migration RLS status on Batch A

Query (same shape as pre-work Step 1).

Result (verbatim):
```
canonical_memo_narratives        | true | 2
credit_memo_citations            | true | 2
credit_memo_drafts               | true | 2
credit_memo_snapshots            | true | 2
deal_financial_facts             | true | 2
deal_spreads                     | true | 2
deal_truth_events                | true | 2
deal_upload_session_files        | true | 2
deal_upload_sessions             | true | 2
document_artifacts               | true | 2
document_ocr_page_map            | true | 2
document_ocr_words               | true | 2
memo_runs                        | true | 2
risk_runs                        | true | 2
```

All 14 tables: `rls_enabled=true, policy_count=2`. ✓

### 2. Advisor delta

Ran `get_advisors(type='security')`. Totals by lint name (verbatim):

```
function_search_path_mutable: 88
rls_disabled_in_public: 68
security_definer_view: 46
rls_policy_always_true: 39
rls_enabled_no_policy: 20
extension_in_public: 1
```

Pre-phase baseline per spec: 82 `rls_disabled_in_public` findings.
Post-migration: 68 findings.
**Delta: 14** — exact match to Batch A scope. ✓

Confirmed by inspecting advisor output: none of the 14 Batch A tables remain in the `rls_disabled_in_public` list.

### 3. Service-role smoke test (proxy for state route)

The spec's step 3 (`GET /api/deals/[realDealId]/state` from an authenticated browser session) cannot be executed from the MCP/CLI environment — it requires a live Clerk session cookie hitting Vercel. Substituted a **service-role read smoke test** because production API routes all use `supabaseAdmin()` (service role), and the migration preserves `service_role USING (true)` on all 14 tables. If service-role reads work, the route's reads work.

Query:
```sql
SELECT <tbl> AS tbl, COUNT(*) AS rows FROM <tbl> ...
```

Result (verbatim):
```
canonical_memo_narratives:     4 rows
credit_memo_citations:         0 rows
credit_memo_drafts:            0 rows
credit_memo_snapshots:         0 rows
deal_financial_facts:       1366 rows
deal_spreads:                 41 rows
deal_truth_events:             0 rows
deal_upload_session_files:    89 rows
deal_upload_sessions:          9 rows
document_artifacts:           89 rows
document_ocr_page_map:         0 rows
document_ocr_words:            0 rows
memo_runs:                     0 rows
risk_runs:                     0 rows
```

`deal_financial_facts` = 1366 matches spec's expected count exactly. Service-role reads are unaffected. ✓

**Follow-up flagged for human verification:** Browser-session smoke test against `GET /api/deals/[realDealId]/state` for a real Ellmann deal. Not a blocker — all production reads today use service role — but should be confirmed once by a human with a browser Clerk session to close the acceptance loop.

### 4. Completion event

Query: `INSERT INTO buddy_system_events (event_type, severity, source_system, resolution_status, payload) VALUES ('deploy', 'info', 'phase_84', 'resolved', ...) RETURNING ...`

Result (verbatim):
```
id:                 50362ebb-549a-4724-b064-f8e7f99756a7
event_type:         deploy
severity:           info
source_system:      phase_84
resolution_status:  resolved
created_at:         2026-04-17 21:15:51.195497+00
```

Row written. ✓

---

## Rollback (not exercised)

Documented in migration file. Drops all `phase84a_*` policies and disables RLS on all 14 tables. Reversible at any time.

---

## Next

T-02 — Document classifier OCR feed.
