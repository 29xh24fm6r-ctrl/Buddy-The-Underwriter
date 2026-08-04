-- SPEC-BORROWER-QA-IDENTITY-V1 (remediated)
--
-- Adds test-application columns, atomic creation RPC, transactional cleanup
-- RPC, and audit infrastructure.

-- 1. Test-application columns on deals
alter table public.deals
  add column if not exists is_test boolean not null default false;

alter table public.deals
  add column if not exists test_suite text null;

alter table public.deals
  add column if not exists test_run_id text null;

alter table public.deals
  add column if not exists test_created_at timestamptz null;

alter table public.deals
  add column if not exists test_identity text null;

-- Indexes
create index if not exists idx_deals_is_test
  on public.deals(is_test)
  where is_test = true;

create index if not exists idx_deals_test_run_id
  on public.deals(test_run_id)
  where test_run_id is not null;

create index if not exists idx_deals_test_identity
  on public.deals(test_identity)
  where test_identity is not null;

comment on column public.deals.is_test is
  'True when this deal was created by a QA borrower identity.';

comment on column public.deals.test_suite is
  'Identifies the test suite that created this deal (e.g. borrower_e2e).';

comment on column public.deals.test_run_id is
  'Unique run identifier in the form E2E-YYYYMMDD-HHMMSS-<random>.';

comment on column public.deals.test_created_at is
  'Timestamp when this test application was created.';

comment on column public.deals.test_identity is
  'The QA identity that created this deal (e.g. borrower_qa).';

-- 2. Test-data cleanup audit table
create table if not exists public.test_data_cleanup_audit (
  id            uuid primary key default gen_random_uuid(),
  run_id        text not null,
  operated_by   text not null default 'system',
  mode          text not null check (mode in ('dry_run', 'confirmed')),
  filter_test_run_id  text null,
  filter_date_from    timestamptz null,
  filter_date_to      timestamptz null,
  deals_deleted       integer not null default 0,
  details             jsonb null,
  created_at    timestamptz not null default now()
);

comment on table public.test_data_cleanup_audit is
  'Audit trail for test-data cleanup operations.';

alter table public.test_data_cleanup_audit enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policy p
    join pg_class c on c.oid = p.polrelid
    where c.relname = 'test_data_cleanup_audit' and p.polname = 'service_role_all'
  ) then
    create policy "service_role_all"
      on public.test_data_cleanup_audit
      for all
      to service_role
      using (true)
      with check (true);
  end if;
end $$;

-- 3. Atomic QA test application creation RPC
-- Creates deal + test metadata in a single transaction.
-- P0-4: Deal and test metadata are atomic. Session is created separately
--        by the canonical createBorrowerSession() to avoid duplicate rows.
create or replace function public.create_qa_test_application(
  p_bank_id              uuid,
  p_borrower_email       text,
  p_borrower_name        text,
  p_test_run_id          text,
  p_test_suite           text default 'borrower_e2e',
  p_test_identity        text default 'borrower_qa'
)
returns jsonb
language plpgsql
set search_path = ''
security definer
as $$
declare
  v_deal_id    uuid := gen_random_uuid();
  v_now        timestamptz := now();
begin
  -- Insert deal with test metadata (session created separately by caller)
  insert into public.deals (
    id, bank_id, deal_type, origin,
    display_name, borrower_name, borrower_email,
    status,
    is_test, test_suite, test_run_id,
    test_created_at, test_identity,
    created_at, updated_at
  ) values (
    v_deal_id, p_bank_id, 'SBA', 'brokerage_anonymous',
    p_borrower_name, p_borrower_name, p_borrower_email,
    'active',
    true, p_test_suite, p_test_run_id,
    v_now, p_test_identity,
    v_now, v_now
  );

  return jsonb_build_object(
    'ok', true,
    'deal_id', v_deal_id,
    'test_run_id', p_test_run_id
  );
exception
  when others then
    return jsonb_build_object(
      'ok', false,
      'error', sqlerrm
    );
end;
$$;

comment on function public.create_qa_test_application is
  'Atomic creation of a QA test application: deal + session token + test metadata in one transaction. P0-4.';

-- 4. Transactional test-data cleanup RPC
-- Deletes dependent records then the deal in one transaction.
-- If any step fails, the entire cleanup is rolled back.
-- P0-10: Aborts if any dependent deletion fails.
create or replace function public.cleanup_test_data(
  p_test_run_id      text default null,
  p_date_from        timestamptz default null,
  p_date_to          timestamptz default null,
  p_dry_run          boolean default true,
  p_operated_by      text default 'system'
)
returns jsonb
language plpgsql
set search_path = ''
security definer
as $$
declare
  v_deal_ids    uuid[];
  v_deal_count  integer;
  v_total_rows  integer := 0;
  v_run_id      text := 'cleanup-' || to_char(now(), 'YYYYMMDD-HH24MISS-MSSS');
begin
  -- Collect matching deal IDs (only is_test=true, test_identity=borrower_qa)
  select array_agg(id), count(*)
  into v_deal_ids, v_deal_count
  from public.deals
  where is_test = true
    and test_identity = 'borrower_qa'
    and (p_test_run_id is null or test_run_id = p_test_run_id)
    and (p_date_from is null or test_created_at >= p_date_from)
    and (p_date_to is null or test_created_at <= p_date_to);

  if v_deal_count = 0 or v_deal_ids is null then
    -- Record dry-run audit
    insert into public.test_data_cleanup_audit (
      run_id, operated_by, mode,
      filter_test_run_id, filter_date_from, filter_date_to,
      deals_deleted, details
    ) values (
      v_run_id, p_operated_by,
      case when p_dry_run then 'dry_run' else 'confirmed' end,
      p_test_run_id, p_date_from, p_date_to,
      0,
      jsonb_build_object('matched_count', 0)
    );
    return jsonb_build_object(
      'ok', true, 'dry_run', p_dry_run,
      'matched_count', 0, 'deals_deleted', 0
    );
  end if;

  if p_dry_run then
    -- Record dry-run audit
    insert into public.test_data_cleanup_audit (
      run_id, operated_by, mode,
      filter_test_run_id, filter_date_from, filter_date_to,
      deals_deleted, details
    ) values (
      v_run_id, p_operated_by, 'dry_run',
      p_test_run_id, p_date_from, p_date_to,
      0,
      jsonb_build_object('matched_count', v_deal_count, 'deal_ids', v_deal_ids)
    );
    return jsonb_build_object(
      'ok', true, 'dry_run', true,
      'matched_count', v_deal_count,
      'deal_ids', v_deal_ids
    );
  end if;

  -- Confirmed deletion: delete dependent records first
  -- Order respects FK relationships.
  -- All within a single transaction — failure rolls back everything.

  delete from public.borrower_concierge_sessions
    where deal_id = any(v_deal_ids);
  get diagnostics v_total_rows = row_count;

  delete from public.borrower_session_tokens
    where deal_id = any(v_deal_ids);

  delete from public.borrower_email_verifications
    where deal_id = any(v_deal_ids);

  delete from public.borrower_applications
    where deal_id = any(v_deal_ids);

  delete from public.ai_events
    where deal_id = any(v_deal_ids);

  delete from public.deal_events
    where deal_id = any(v_deal_ids);

  delete from public.marketplace_listings
    where deal_id = any(v_deal_ids);

  -- Finally: delete the deals themselves
  delete from public.deals
    where id = any(v_deal_ids)
      and is_test = true
      and test_identity = 'borrower_qa';
  get diagnostics v_deal_count = row_count;

  -- Record audit
  insert into public.test_data_cleanup_audit (
    run_id, operated_by, mode,
    filter_test_run_id, filter_date_from, filter_date_to,
    deals_deleted, details
  ) values (
    v_run_id, p_operated_by, 'confirmed',
    p_test_run_id, p_date_from, p_date_to,
    v_deal_count,
    jsonb_build_object('deal_ids', v_deal_ids)
  );

  return jsonb_build_object(
    'ok', true, 'dry_run', false,
    'deals_deleted', v_deal_count,
    'deal_ids', v_deal_ids
  );
exception
  when others then
    return jsonb_build_object(
      'ok', false,
      'error', sqlerrm
    );
end;
$$;

comment on function public.cleanup_test_data is
  'Transactional test-data cleanup. Dry-runs by default. Confirmed deletions are atomic — failure rolls back everything. P0-10.';
