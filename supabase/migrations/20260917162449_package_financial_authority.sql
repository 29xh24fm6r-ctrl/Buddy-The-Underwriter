-- Extend the existing authoritative output store; do not introduce a second ledger.
alter table public.deal_model_snapshots add column if not exists package_input_hash text;
alter table public.deal_model_snapshots add column if not exists package_output jsonb;
create unique index if not exists deal_model_snapshots_package_identity
  on public.deal_model_snapshots (deal_id, bank_id, package_input_hash)
  where package_input_hash is not null;
alter table public.buddy_trident_bundles add column if not exists financial_snapshot_id uuid references public.deal_model_snapshots(id);
alter table public.buddy_sba_packages add column if not exists financial_snapshot_id uuid references public.deal_model_snapshots(id);
comment on column public.deal_model_snapshots.package_output is
  'Complete Model Engine V2 package output. Historical periods, projections, funding and cash flow share this immutable version. Consumers must bind by id, never independently choose latest.';
-- Legacy metric-only snapshots remain compatible. Package output is immutable.
create or replace function public.protect_package_financial_output() returns trigger
language plpgsql set search_path = public as $$
begin
  if old.package_output is not null and (
      new.package_output is distinct from old.package_output or
      new.outputs_hash is distinct from old.outputs_hash or
      new.package_input_hash is distinct from old.package_input_hash or
      new.deal_id is distinct from old.deal_id or new.bank_id is distinct from old.bank_id
  ) then raise exception 'Package financial snapshots are immutable'; end if;
  return new;
end $$;
revoke all on function public.protect_package_financial_output() from public, anon, authenticated;
drop trigger if exists protect_package_financial_output on public.deal_model_snapshots;
create trigger protect_package_financial_output before update on public.deal_model_snapshots
for each row execute function public.protect_package_financial_output();

alter table public.buddy_sba_packages add column if not exists render_input jsonb;

-- Extend the existing reservation ledger for bounded runs and separate QA capacity.
alter table public.ai_gateway_budget_reservations add column if not exists trident_run_id uuid references public.buddy_trident_bundles(id);
alter table public.ai_gateway_budget_reservations add column if not exists is_qa boolean not null default false;
create index if not exists ai_gateway_reservations_run on public.ai_gateway_budget_reservations(trident_run_id, role);
create or replace function public.reserve_trident_gateway_tokens(
  p_role text, p_requested_tokens bigint, p_daily_budget bigint, p_run_id uuid
) returns table (allowed boolean, reservation_id uuid, tokens_consumed bigint, tokens_reserved bigint)
language plpgsql security invoker set search_path = '' as $$
declare
  v_qa boolean;
  v_used bigint;
  v_qa_used bigint;
  v_day date := (timezone('UTC', now()))::date;
  v_res record;
begin
  select d.is_test into v_qa from public.buddy_trident_bundles b join public.deals d on d.id=b.deal_id
    where b.id=p_run_id and b.status in ('pending','running');
  if not found then raise exception 'Trident budget run is not active'; end if;
  perform pg_advisory_xact_lock(hashtextextended('trident-budget:' || p_role, 0));
  select coalesce(sum(coalesce(actual_tokens, reserved_tokens)),0) into v_used
    from public.ai_gateway_budget_reservations r where r.trident_run_id=p_run_id and r.role=p_role;
  if v_used+p_requested_tokens > least(p_daily_budget, 150000) then
    return query select false, null::uuid, v_used, 0::bigint; return;
  end if;
  if coalesce(v_qa,false) then
    select coalesce(sum(coalesce(actual_tokens, reserved_tokens)),0) into v_qa_used
      from public.ai_gateway_budget_reservations r where r.is_qa and r.usage_day=v_day and r.role=p_role;
    if v_qa_used+p_requested_tokens > p_daily_budget/2 then
      return query select false, null::uuid, v_qa_used, 0::bigint; return;
    end if;
  end if;
  select * into v_res from public.reserve_ai_gateway_tokens(p_role,p_requested_tokens,p_daily_budget);
  if v_res.allowed then
    update public.ai_gateway_budget_reservations set trident_run_id=p_run_id,is_qa=coalesce(v_qa,false) where id=v_res.reservation_id;
  end if;
  return query select v_res.allowed,v_res.reservation_id,v_res.tokens_consumed,v_res.tokens_reserved;
end $$;
revoke all on function public.reserve_trident_gateway_tokens(text,bigint,bigint,uuid) from public,anon,authenticated;
grant execute on function public.reserve_trident_gateway_tokens(text,bigint,bigint,uuid) to service_role;
