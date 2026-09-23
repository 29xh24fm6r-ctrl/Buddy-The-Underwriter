-- One policy for read-only admission and atomic per-call reservations.
-- Observed verifier work: 119,189 settled + 40,973 reserved for review three.
-- 300k leaves room for the fourth review and earlier package verification.
-- This is a bounded allowance, not a promise for arbitrarily large artifacts.
create or replace function public.trident_package_budget_policy() returns jsonb
language sql stable security invoker set search_path = '' as $$
  select '{"generator":150000,"underwriter":300000,"verifier":300000}'::jsonb;
$$;
revoke all on function public.trident_package_budget_policy() from public,anon,authenticated;
grant execute on function public.trident_package_budget_policy() to service_role;

create table public.institutional_review_checkpoints (
  artifact_type text not null check (artifact_type in ('business_plan','feasibility')),
  artifact_id uuid not null,
  bank_id uuid not null,
  deal_id uuid not null references public.deals(id) on delete cascade,
  input_hash text not null check (length(input_hash)=64),
  state jsonb,
  revision bigint not null default 0,
  owner uuid,
  lease_until timestamptz,
  updated_at timestamptz not null default now(),
  primary key (artifact_type,artifact_id)
);
create index institutional_review_checkpoints_deal on public.institutional_review_checkpoints(deal_id,bank_id);
alter table public.institutional_review_checkpoints enable row level security;
revoke all on public.institutional_review_checkpoints from public,anon,authenticated;
grant select,insert,update,delete on public.institutional_review_checkpoints to service_role;
comment on table public.institutional_review_checkpoints is
  'Service-only review journal. Original evidence/content hash binds resumed prose and findings. Intermediate repairs never confer release approval.';

create or replace function public.institutional_review_checkpoint(
  p_action text,p_bank_id uuid,p_deal_id uuid,p_artifact_type text,p_artifact_id uuid,
  p_input_hash text,p_owner uuid,p_revision bigint,p_state jsonb
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare r public.institutional_review_checkpoints%rowtype;
begin
  if p_owner is null or p_input_hash is null or length(p_input_hash)<>64 then
    raise exception 'Invalid review checkpoint identity';
  end if;
  if not exists(select 1 from public.deals where id=p_deal_id and bank_id=p_bank_id) then
    raise exception 'Review checkpoint tenant mismatch';
  end if;
  if p_artifact_type='business_plan' then
    if not exists(select 1 from public.buddy_sba_packages where id=p_artifact_id and deal_id=p_deal_id) then
      raise exception 'Review checkpoint artifact mismatch';
    end if;
  elsif p_artifact_type='feasibility' then
    if not exists(select 1 from public.buddy_feasibility_studies where id=p_artifact_id and deal_id=p_deal_id and bank_id=p_bank_id) then
      raise exception 'Review checkpoint artifact mismatch';
    end if;
  else raise exception 'Unsupported review checkpoint artifact';
  end if;
  if p_action='claim' then
    insert into public.institutional_review_checkpoints(artifact_type,artifact_id,bank_id,deal_id,input_hash)
      values(p_artifact_type,p_artifact_id,p_bank_id,p_deal_id,p_input_hash) on conflict do nothing;
  end if;
  select * into r from public.institutional_review_checkpoints
    where artifact_type=p_artifact_type and artifact_id=p_artifact_id for update;
  if not found or r.bank_id<>p_bank_id or r.deal_id<>p_deal_id then
    raise exception 'Review checkpoint tenant mismatch';
  end if;
  if p_action='claim' then
    if r.owner is not null and r.lease_until>clock_timestamp() then
      raise exception 'Review checkpoint already owned';
    end if;
    -- Changed evidence or original prose invalidates all prior progress.
    if r.input_hash<>p_input_hash then r.state:=null; end if;
    r.input_hash:=p_input_hash;
    r.owner:=p_owner;
  else
    if r.owner is distinct from p_owner or r.lease_until<=clock_timestamp() or
        r.input_hash<>p_input_hash or r.revision<>p_revision then
      raise exception 'Review checkpoint ownership lost';
    end if;
    if p_action='save' then
      if p_state is null or (p_state->>'version') is distinct from '1' or jsonb_typeof(p_state)<>'object' then
        raise exception 'Invalid review checkpoint state';
      end if;
      r.state:=p_state;
    elsif p_action='release' then r.owner:=null;
    else raise exception 'Invalid review checkpoint action';
    end if;
  end if;
  update public.institutional_review_checkpoints set input_hash=r.input_hash,state=r.state,
    owner=r.owner,lease_until=case when r.owner is null then null else clock_timestamp()+interval '10 minutes' end,
    revision=revision+1,updated_at=clock_timestamp()
    where artifact_type=p_artifact_type and artifact_id=p_artifact_id returning * into r;
  return jsonb_build_object('state',r.state,'revision',r.revision);
end $$;
revoke all on function public.institutional_review_checkpoint(text,uuid,uuid,text,uuid,text,uuid,bigint,jsonb) from public,anon,authenticated;
grant execute on function public.institutional_review_checkpoint(text,uuid,uuid,text,uuid,text,uuid,bigint,jsonb) to service_role;

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
  v_limit bigint := (public.trident_package_budget_policy()->>p_role)::bigint;
begin
  if v_limit is null or p_requested_tokens is null or p_requested_tokens<=0 or p_daily_budget is null or p_daily_budget<=0 then
    raise exception 'Invalid package budget request';
  end if;
  select d.is_test into v_qa from public.buddy_trident_bundles b join public.deals d on d.id=b.deal_id
    where b.id=p_run_id and b.status in ('pending','running');
  if not found then raise exception 'Trident budget run is not active'; end if;
  perform pg_advisory_xact_lock(hashtextextended('trident-budget:' || p_role, 0));
  select coalesce(sum(coalesce(actual_tokens, reserved_tokens)),0) into v_used
    from public.ai_gateway_budget_reservations r where r.trident_run_id=p_run_id and r.role=p_role;
  if v_used+p_requested_tokens > least(p_daily_budget, v_limit) then
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
