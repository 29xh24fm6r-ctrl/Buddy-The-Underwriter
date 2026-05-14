-- SPEC-ADVISORY-LOCK-XACT-MIGRATION-1
-- Replace session-scoped pg_try_advisory_lock with transaction-scoped
-- pg_try_advisory_xact_lock to eliminate connection-pool lock leaks.
--
-- Background: pg_try_advisory_lock is session-scoped. The supabase-js client
-- does not pin a single connection across two RPC calls (lock + unlock). So
-- the unlock often routes to a different pool connection than the one
-- holding the lock. Lock counts accumulate on individual pool connections
-- until every cron tick skips with `lock_not_acquired`.
--
-- Fix: wrap each worker's claim path in a single PL/pgSQL function that
-- uses pg_try_advisory_xact_lock. The lock is auto-released at function
-- COMMIT. No manual unlock needed. No connection-pinning required.
--
-- Scope (per user decision documented in spec hand-off):
--   Migrated to xact-lock here: doc-extraction, intake-outbox (workers with
--   pre-existing claim RPCs). Pulse-outbox, ledger-forwarder, and
--   spreads-worker continue to use session-scoped withWorkerAdvisoryLock —
--   the janitor below releases any locks they leak.
--
-- Lock keys (unchanged):
--   pulse outbox forwarder         42001001
--   doc extraction outbox          42001002
--   intake outbox                  42001003
--   deal pipeline ledger forwarder 42001004
--   spreads worker / monitor       42001005

-- ─── claim_doc_extraction_with_xact_lock ────────────────────────────────
-- Wraps the pre-existing claim_doc_extraction_outbox_batch (FOR UPDATE
-- SKIP LOCKED claim). The advisory lock is held only for the duration of
-- this function — released at COMMIT (function exit). Concurrent invocations
-- get false for the lock and return one sentinel row with lock_acquired=false.
CREATE OR REPLACE FUNCTION public.claim_doc_extraction_with_xact_lock(
  p_claim_owner text,
  p_claim_ttl_seconds integer,
  p_limit integer
)
RETURNS TABLE (
  id uuid,
  deal_id uuid,
  bank_id uuid,
  payload jsonb,
  attempts integer,
  lock_acquired boolean
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_acquired boolean;
BEGIN
  v_acquired := pg_try_advisory_xact_lock(42001002);

  IF NOT v_acquired THEN
    -- Sentinel row distinguishes "lock not acquired" from "no work to claim".
    RETURN QUERY
    SELECT NULL::uuid, NULL::uuid, NULL::uuid, NULL::jsonb, NULL::integer, false;
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    c.id, c.deal_id, c.bank_id, c.payload, c.attempts, true AS lock_acquired
  FROM claim_doc_extraction_outbox_batch(p_claim_owner, p_claim_ttl_seconds, p_limit) c;
END;
$$;

GRANT EXECUTE ON FUNCTION public.claim_doc_extraction_with_xact_lock(text, integer, integer) TO service_role;

-- ─── claim_intake_outbox_with_xact_lock ─────────────────────────────────
-- Wraps the pre-existing claim_intake_outbox_batch RPC defined in
-- 20260226000000_claim_intake_outbox_rpc.sql.
CREATE OR REPLACE FUNCTION public.claim_intake_outbox_with_xact_lock(
  p_claim_owner text,
  p_claim_ttl_seconds integer,
  p_limit integer
)
RETURNS TABLE (
  id uuid,
  deal_id uuid,
  bank_id uuid,
  payload jsonb,
  attempts integer,
  lock_acquired boolean
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_acquired boolean;
BEGIN
  v_acquired := pg_try_advisory_xact_lock(42001003);

  IF NOT v_acquired THEN
    RETURN QUERY
    SELECT NULL::uuid, NULL::uuid, NULL::uuid, NULL::jsonb, NULL::integer, false;
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    c.id, c.deal_id, c.bank_id, c.payload, c.attempts, true AS lock_acquired
  FROM claim_intake_outbox_batch(p_claim_owner, p_claim_ttl_seconds, p_limit) c;
END;
$$;

GRANT EXECUTE ON FUNCTION public.claim_intake_outbox_with_xact_lock(text, integer, integer) TO service_role;

-- ─── Lock janitor: release_stale_worker_advisory_locks ──────────────────
-- Belt-and-suspenders for any worker still using session-scoped advisory
-- locks (pulse-outbox, ledger-forwarder, spreads-worker remain on the old
-- pattern under this spec's scope). Identifies postgrest pool connections
-- holding any of our 5 worker advisory lock keys that have been idle
-- > p_idle_threshold_seconds and terminates them. Terminating a connection
-- releases its session-scoped locks as a side effect.
--
-- Defensive bounds:
--   - Only release locks in our key range (42001001-42001005). Other
--     code paths may use advisory locks legitimately.
--   - Only target connections whose application_name = 'postgrest'.
--   - Only target idle connections (state = 'idle').
CREATE OR REPLACE FUNCTION public.release_stale_worker_advisory_locks(
  p_idle_threshold_seconds integer DEFAULT 300
)
RETURNS TABLE (
  terminated_pid integer,
  released_lock_key bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  RETURN QUERY
  SELECT
    a.pid AS terminated_pid,
    l.objid AS released_lock_key
  FROM pg_locks l
  JOIN pg_stat_activity a ON l.pid = a.pid
  WHERE l.locktype = 'advisory'
    AND l.objid BETWEEN 42001001 AND 42001005
    AND a.application_name = 'postgrest'
    AND a.state = 'idle'
    AND EXTRACT(EPOCH FROM (now() - a.state_change)) > p_idle_threshold_seconds
    AND pg_terminate_backend(a.pid);
END;
$$;

GRANT EXECUTE ON FUNCTION public.release_stale_worker_advisory_locks(integer) TO service_role;

-- ─── Verification ──────────────────────────────────────────────────────
DO $$
BEGIN
  PERFORM 1 FROM pg_proc
  WHERE proname = 'claim_doc_extraction_with_xact_lock'
    AND pronamespace = 'public'::regnamespace;
  IF NOT FOUND THEN RAISE EXCEPTION 'claim_doc_extraction_with_xact_lock not created'; END IF;

  PERFORM 1 FROM pg_proc
  WHERE proname = 'claim_intake_outbox_with_xact_lock'
    AND pronamespace = 'public'::regnamespace;
  IF NOT FOUND THEN RAISE EXCEPTION 'claim_intake_outbox_with_xact_lock not created'; END IF;

  PERFORM 1 FROM pg_proc
  WHERE proname = 'release_stale_worker_advisory_locks'
    AND pronamespace = 'public'::regnamespace;
  IF NOT FOUND THEN RAISE EXCEPTION 'release_stale_worker_advisory_locks not created'; END IF;
END $$;

-- Reload PostgREST schema cache so the new RPCs become callable without
-- waiting for the periodic auto-reload (~30s).
NOTIFY pgrst, 'reload schema';
