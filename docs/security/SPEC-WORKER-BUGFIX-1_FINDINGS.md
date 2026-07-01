# SPEC-WORKER-BUGFIX-1 — §0 Findings & AAR

**Deliverable:** `supabase/migrations/20260701_worker_bugfix_reminders_fk_and_lock_janitor.sql`
**Status:** migration written + validated against Buddy prod in a rolled-back transaction. **NOT applied.**
Matt applies the production DDL. Draft PR; do not merge.
**§0 run against:** Buddy prod primary via the `supabase` MCP (confirmed: `current_user=postgres`,
`is_replica=false`, `cluster_name=main`, live postgREST traffic, has `deal_financial_facts` + `deals.bank_id`
+ `can_access`-style schema). NOT the Pulse/`claude_ai_Supabase` connection.

---

## Bug 1 — borrower-reminders FK

### §0.1 (live)
- `borrower_portal_links`: `deal_id uuid NOT NULL`, **0 FKs**, **1 row**, and that row **IS the orphan**
  (`deal_id=ea7fa820-…` points at a deleted deal). It is expired (`expires_at 2026-01-12`, ~6 months ago),
  never used (`used_at NULL`), `created_by NULL` → **dead data**.
- `deal_id` is **NOT NULL** → the orphan cannot be nulled (spec option (a)-null is impossible).
- Covering index already exists: `borrower_portal_links_deal_id_idx` (plain btree on `deal_id`) → **no index
  added** (avoids redundancy).
- Sibling deal-child FK ON DELETE convention: **CASCADE dominates 175/202**; `borrower_portal_sessions`
  (the borrower-portal sibling) is CASCADE → new FK uses **ON DELETE CASCADE**.

### §0.2 (code)
`src/lib/reminders/selectCandidates.ts` runs via `supabaseAdmin()` (service_role) and uses a PostgREST
embedded resource: `.select('… deals!inner (id, name, borrower_phone)')` + `.not('deals.borrower_phone',
'is', null)`. The `deals!inner` embed can only resolve through a **real FK** → the fix is the FK, not a code
rewrite (and the FK benefits every other consumer). ✔ matches spec.

### Fix applied (migration)
Delete the confirmed-dead orphan → add **validated** `borrower_portal_links_deal_id_fkey FK (deal_id) →
deals(id) ON DELETE CASCADE` (idempotent guard) → `NOTIFY pgrst, 'reload schema'` so the embed resolves
(R2). Validated in a rolled-back txn: FK count 1, orphans 0.

### 🚩 Additional finding (out of spec scope — needs a decision)
The FK removes the **PGRST200 relationship** error, but the reminder query also selects/filters
**`deals.borrower_phone`, which does not exist on `deals`** (it has `borrower_email` / `borrower_id` /
`borrower_name`). Borrower phone actually lives in **`borrower_phone_links.phone_e164`**. So after the FK,
the cron will fail on a missing column until the query is pointed at the correct phone source. That is a
**worker-query change**, which this spec explicitly excludes ("not a code rewrite"). **The FK alone does NOT
fully restore reminders** — do not assume so. Follow-up options: (a) repoint the query to
`borrower_phone_links.phone_e164`, or (b) add/populate `deals.borrower_phone`. Surfaced here rather than
absorbed.

---

## Bug 2 — lock-janitor "permission denied to terminate process"

### The spec's 3 hypotheses are ALL disproven on live inspection
`release_stale_worker_advisory_locks(integer)` is **already correct**:
owner=`postgres`, `SECURITY DEFINER`=true, `search_path=public, pg_catalog`, returns
`TABLE(terminated_pid integer, released_lock_key bigint)` (matches the worker's expected columns), and the
`l.objid::bigint` cast from #608 is present. So: owner did NOT lose membership, definer was NOT dropped,
signature does NOT mismatch. (`GRANT pg_signal_backend TO postgres` is a no-op — confirmed: postgres **is** a
member and **inherits** the privilege: `pg_has_role('postgres','pg_signal_backend','USAGE')=true`,
`rolinherit=true`.)

### Timeline (matches the audit exactly)
`20260701000001` (objid→bigint cast, commit **cc1248cb / PR #608, 2026-06-30 09:30 UTC**) is the deploy that
"flipped" the error. Before it, the function threw the `1640 structure of query does not match function
result type` at `RETURN QUERY` (stopped **06-30 09:30:46Z**). The cast let the query finally *evaluate*,
reaching `pg_terminate_backend(a.pid)` — which now throws the **`permission denied`** variant (started
**06-30 09:40:21Z**, **still firing, last 2026-07-01 20:25:09Z**, count 257 — verified in Vercel prod runtime
errors).

### ROOT CAUSE (confirmed, differs from all spec hypotheses)
The error DETAIL is definitive:
> `permission denied to terminate process` — *"Only roles with the SUPERUSER attribute may terminate
> processes of roles with the SUPERUSER attribute."*

The janitor's `WHERE` matches a backend owned by the **SUPERUSER** role `supabase_admin` (the only superuser
on the DB) — transient, `application_name='postgrest'`, idle, holding an advisory lock whose `objid`
coincidentally falls in `42001001–42001005`. A non-superuser (postgres), **even with `pg_signal_backend`**,
cannot terminate a superuser's backend. That single row makes `RETURN QUERY` raise, so **no** stale locks are
released. It is a **target-side privilege limit + an over-broad filter**, not a function-config problem.

Proven live:
- postgres **can** terminate the real targets — a `pg_cancel_backend()` probe (same `pg_signal_backend`
  check, no-op on idle) on an `authenticator` backend returned **true**; the current lock-holders are
  `authenticator` (non-super).
- Calling `release_stale_worker_advisory_locks(1)` directly **reproduced** the exact superuser permission
  error. *(Side effect note: that live call may have terminated 0–2 idle `authenticator` postgrest pool
  connections before erroring — harmless; the pool self-heals; it is the janitor's normal designed action.)*

### Fix applied (migration) — "fix execution, not policy"
`CREATE OR REPLACE` the function with the WHERE gaining a **non-superuser guard**
(`AND NOT COALESCE((SELECT rolsuper FROM pg_roles WHERE rolname = a.usename), false)`), inside a
`WITH … AS MATERIALIZED` CTE so the guard is evaluated **before** `pg_terminate_backend` (the planner cannot
hoist the volatile terminate ahead of the safety predicate). Everything else — key range `42001001–42001005`,
idle threshold, returned columns, owner=postgres, `SECURITY DEFINER`, `search_path` — **unchanged**. Skipping
superuser holders loses nothing: real worker locks are held by the non-super `authenticator` path; a
superuser holder in this `objid` range is a coincidental non-worker lock. Validated (function replaced,
`rolsuper` guard present) in a rolled-back txn.

---

## Scope deviations (surfaced, not absorbed)
1. **Bug 2 cause differs from the spec.** Spec anticipated owner/definer/signature; the live cause is a
   **superuser-owned target** matching the filter. Fix matched to the confirmed cause per §0.4's own
   instruction ("report the finding before writing the fix; the fix depends on the cause").
2. **Bug 2 fix is a WHERE-clause guard (+ MATERIALIZED CTE)**, not an `ALTER FUNCTION … OWNER`/`SECURITY
   DEFINER` change — because owner/definer are already correct. No `GRANT pg_signal_backend` (proven no-op).
3. **Bug 1 needs a second, separate fix** (`deals.borrower_phone` does not exist → query must use
   `borrower_phone_links.phone_e164`). Left as a follow-up (worker-query change is out of this spec's DB-only
   scope). The FK alone does not fully restore the reminder cron.

## Verification performed
- Whole migration executed on Buddy prod inside a **rolled-back** transaction: FK count 1, orphans 0, rows
  left 0, janitor `rolsuper` guard present. Prod re-checked afterward — unchanged (orphan row intact, 0 FKs,
  old function). No persistent change made.
- Post-apply queries embedded at the bottom of the migration for Matt.
