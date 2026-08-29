begin;

-- Preserve the exact Golden Trident final bundle frozen into an active seal.
-- Artifact paths are durable evidence: supersession changes which bundle the
-- delivery surfaces resolve, so an active seal must fence both admission and
-- publication of a replacement final bundle.

create or replace function public.protect_active_sealed_trident_bundle()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.mode = 'final'
     and old.status = 'succeeded'
     and old.superseded_at is null
     and new.superseded_at is not null
     and exists (
       select 1
       from public.buddy_sealed_packages sealed
       where sealed.deal_id = old.deal_id
         and sealed.bank_id = old.bank_id
         and sealed.unsealed_at is null
         and sealed.sealed_snapshot #>> '{tridentFinal,bundleId}' = old.id::text
     ) then
    raise exception 'active_seal_preserves_trident_bundle';
  end if;
  return new;
end;
$$;

revoke all on function public.protect_active_sealed_trident_bundle()
  from public, anon, authenticated;

drop trigger if exists buddy_trident_active_seal_supersession_guard
  on public.buddy_trident_bundles;
create trigger buddy_trident_active_seal_supersession_guard
before update of superseded_at
on public.buddy_trident_bundles
for each row
execute function public.protect_active_sealed_trident_bundle();

create or replace function public.acquire_trident_bundle_run(
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

  if p_mode = 'final' and exists (
    select 1
    from public.buddy_sealed_packages sealed
    where sealed.deal_id = p_deal_id
      and sealed.bank_id = v_bank_id
      and sealed.unsealed_at is null
  ) then
    raise exception 'active_seal_preserves_trident_bundle';
  end if;

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

create or replace function public.finalize_trident_bundle_run(
  p_bundle_id uuid, p_lease_token uuid, p_input_hash text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
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

  if v.mode = 'final' and exists (
    select 1
    from public.buddy_sealed_packages sealed
    where sealed.deal_id = v.deal_id
      and sealed.bank_id = v.bank_id
      and sealed.unsealed_at is null
      and coalesce(
        sealed.sealed_snapshot #>> '{tridentFinal,bundleId}',
        ''
      ) <> v.id::text
  ) then
    raise exception 'active_seal_preserves_trident_bundle';
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

revoke all on function public.acquire_trident_bundle_run(uuid,text,text,text,jsonb)
  from public, anon, authenticated;
revoke all on function public.finalize_trident_bundle_run(uuid,uuid,text)
  from public, anon, authenticated;
grant execute on function public.acquire_trident_bundle_run(uuid,text,text,text,jsonb)
  to service_role;
grant execute on function public.finalize_trident_bundle_run(uuid,uuid,text)
  to service_role;

-- Repair only rows whose immutable seal proves the bundle identity and every
-- distributed artifact path. No object or row is deleted; newer unsealed
-- candidates remain retained as superseded forensic evidence.
do $reconcile$
declare
  binding record;
  v_now timestamptz := clock_timestamp();
begin
  for binding in
    select
      sealed.deal_id,
      sealed.bank_id,
      bound.id as bound_bundle_id
    from public.buddy_sealed_packages sealed
    join public.buddy_trident_bundles bound
      on bound.id::text = sealed.sealed_snapshot #>> '{tridentFinal,bundleId}'
     and bound.deal_id = sealed.deal_id
     and bound.bank_id = sealed.bank_id
     and bound.mode = 'final'
     and bound.status = 'succeeded'
    where sealed.unsealed_at is null
      and bound.superseded_at is not null
      and sealed.final_business_plan_path = bound.business_plan_pdf_path
      and sealed.final_projections_path = bound.projections_xlsx_path
      and sealed.final_feasibility_path = bound.feasibility_pdf_path
    order by sealed.deal_id
  loop
    perform pg_advisory_xact_lock(
      hashtextextended(binding.deal_id::text || ':final', 0)
    );

    update public.buddy_trident_bundles candidate
       set superseded_at = coalesce(candidate.superseded_at, v_now)
     where candidate.deal_id = binding.deal_id
       and candidate.bank_id = binding.bank_id
       and candidate.mode = 'final'
       and candidate.status = 'succeeded'
       and candidate.superseded_at is null
       and candidate.id <> binding.bound_bundle_id;

    update public.buddy_trident_bundles bound
       set superseded_at = null
     where bound.id = binding.bound_bundle_id
       and bound.superseded_at is not null;
  end loop;
end
$reconcile$;

comment on function public.protect_active_sealed_trident_bundle() is
  'Trigger-only invariant: an active seal retains its exact final Golden Trident bundle identity across later generation attempts.';

notify pgrst, 'reload schema';

commit;
