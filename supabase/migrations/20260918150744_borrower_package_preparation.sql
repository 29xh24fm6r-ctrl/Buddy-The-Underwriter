-- Repeat-safe. Preparation finishes BEFORE Trident freezes its input snapshot.
begin;

create table if not exists public.borrower_package_preparations (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references public.deals(id) on delete cascade,
  bank_id uuid not null,
  status text not null default 'running' check (status in ('running','succeeded','failed')),
  stage text not null default 'checking' check (stage in ('checking','validation','research','generation')),
  message text,
  workflow_run_id text,
  mission_id uuid,
  research_subject_hash text,
  bundle_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '45 minutes'
);
create unique index if not exists borrower_package_preparations_active
  on public.borrower_package_preparations(deal_id) where status = 'running';
create index if not exists borrower_package_preparations_latest
  on public.borrower_package_preparations(deal_id, bank_id, created_at desc);
alter table public.borrower_package_preparations enable row level security;
revoke all on public.borrower_package_preparations from public, anon, authenticated;
grant select, insert, update, delete on public.borrower_package_preparations to service_role;

-- An original copy lets preparation detect and preserve subsequent staff edits.
alter table public.deal_proceeds_items add column if not exists borrower_source jsonb;

create or replace function public.acquire_borrower_package_preparation(p_deal_id uuid, p_bank_id uuid)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_run public.borrower_package_preparations; v_bundle uuid;
begin
  perform 1 from public.deals where id = p_deal_id and bank_id = p_bank_id for update;
  if not found then raise exception 'Application unavailable'; end if;
  update public.borrower_package_preparations set status = 'failed',
    message = 'Preparation stopped before completion. Please retry.', updated_at = now()
    where deal_id = p_deal_id and status = 'running' and expires_at <= now();
  select * into v_run from public.borrower_package_preparations
    where deal_id = p_deal_id and bank_id = p_bank_id and status = 'running';
  if found then return jsonb_build_object('id',v_run.id,'reused',true); end if;
  -- Do not refresh validation or proceeds while the factory owns a frozen snapshot.
  select id into v_bundle from public.buddy_trident_bundles
    where deal_id = p_deal_id and bank_id = p_bank_id and mode = 'final'
      and status in ('pending','running') and lease_expires_at > now()
    order by generated_at desc limit 1;
  if found then return jsonb_build_object('bundleId',v_bundle,'reused',true); end if;
  insert into public.borrower_package_preparations(deal_id,bank_id)
    values(p_deal_id,p_bank_id) returning * into v_run;
  return jsonb_build_object('id',v_run.id,'reused',false);
end $$;
revoke all on function public.acquire_borrower_package_preparation(uuid,uuid) from public, anon, authenticated;
grant execute on function public.acquire_borrower_package_preparation(uuid,uuid) to service_role;

create or replace function public.sync_borrower_package_proceeds(p_run_id uuid, p_deal_id uuid, p_bank_id uuid)
returns void language plpgsql security invoker set search_path = '' as $$
declare v_saved jsonb; v_desired jsonb; v_current jsonb;
begin
  perform 1 from public.deals where id = p_deal_id and bank_id = p_bank_id for update;
  if not found then raise exception 'Application unavailable'; end if;
  perform 1 from public.borrower_package_preparations
    where id = p_run_id and deal_id = p_deal_id and bank_id = p_bank_id
      and status = 'running' and expires_at > now() for update;
  if not found then raise exception 'Preparation expired. Please retry.'; end if;

  select use_of_proceeds into v_saved from public.deal_loan_requests
    where deal_id = p_deal_id and bank_id = p_bank_id order by created_at desc limit 1;
  perform 1 from public.deal_proceeds_items where deal_id = p_deal_id for update;
  if v_saved is null or v_saved = '[]'::jsonb then
    if exists (select 1 from public.deal_proceeds_items where deal_id = p_deal_id and amount > 0) then return; end if;
    raise exception 'Add your financing purposes and amounts to the project budget.';
  end if;
  if jsonb_typeof(v_saved) <> 'array' then raise exception 'Review your project budget amounts.'; end if;
  if jsonb_array_length(v_saved) > 100 or exists (
    select 1 from jsonb_array_elements(v_saved) item where
      jsonb_typeof(item->'amount') is distinct from 'number'
      or (item->>'amount')::numeric < 0
      or coalesce(item->>'category','') not in ('business_acquisition','purchase_or_construction','equipment','working_capital','inventory','debt_refinance','other')
  ) then raise exception 'Review your project budget amounts.'; end if;
  select jsonb_agg(item order by item::text) into v_desired from (
    select jsonb_build_object('category',item->>'category','amount',(item->>'amount')::numeric,
      'description',coalesce(item->>'description','')) item
    from jsonb_array_elements(v_saved) item where (item->>'amount')::numeric > 0
  ) normalized;
  if v_desired is null then raise exception 'Add a project budget amount greater than zero.'; end if;
  select jsonb_agg(item order by item::text) into v_current from (
    select jsonb_build_object('category',category,'amount',amount,'description',coalesce(description,'')) item
    from public.deal_proceeds_items where deal_id = p_deal_id
  ) normalized;
  if v_current = v_desired then return; end if;
  if exists (select 1 from public.deal_proceeds_items where deal_id = p_deal_id and
    (borrower_source is null or borrower_source <> jsonb_build_object('category',category,'amount',amount,'description',coalesce(description,''))))
  then raise exception 'Your project budget differs from the reviewed financing schedule. Ask Buddy support to reconcile it before preparing the package.'; end if;
  delete from public.deal_proceeds_items where deal_id = p_deal_id;
  insert into public.deal_proceeds_items(deal_id,category,description,amount,borrower_source)
    select p_deal_id,item->>'category',item->>'description',(item->>'amount')::numeric,item
    from jsonb_array_elements(v_desired) item;
end $$;
revoke all on function public.sync_borrower_package_proceeds(uuid,uuid,uuid) from public, anon, authenticated;
grant execute on function public.sync_borrower_package_proceeds(uuid,uuid,uuid) to service_role;
commit;
