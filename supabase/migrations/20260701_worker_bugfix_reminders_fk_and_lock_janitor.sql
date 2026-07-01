-- SPEC-WORKER-BUGFIX-1
-- Two live-broken background workers, DB-side fixes, §0-verified against Buddy prod.
--
-- BUG 1 — borrower-reminders cron (PGRST200: no relationship borrower_portal_links->deals).
--   The reminder query embeds `deals!inner(...)`, which PostgREST can only resolve
--   through a real FK. borrower_portal_links has 0 FKs. §0.1 (live) confirmed the
--   table has exactly 1 row and it IS an orphan (deal_id points at a deleted deal),
--   expired 2026-01-12, never used, created_by NULL => dead data; deal_id is NOT NULL
--   so it cannot be nulled. Fix: delete the confirmed-dead orphan, then add a VALIDATED
--   FK with ON DELETE CASCADE (matches the dominant sibling convention: 175/202
--   deal-child FKs are CASCADE, incl. borrower_portal_sessions), then reload the
--   PostgREST schema cache so the embed resolves.
--
--   ⚠️ FK-INSUFFICIENT / SEPARATE FOLLOW-UP (out of this spec's DB-only scope):
--   the reminder query also selects/filters `deals.borrower_phone`, but `deals` has
--   NO such column (it has borrower_email/borrower_id/borrower_name). Borrower phone
--   actually lives in `borrower_phone_links.phone_e164`. So this FK removes the
--   PGRST200 relationship error, but the cron will then fail on a missing column until
--   the query is pointed at the correct phone source (a worker-query change, which the
--   spec excludes as a code rewrite). Tracked in the AAR — do NOT assume this migration
--   alone fully restores reminders.
--
-- BUG 2 — lock-janitor (permission denied to terminate process).
--   §0 ROOT CAUSE (confirmed live; DIFFERS from the spec's 3 hypotheses):
--   release_stale_worker_advisory_locks is already correct — owner=postgres (a member
--   of pg_signal_backend, inherited), SECURITY DEFINER, search_path set, signature
--   matches the worker (terminated_pid, released_lock_key), and the objid::bigint cast
--   (#608) is present. NONE of owner-lost-membership / definer-dropped / signature-
--   mismatch applies. The real cause: the WHERE also matches a backend owned by the
--   SUPERUSER role `supabase_admin` (transient: application_name='postgrest', idle,
--   holding an advisory lock whose objid coincidentally falls in 42001001-42001005).
--   A non-superuser (postgres) — even with pg_signal_backend — cannot terminate a
--   superuser's backend: "Only roles with the SUPERUSER attribute may terminate
--   processes of roles with the SUPERUSER attribute." That one row aborts the entire
--   RETURN QUERY, so NO stale locks get released.
--   Proven live: postgres CAN terminate the real targets (non-super `authenticator`
--   lock-holders) — a pg_cancel_backend probe on an authenticator backend returned true;
--   calling the function itself reproduced the exact superuser permission error.
--   FIX (execution, not policy): only target NON-superuser backends. Worker advisory
--   locks are always held by the non-super service_role/authenticator path; a superuser
--   holder in this objid range is a coincidental non-worker lock we must skip anyway.
--   Key range (42001001-42001005), idle threshold, returned columns, owner, and
--   SECURITY DEFINER are all UNCHANGED. A MATERIALIZED CTE guarantees the non-super
--   filter is applied BEFORE pg_terminate_backend is ever evaluated (so the planner
--   cannot reorder the volatile terminate ahead of the safety predicate).
--
-- Idempotent + transactional. NO worker-logic rewrite. Matt applies; do not self-apply.

BEGIN;

-- ============================================================================
-- BUG 1 — borrower_portal_links -> deals FK
-- ============================================================================

-- Remove the confirmed-dead orphan row(s) so a validated FK can be added.
-- (deal_id is NOT NULL, so nulling is impossible; §0.1 confirmed the single row
--  is dead: orphaned + expired + never used.)
DELETE FROM public.borrower_portal_links b
WHERE b.deal_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM public.deals d WHERE d.id = b.deal_id);

-- Add the validated FK (idempotent). ON DELETE CASCADE per sibling convention.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.borrower_portal_links'::regclass
      AND contype  = 'f'
      AND confrelid = 'public.deals'::regclass
  ) THEN
    ALTER TABLE public.borrower_portal_links
      ADD CONSTRAINT borrower_portal_links_deal_id_fkey
      FOREIGN KEY (deal_id) REFERENCES public.deals(id) ON DELETE CASCADE;
  END IF;
END $$;

-- Covering index: NOT added — borrower_portal_links_deal_id_idx (plain btree on
-- deal_id) already exists (§0.1), so no redundant index is created.

-- ============================================================================
-- BUG 2 — lock-janitor: skip superuser-owned backends
-- ============================================================================
CREATE OR REPLACE FUNCTION public.release_stale_worker_advisory_locks(
  p_idle_threshold_seconds integer DEFAULT 300
)
RETURNS TABLE(terminated_pid integer, released_lock_key bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $function$
BEGIN
  RETURN QUERY
  -- MATERIALIZED so the eligibility filter (incl. the non-superuser guard) is
  -- fully computed BEFORE pg_terminate_backend runs — the planner cannot hoist
  -- the volatile terminate ahead of the safety predicate.
  WITH stale AS MATERIALIZED (
    SELECT a.pid AS pid, l.objid::bigint AS lock_key
    FROM pg_locks l
    JOIN pg_stat_activity a ON l.pid = a.pid
    WHERE l.locktype = 'advisory'
      AND l.objid BETWEEN 42001001 AND 42001005
      AND a.application_name = 'postgrest'
      AND a.state = 'idle'
      -- Never attempt to terminate a superuser-owned backend: postgres cannot,
      -- and the error aborts the whole run. Real worker locks are held by the
      -- non-super authenticator role; a superuser holder in this objid range is
      -- a coincidental non-worker lock, correctly skipped.
      AND NOT COALESCE((SELECT r.rolsuper FROM pg_roles r WHERE r.rolname = a.usename), false)
      AND EXTRACT(EPOCH FROM (now() - a.state_change)) > p_idle_threshold_seconds
  )
  SELECT s.pid, s.lock_key
  FROM stale s
  WHERE pg_terminate_backend(s.pid);
END;
$function$;

-- CREATE OR REPLACE preserves owner (postgres) and existing grants; re-assert the
-- grant defensively (mirrors 20260701000000).
GRANT EXECUTE ON FUNCTION public.release_stale_worker_advisory_locks(integer) TO service_role;

-- Make the new borrower_portal_links -> deals FK visible to PostgREST immediately
-- so the reminder cron's `deals!inner` embed resolves without waiting for the
-- periodic auto-reload.
NOTIFY pgrst, 'reload schema';

COMMIT;

-- ============================================================================
-- POST-APPLY VERIFICATION (run on Buddy after apply)
--   Bug 1: exactly one FK + zero orphans:
--     SELECT count(*) FROM pg_constraint
--       WHERE conrelid='public.borrower_portal_links'::regclass AND contype='f'
--         AND confrelid='public.deals'::regclass;                       -- expect 1
--     SELECT count(*) FROM borrower_portal_links b WHERE b.deal_id IS NOT NULL
--       AND NOT EXISTS (SELECT 1 FROM deals d WHERE d.id=b.deal_id);     -- expect 0
--     (PGRST200 stops; but see the borrower_phone follow-up before declaring the
--      reminder cron fully healthy.)
--   Bug 2: executes cleanly (no permission-denied), returns rows or empty set:
--     SELECT * FROM release_stale_worker_advisory_locks(300);
--     Watch /api/workers/lock-janitor error cluster stop incrementing over 24h.
-- ============================================================================
