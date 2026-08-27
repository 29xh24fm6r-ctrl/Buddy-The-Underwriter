BEGIN;

-- Replace all-or-nothing retention transactions with one bounded delete per
-- RPC call. The nightly application owns the per-run cap and invokes each RPC
-- repeatedly, so every successful 5,000-row batch commits before the next one.

CREATE OR REPLACE FUNCTION public.purge_buddy_system_events(
  p_keep_days int DEFAULT 90
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_deleted bigint := 0;
BEGIN
  IF p_keep_days IS NULL OR p_keep_days < 1 THEN
    RAISE EXCEPTION 'p_keep_days must be a positive integer';
  END IF;

  DELETE FROM public.buddy_system_events
   WHERE ctid IN (
     SELECT ctid
       FROM public.buddy_system_events
      WHERE created_at < now() - make_interval(days => p_keep_days)
      LIMIT 5000
   );
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

CREATE OR REPLACE FUNCTION public.purge_franchise_sync_runs(
  p_keep_days int DEFAULT 30
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_deleted bigint := 0;
BEGIN
  IF p_keep_days IS NULL OR p_keep_days < 1 THEN
    RAISE EXCEPTION 'p_keep_days must be a positive integer';
  END IF;

  DELETE FROM public.franchise_sync_runs
   WHERE ctid IN (
     SELECT ctid
       FROM public.franchise_sync_runs
      WHERE started_at < now() - make_interval(days => p_keep_days)
      LIMIT 5000
   );
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

CREATE OR REPLACE FUNCTION public.purge_buddy_workers(
  p_keep_days int DEFAULT 30
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_deleted bigint := 0;
BEGIN
  IF p_keep_days IS NULL OR p_keep_days < 1 THEN
    RAISE EXCEPTION 'p_keep_days must be a positive integer';
  END IF;

  DELETE FROM public.buddy_workers
   WHERE ctid IN (
     SELECT ctid
       FROM public.buddy_workers
      WHERE status = 'dead'
        AND updated_at < now() - make_interval(days => p_keep_days)
      LIMIT 5000
   );
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

REVOKE ALL ON FUNCTION public.purge_buddy_system_events(int)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.purge_franchise_sync_runs(int)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.purge_buddy_workers(int)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.purge_buddy_system_events(int)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.purge_franchise_sync_runs(int)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.purge_buddy_workers(int)
  TO service_role;

COMMENT ON FUNCTION public.purge_buddy_system_events(int) IS
  'Service-role-only retention step; deletes at most 5,000 expired system events per committed RPC call.';
COMMENT ON FUNCTION public.purge_franchise_sync_runs(int) IS
  'Service-role-only retention step; deletes at most 5,000 expired sync runs per committed RPC call.';
COMMENT ON FUNCTION public.purge_buddy_workers(int) IS
  'Service-role-only retention step; deletes at most 5,000 expired dead workers per committed RPC call.';

COMMIT;

NOTIFY pgrst, 'reload schema';
