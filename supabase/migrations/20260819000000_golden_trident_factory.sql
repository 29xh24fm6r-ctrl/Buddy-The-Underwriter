-- Golden Trident deterministic commissioning factory.
-- Atomic admission, frozen inputs, durable stage ledger, and complete failure evidence.

alter table public.buddy_trident_bundles
  add column if not exists input_hash text,
  add column if not exists workflow_run_id text,
  add column if not exists current_stage text,
  add column if not exists last_heartbeat_at timestamptz,
  add column if not exists stage_error_json jsonb;

-- Resolve any legacy duplicate active rows before installing the invariant.
with ranked as (
  select id, row_number() over (
    partition by deal_id, mode order by generated_at desc, id desc
  ) as rn
  from public.buddy_trident_bundles
  where status in ('pending', 'running')
)
update public.buddy_trident_bundles b
set status = 'failed',
    generation_error = coalesce(b.generation_error, 'Superseded during atomic-admission commissioning'),
    generation_completed_at = now()
from ranked r
where b.id = r.id and r.rn > 1;

create unique index if not exists buddy_trident_bundles_one_active_per_deal_mode
  on public.buddy_trident_bundles (deal_id, mode)
  where status in ('pending', 'running');

create index if not exists buddy_trident_bundles_latest_run_idx
  on public.buddy_trident_bundles (deal_id, bank_id, mode, generated_at desc);

create table if not exists public.buddy_trident_bundle_stages (
  bundle_id uuid not null references public.buddy_trident_bundles(id) on delete cascade,
  stage text not null,
  status text not null check (status in ('pending','running','succeeded','failed','skipped')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  input_hash text,
  output_json jsonb,
  error_json jsonb,
  started_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (bundle_id, stage)
);

create index if not exists buddy_trident_bundle_stages_status_idx
  on public.buddy_trident_bundle_stages (status, updated_at);

alter table public.buddy_trident_bundle_stages enable row level security;

drop policy if exists trident_bundle_stages_select_for_bank_members on public.buddy_trident_bundle_stages;
create policy trident_bundle_stages_select_for_bank_members
  on public.buddy_trident_bundle_stages for select
  using (exists (
    select 1
    from public.buddy_trident_bundles b
    join public.bank_user_memberships m on m.bank_id = b.bank_id
    where b.id = buddy_trident_bundle_stages.bundle_id
      and m.user_id = (select auth.uid())
  ));

create or replace function public.acquire_trident_bundle_run(
  p_deal_id uuid,
  p_mode text,
  p_input_hash text
)
returns table(bundle_id uuid, reused boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_bank_id uuid;
  v_bundle_id uuid;
  v_stale_before timestamptz := now() - interval '20 minutes';
begin
  if p_mode not in ('preview', 'final') then
    raise exception 'invalid trident mode';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_deal_id::text || ':' || p_mode, 0));

  select d.bank_id into v_bank_id
  from public.deals d
  where d.id = p_deal_id;

  if v_bank_id is null then
    raise exception 'deal not found';
  end if;

  update public.buddy_trident_bundles
  set status = 'failed',
      generation_error = coalesce(generation_error, 'Generation lease expired before completion'),
      stage_error_json = coalesce(stage_error_json, jsonb_build_object('code','lease_expired')),
      generation_completed_at = now()
  where deal_id = p_deal_id
    and mode = p_mode
    and status in ('pending','running')
    and coalesce(last_heartbeat_at, generation_started_at, generated_at) < v_stale_before;

  select b.id into v_bundle_id
  from public.buddy_trident_bundles b
  where b.deal_id = p_deal_id
    and b.mode = p_mode
    and b.status in ('pending','running')
  order by b.generated_at desc
  limit 1;

  if v_bundle_id is not null then
    return query select v_bundle_id, true;
    return;
  end if;

  insert into public.buddy_trident_bundles (
    deal_id, bank_id, mode, status, input_hash, current_stage, last_heartbeat_at
  ) values (
    p_deal_id, v_bank_id, p_mode, 'pending', p_input_hash, 'admitted', now()
  ) returning id into v_bundle_id;

  return query select v_bundle_id, false;
end;
$$;

revoke all on function public.acquire_trident_bundle_run(uuid,text,text) from public, anon, authenticated;
grant execute on function public.acquire_trident_bundle_run(uuid,text,text) to service_role;

comment on table public.buddy_trident_bundle_stages is
  'Immutable-by-stage execution evidence for Golden Trident durable commissioning.';
