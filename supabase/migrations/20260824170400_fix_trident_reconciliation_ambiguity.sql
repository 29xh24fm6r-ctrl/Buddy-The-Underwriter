begin;

-- Golden Trident Runtime Certification repair.
-- PL/pgSQL exposes RETURNS TABLE column names as variables. Referencing
-- bundle_id in an ON CONFLICT column list therefore collided with the output
-- variable at runtime. Name the concrete primary-key constraint instead.

create or replace function public.reconcile_stale_trident_bundle_runs(
  p_limit integer default 100
)
returns table(bundle_id uuid, deal_id uuid, previous_stage text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
begin
  if p_limit < 1 or p_limit > 500 then
    raise exception 'invalid stale Trident reconciliation limit';
  end if;

  return query
  with candidates as (
    select b.id
      from public.buddy_trident_bundles b
     where b.status in ('pending', 'running')
       and (
         b.lease_expires_at < v_now
         or (
           b.lease_expires_at is null
           and coalesce(b.last_heartbeat_at, b.generation_started_at, b.generated_at)
             < v_now - interval '95 minutes'
         )
       )
     order by coalesce(
       b.lease_expires_at,
       b.last_heartbeat_at,
       b.generation_started_at,
       b.generated_at
     )
     limit p_limit
     for update skip locked
  ),
  expired as (
    update public.buddy_trident_bundles b
       set status = 'failed',
           generation_error = coalesce(
             b.generation_error,
             'Generation lease expired before completion'
           ),
           stage_error_json = coalesce(b.stage_error_json, '{}'::jsonb)
             || jsonb_build_object(
               'code', 'lease_expired',
               'stage', coalesce(b.current_stage, 'unknown'),
               'reconciled_at', v_now
             ),
           generation_completed_at = coalesce(b.generation_completed_at, v_now),
           last_heartbeat_at = v_now,
           lease_expires_at = null
      from candidates c
     where b.id = c.id
     returning b.id, b.deal_id, b.current_stage, b.input_hash
  ),
  recorded as (
    insert into public.buddy_trident_bundle_stages (
      bundle_id,
      stage,
      status,
      attempt_count,
      input_hash,
      error_json,
      completed_at,
      updated_at
    )
    select
      e.id,
      coalesce(e.current_stage, 'lease_reconciliation'),
      'failed',
      1,
      e.input_hash,
      jsonb_build_object(
        'code', 'lease_expired',
        'message', 'Generation lease expired before completion',
        'reconciled_at', v_now
      ),
      v_now,
      v_now
    from expired e
    on conflict on constraint buddy_trident_bundle_stages_pkey do update
      set status = 'failed',
          error_json = coalesce(
            public.buddy_trident_bundle_stages.error_json,
            '{}'::jsonb
          ) || excluded.error_json,
          completed_at = v_now,
          updated_at = v_now
    returning public.buddy_trident_bundle_stages.bundle_id
  )
  select e.id, e.deal_id, e.current_stage
    from expired e
    join recorded r on r.bundle_id = e.id;
end;
$$;

revoke all on function public.reconcile_stale_trident_bundle_runs(integer)
  from public, anon, authenticated;
grant execute on function public.reconcile_stale_trident_bundle_runs(integer)
  to service_role;

comment on function public.reconcile_stale_trident_bundle_runs(integer) is
  'Atomically transitions expired Golden Trident leases to failed and records terminal stage evidence.';

notify pgrst, 'reload schema';

commit;
