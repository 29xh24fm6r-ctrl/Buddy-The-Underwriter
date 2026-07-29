BEGIN;

-- ============================================================
-- SPEC-SYSTEM-DEBLOAT-1 Phase B — Telemetry retention.
--
-- buddy_system_events has no retention: 296MB / 409,603 rows as of the
-- 2026-07-29 audit, ~57% of total DB size, growing ~34k rows/week
-- unbounded. franchise_sync_runs and buddy_workers have the same problem
-- at smaller scale (buddy_workers alone: 58,212 'dead' rows vs 4 'alive').
--
-- Three SECURITY DEFINER purge functions, one per table. Each deletes in
-- 10k-row batches via a ctid subquery (never a single unbounded DELETE —
-- these tables are large enough that one statement would hold a long
-- lock) with a 100ms pause between batches, and returns the total rows
-- deleted so the caller can log a result event.
--
-- pg_cron is NOT installed on this project (verified via
-- `select * from pg_extension where extname = 'pg_cron'` — 2026-07-29:
-- absent). So B1's pg_cron-schedule path does not apply; the nightly
-- worker (src/lib/nightly/telemetryRetention.ts, wired into
-- src/app/api/cron/nightly/route.ts) is the only scheduling path (B2).
--
-- EXECUTE is revoked from anon/authenticated: these are internal
-- maintenance RPCs invoked by the nightly cron job via the service-role
-- client only, never from client-side code.
--
-- Ops note for whoever applies this migration: after the first purge run
-- against buddy_system_events, run
--   VACUUM (ANALYZE) buddy_system_events;
-- manually. VACUUM cannot run inside a migration transaction (it errors
-- with "VACUUM cannot run inside a transaction block").
-- ============================================================

-- ─── purge_buddy_system_events ──────────────────────────────────────────
-- Keeps the trailing p_keep_days of buddy_system_events (default 90).
CREATE OR REPLACE FUNCTION public.purge_buddy_system_events(p_keep_days int DEFAULT 90)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total_deleted bigint := 0;
  v_batch_deleted int;
BEGIN
  LOOP
    DELETE FROM public.buddy_system_events
    WHERE ctid IN (
      SELECT ctid FROM public.buddy_system_events
      WHERE created_at < now() - make_interval(days => p_keep_days)
      LIMIT 10000
    );
    GET DIAGNOSTICS v_batch_deleted = ROW_COUNT;
    v_total_deleted := v_total_deleted + v_batch_deleted;
    EXIT WHEN v_batch_deleted = 0;
    PERFORM pg_sleep(0.1);
  END LOOP;
  RETURN v_total_deleted;
END;
$$;

REVOKE ALL ON FUNCTION public.purge_buddy_system_events(int) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.purge_buddy_system_events(int) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purge_buddy_system_events(int) TO service_role;

-- ─── purge_franchise_sync_runs ──────────────────────────────────────────
-- Keeps the trailing p_keep_days of franchise_sync_runs (default 30).
CREATE OR REPLACE FUNCTION public.purge_franchise_sync_runs(p_keep_days int DEFAULT 30)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total_deleted bigint := 0;
  v_batch_deleted int;
BEGIN
  LOOP
    DELETE FROM public.franchise_sync_runs
    WHERE ctid IN (
      SELECT ctid FROM public.franchise_sync_runs
      WHERE started_at < now() - make_interval(days => p_keep_days)
      LIMIT 10000
    );
    GET DIAGNOSTICS v_batch_deleted = ROW_COUNT;
    v_total_deleted := v_total_deleted + v_batch_deleted;
    EXIT WHEN v_batch_deleted = 0;
    PERFORM pg_sleep(0.1);
  END LOOP;
  RETURN v_total_deleted;
END;
$$;

REVOKE ALL ON FUNCTION public.purge_franchise_sync_runs(int) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.purge_franchise_sync_runs(int) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purge_franchise_sync_runs(int) TO service_role;

-- ─── purge_buddy_workers ─────────────────────────────────────────────────
-- Keeps the trailing p_keep_days of buddy_workers rows (default 30) —
-- but ONLY status = 'dead' (terminal) rows. status = 'alive' rows are
-- never purged by this function regardless of age: p_keep_days is not
-- honored for non-terminal rows because the WHERE clause hard-codes the
-- terminal status, it is not a parameter that could be widened to match
-- everything.
CREATE OR REPLACE FUNCTION public.purge_buddy_workers(p_keep_days int DEFAULT 30)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total_deleted bigint := 0;
  v_batch_deleted int;
BEGIN
  LOOP
    DELETE FROM public.buddy_workers
    WHERE ctid IN (
      SELECT ctid FROM public.buddy_workers
      WHERE status = 'dead'
        AND updated_at < now() - make_interval(days => p_keep_days)
      LIMIT 10000
    );
    GET DIAGNOSTICS v_batch_deleted = ROW_COUNT;
    v_total_deleted := v_total_deleted + v_batch_deleted;
    EXIT WHEN v_batch_deleted = 0;
    PERFORM pg_sleep(0.1);
  END LOOP;
  RETURN v_total_deleted;
END;
$$;

REVOKE ALL ON FUNCTION public.purge_buddy_workers(int) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.purge_buddy_workers(int) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purge_buddy_workers(int) TO service_role;

-- ─── Verify ──────────────────────────────────────────────────────────────
DO $$
BEGIN
  PERFORM 1 FROM pg_proc
  WHERE proname = 'purge_buddy_system_events' AND pronamespace = 'public'::regnamespace;
  IF NOT FOUND THEN RAISE EXCEPTION 'purge_buddy_system_events not created'; END IF;

  PERFORM 1 FROM pg_proc
  WHERE proname = 'purge_franchise_sync_runs' AND pronamespace = 'public'::regnamespace;
  IF NOT FOUND THEN RAISE EXCEPTION 'purge_franchise_sync_runs not created'; END IF;

  PERFORM 1 FROM pg_proc
  WHERE proname = 'purge_buddy_workers' AND pronamespace = 'public'::regnamespace;
  IF NOT FOUND THEN RAISE EXCEPTION 'purge_buddy_workers not created'; END IF;
END $$;

COMMIT;

-- Reload PostgREST schema cache so the new RPCs become callable without
-- waiting for the periodic auto-reload (~30s).
NOTIFY pgrst, 'reload schema';
