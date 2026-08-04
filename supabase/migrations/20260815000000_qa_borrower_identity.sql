-- SPEC-BORROWER-QA-IDENTITY-V1
--
-- Adds test-application columns to public.deals so QA borrower applications
-- are marked and isolated from production data flows.
--
-- Also creates the test_data_cleanup_audit table for recording cleanup
-- operations.

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

-- Index for efficient filtering of test applications
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
  'True when this deal was created by a QA borrower identity. Test deals are excluded from lender matching, marketplace, reporting, and production data flows.';

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
  'Audit trail for test-data cleanup operations. Every cleanup (including dry-runs) records a row.';

-- RLS: service_role only
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
