-- Close anon/authenticated EXECUTE on the destructive purge functions.
--
-- 20250917_bounded_nightly_work revoked these for signature purge_*(int).
-- The functions were later redefined as (p_keep_days int, p_max_rows int).
-- In Postgres that is a different object, created with the default PUBLIC
-- EXECUTE grant — so anon and authenticated could call three SECURITY DEFINER
-- functions that delete rows (buddy_system_events, buddy_workers,
-- franchise_sync_runs) straight through PostgREST RPC with the publishable key.
--
-- Only the nightly retention job calls these, and it runs as service_role.
revoke all on function public.purge_buddy_system_events(int, int) from public, anon, authenticated;
revoke all on function public.purge_buddy_workers(int, int) from public, anon, authenticated;
revoke all on function public.purge_franchise_sync_runs(int, int) from public, anon, authenticated;

grant execute on function public.purge_buddy_system_events(int, int) to service_role;
grant execute on function public.purge_buddy_workers(int, int) to service_role;
grant execute on function public.purge_franchise_sync_runs(int, int) to service_role;
