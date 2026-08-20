-- Golden Trident atomic lease and publication contract.
-- A stale workflow can no longer mutate or resurrect a replaced bundle.

alter table public.buddy_trident_bundles
  add column if not exists lease_token uuid,
  add column if not exists lease_expires_at timestamptz,
  add column if not exists snapshot_manifest_json jsonb,
  add column if not exists memo_input_hash text;

drop function if exists public.acquire_trident_bundle_run(uuid,text,text);
create function public.acquire_trident_bundle_run(
  p_deal_id uuid,
  p_mode text,
  p_input_hash text,
  p_memo_input_hash text,
  p_snapshot_manifest_json jsonb
)
returns table(bundle_id uuid, reused boolean, lease_token uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_bank_id uuid;
  v_bundle_id uuid;
  v_lease_token uuid;
  v_now timestamptz := clock_timestamp();
begin
  if p_mode not in ('preview', 'final') then raise exception 'invalid trident mode'; end if;
  if coalesce(length(p_input_hash), 0) <> 64 then raise exception 'invalid trident input hash'; end if;
  if p_snapshot_manifest_json is null then raise exception 'snapshot manifest required'; end if;

  perform pg_advisory_xact_lock(hashtextextended(p_deal_id::text || ':' || p_mode, 0));

  select d.bank_id into v_bank_id from public.deals d where d.id = p_deal_id;
  if v_bank_id is null then raise exception 'deal not found'; end if;

  update public.buddy_trident_bundles
     set status = 'failed',
         generation_error = coalesce(generation_error, 'Generation lease expired before completion'),
         stage_error_json = coalesce(stage_error_json, jsonb_build_object('code','lease_expired')),
         generation_completed_at = v_now
   where deal_id = p_deal_id and bank_id = v_bank_id and mode = p_mode
     and status in ('pending','running')
     and coalesce(lease_expires_at, last_heartbeat_at, generated_at) < v_now;

  select b.id, b.lease_token into v_bundle_id, v_lease_token
    from public.buddy_trident_bundles b
   where b.deal_id = p_deal_id and b.bank_id = v_bank_id and b.mode = p_mode
     and b.status in ('pending','running') and b.lease_expires_at >= v_now
   order by b.generated_at desc limit 1;

  if v_bundle_id is not null then
    return query select v_bundle_id, true, v_lease_token;
    return;
  end if;

  v_lease_token := gen_random_uuid();
  insert into public.buddy_trident_bundles (
    deal_id, bank_id, mode, status, input_hash, memo_input_hash,
    snapshot_manifest_json, lease_token, lease_expires_at,
    current_stage, last_heartbeat_at
  ) values (
    p_deal_id, v_bank_id, p_mode, 'pending', p_input_hash, p_memo_input_hash,
    p_snapshot_manifest_json, v_lease_token, v_now + interval '90 minutes',
    'admitted', v_now
  ) returning id into v_bundle_id;

  return query select v_bundle_id, false, v_lease_token;
end;
$$;

create or replace function public.record_trident_bundle_stage(
  p_bundle_id uuid,
  p_lease_token uuid,
  p_input_hash text,
  p_stage text,
  p_status text,
  p_detail jsonb default '{}'::jsonb
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_attempt integer;
begin
  if p_status not in ('running','succeeded','failed','skipped') then
    raise exception 'invalid stage status';
  end if;
  perform 1 from public.buddy_trident_bundles b
   where b.id=p_bundle_id and b.lease_token=p_lease_token
     and b.input_hash=p_input_hash and b.status in ('pending','running')
     and b.lease_expires_at >= v_now for update;
  if not found then raise exception 'trident lease lost'; end if;

  select coalesce(s.attempt_count,0) into v_attempt
    from public.buddy_trident_bundle_stages s
   where s.bundle_id=p_bundle_id and s.stage=p_stage;
  v_attempt := coalesce(v_attempt,0) + case when p_status='running' then 1 else 0 end;

  insert into public.buddy_trident_bundle_stages(
    bundle_id,stage,status,attempt_count,input_hash,output_json,error_json,
    started_at,completed_at,updated_at
  ) values (
    p_bundle_id,p_stage,p_status,v_attempt,p_input_hash,
    case when p_status in ('succeeded','skipped') then p_detail end,
    case when p_status='failed' then p_detail end,
    case when p_status='running' then v_now end,
    case when p_status in ('succeeded','failed','skipped') then v_now end,v_now
  )
  on conflict(bundle_id,stage) do update set
    status=excluded.status, attempt_count=excluded.attempt_count,
    input_hash=excluded.input_hash, output_json=excluded.output_json,
    error_json=excluded.error_json,
    started_at=case when excluded.status='running' then excluded.started_at else public.buddy_trident_bundle_stages.started_at end,
    completed_at=excluded.completed_at, updated_at=v_now;

  update public.buddy_trident_bundles set
    status=case when status='pending' then 'running' else status end,
    current_stage=p_stage, last_heartbeat_at=v_now,
    lease_expires_at=v_now + interval '90 minutes',
    stage_error_json=case when p_status='failed'
      then jsonb_build_object('stage',p_stage)||coalesce(p_detail,'{}'::jsonb)
      when p_status='running' then null else stage_error_json end,
    generation_started_at=coalesce(generation_started_at,v_now)
  where id=p_bundle_id;
  return true;
end;
$$;

create or replace function public.fail_trident_bundle_run(
  p_bundle_id uuid, p_lease_token uuid, p_input_hash text, p_error text
)
returns boolean language plpgsql security definer set search_path='' as $$
begin
  update public.buddy_trident_bundles set
    status='failed', generation_error=p_error, generation_completed_at=clock_timestamp(),
    last_heartbeat_at=clock_timestamp(), lease_expires_at=null
  where id=p_bundle_id and lease_token=p_lease_token and input_hash=p_input_hash
    and status in ('pending','running');
  if not found then raise exception 'trident lease lost'; end if;
  return true;
end;
$$;

create or replace function public.finalize_trident_bundle_run(
  p_bundle_id uuid, p_lease_token uuid, p_input_hash text
)
returns boolean language plpgsql security definer set search_path='' as $$
declare
  v public.buddy_trident_bundles%rowtype;
begin
  select * into v from public.buddy_trident_bundles
   where id=p_bundle_id and lease_token=p_lease_token and input_hash=p_input_hash
     and status in ('pending','running') and lease_expires_at >= clock_timestamp()
   for update;
  if not found then raise exception 'trident lease lost'; end if;
  if v.mode='final' and coalesce((v.release_gate_json->>'ok')::boolean,false) is not true then
    raise exception 'release gate has not passed';
  end if;
  if v.business_plan_pdf_path is null
     or (v.mode='final' and (v.feasibility_pdf_path is null or v.projections_xlsx_path is null)) then
    raise exception 'required artifacts are missing';
  end if;

  update public.buddy_trident_bundles set superseded_at=clock_timestamp()
   where deal_id=v.deal_id and bank_id=v.bank_id and mode=v.mode
     and status='succeeded' and superseded_at is null and id<>v.id;

  update public.buddy_trident_bundles set
    status='succeeded', generation_completed_at=clock_timestamp(),
    last_heartbeat_at=clock_timestamp(), lease_expires_at=null
   where id=v.id;
  return true;
end;
$$;

revoke all on function public.acquire_trident_bundle_run(uuid,text,text,text,jsonb) from public,anon,authenticated;
revoke all on function public.record_trident_bundle_stage(uuid,uuid,text,text,text,jsonb) from public,anon,authenticated;
revoke all on function public.fail_trident_bundle_run(uuid,uuid,text,text) from public,anon,authenticated;
revoke all on function public.finalize_trident_bundle_run(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.acquire_trident_bundle_run(uuid,text,text,text,jsonb) to service_role;
grant execute on function public.record_trident_bundle_stage(uuid,uuid,text,text,text,jsonb) to service_role;
grant execute on function public.fail_trident_bundle_run(uuid,uuid,text,text) to service_role;
grant execute on function public.finalize_trident_bundle_run(uuid,uuid,text) to service_role;
notify pgrst, 'reload schema';
