-- SPEC-NIGHTLY-GOVERNANCE-CONVERGENCE
--
-- Each retention RPC used to loop until the table was fully drained. PostgREST
-- executes one RPC call as one statement/transaction, so the first production
-- run exceeded statement_timeout and prevented the later tables from running.
-- Make each invocation a bounded, independently committed batch. The nightly
-- worker owns repetition, duration limits, and progress evidence.

CREATE OR REPLACE FUNCTION public.purge_buddy_system_events(p_keep_days int DEFAULT 90)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deleted int;
BEGIN
  DELETE FROM public.buddy_system_events
  WHERE ctid IN (
    SELECT ctid
    FROM public.buddy_system_events
    WHERE created_at < now() - make_interval(days => p_keep_days)
    LIMIT 1000
  );
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

CREATE OR REPLACE FUNCTION public.purge_franchise_sync_runs(p_keep_days int DEFAULT 30)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deleted int;
BEGIN
  DELETE FROM public.franchise_sync_runs
  WHERE ctid IN (
    SELECT ctid
    FROM public.franchise_sync_runs
    WHERE started_at < now() - make_interval(days => p_keep_days)
    LIMIT 1000
  );
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

CREATE OR REPLACE FUNCTION public.purge_buddy_workers(p_keep_days int DEFAULT 30)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deleted int;
BEGIN
  DELETE FROM public.buddy_workers
  WHERE ctid IN (
    SELECT ctid
    FROM public.buddy_workers
    WHERE status = 'dead'
      AND updated_at < now() - make_interval(days => p_keep_days)
    LIMIT 1000
  );
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

REVOKE ALL ON FUNCTION public.purge_buddy_system_events(int) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.purge_franchise_sync_runs(int) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.purge_buddy_workers(int) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.purge_buddy_system_events(int) TO service_role;
GRANT EXECUTE ON FUNCTION public.purge_franchise_sync_runs(int) TO service_role;
GRANT EXECUTE ON FUNCTION public.purge_buddy_workers(int) TO service_role;

NOTIFY pgrst, 'reload schema';
