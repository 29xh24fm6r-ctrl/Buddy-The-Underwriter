-- SPEC-TELEMETRY-PURGE-BOUNDED-1 — make the retention purge finish inside the
-- API statement timeout.
--
-- The three purge functions from 20260729000010_telemetry_retention.sql each
-- ran an UNBOUNDED `LOOP` inside a single statement: delete 10,000 rows,
-- pg_sleep(0.1), repeat until the table is clean. That works on a small
-- backlog and cannot work on a large one.
--
-- Observed in production 2026-08-27 07:30:38 UTC, the first time the nightly
-- cron actually fired:
--
--   Telemetry retention purge failed: Error: telemetry retention purge RPC
--   "purge_buddy_system_events" failed (table: buddy_system_events):
--   canceling statement due to statement timeout
--
-- buddy_system_events had 316,046 rows past retention — 32 batches, plus 3.2
-- seconds of pg_sleep alone, against `authenticator`'s statement_timeout=8s.
-- The purge could never succeed, and because runTelemetryRetentionPurge throws
-- on the first RPC error, retention had never once completed. The table grew
-- to 360 MB of a 648 MB database.
--
-- Fix: each call now does BOUNDED work in a single short statement and returns
-- how many rows it deleted. The caller loops until a call returns 0 (see
-- src/lib/nightly/telemetryRetention.ts). Batching belongs on the client side
-- of a statement timeout, not inside it.
--
-- Also drops the pg_sleep: it existed to be gentle between batches, but inside
-- a timeout budget it is pure cost. Spacing between calls is now the caller's
-- concern.
--
-- CROSS-LAYER CONTRACT — p_max_rows default MUST equal RETENTION_BATCH_SIZE in
-- src/lib/nightly/telemetryRetention.ts (currently 5000). That caller invokes
-- `sb.rpc(name)` with NO arguments, so this default IS the batch size, and its
-- parseDeletedRows() throws on any return value above RETENTION_BATCH_SIZE
-- while treating a short return as "drained". Raise one side without the other
-- and retention either fails loudly (cap too high) or silently stops draining
-- early (cap too low). Change both together.
--
-- Signatures change (a second parameter is added), so these are DROP + CREATE
-- rather than CREATE OR REPLACE — adding a defaulted parameter creates an
-- overload, and `purge_x()` against two defaulted-arg overloads is ambiguous.
-- DROP loses the ACL, so each GRANT is restated: EXECUTE to service_role only,
-- matching the pre-existing `postgres=X/postgres | service_role=X/postgres`.

-- ── buddy_system_events ─────────────────────────────────────────────────────
drop function if exists public.purge_buddy_system_events(integer);

create function public.purge_buddy_system_events(
  p_keep_days integer default 90,
  p_max_rows  integer default 5000
) returns bigint
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_deleted bigint;
begin
  delete from public.buddy_system_events
  where ctid in (
    select ctid from public.buddy_system_events
    where created_at < now() - make_interval(days => p_keep_days)
    limit greatest(p_max_rows, 1)
  );
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$function$;

revoke all on function public.purge_buddy_system_events(integer, integer) from public;
grant execute on function public.purge_buddy_system_events(integer, integer) to service_role;

-- ── buddy_workers ───────────────────────────────────────────────────────────
drop function if exists public.purge_buddy_workers(integer);

create function public.purge_buddy_workers(
  p_keep_days integer default 30,
  p_max_rows  integer default 5000
) returns bigint
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_deleted bigint;
begin
  delete from public.buddy_workers
  where ctid in (
    select ctid from public.buddy_workers
    where status = 'dead'
      and updated_at < now() - make_interval(days => p_keep_days)
    limit greatest(p_max_rows, 1)
  );
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$function$;

revoke all on function public.purge_buddy_workers(integer, integer) from public;
grant execute on function public.purge_buddy_workers(integer, integer) to service_role;

-- ── franchise_sync_runs ─────────────────────────────────────────────────────
drop function if exists public.purge_franchise_sync_runs(integer);

create function public.purge_franchise_sync_runs(
  p_keep_days integer default 30,
  p_max_rows  integer default 5000
) returns bigint
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_deleted bigint;
begin
  delete from public.franchise_sync_runs
  where ctid in (
    select ctid from public.franchise_sync_runs
    where started_at < now() - make_interval(days => p_keep_days)
    limit greatest(p_max_rows, 1)
  );
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$function$;

revoke all on function public.purge_franchise_sync_runs(integer, integer) from public;
grant execute on function public.purge_franchise_sync_runs(integer, integer) to service_role;
