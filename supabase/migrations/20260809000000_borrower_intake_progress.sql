-- SPEC-BORROWER-RESUME-PERSISTENCE-V1
--
-- Adds persistent borrower intake progress so that chapter position,
-- purpose selections, and total amount survive page reload and
-- cross-device resume. This is the single canonical source for the
-- System 2 (StartConciergeClient) borrower intake state that was
-- previously held only in client-side React useState.
--
-- Production bug: QA deals created via create_qa_test_application
-- RPC had zero borrower_concierge_sessions rows, so seal-status
-- fieldProgress was always null. Chapter always reset to 1 on
-- reload. Facts saved by intake components via POST
-- /api/brokerage/concierge silently failed (no concierge session
-- found). This table provides a lightweight persistence layer that
-- works regardless of concierge session existence.

-- 1. Borrower intake progress table
-- One row per deal, upserted on every chapter transition.
create table if not exists public.borrower_intake_progress (
  deal_id              uuid primary key references public.deals(id) on delete cascade,
  current_chapter      smallint not null default 1
                       check (current_chapter between 1 and 5),
  purposes             text[]  not null default '{}',
  total_amount         numeric not null default 0,
  completed_chapters   smallint[] not null default '{}',
  last_completed_chapter smallint
                       check (last_completed_chapter between 1 and 5),
  progress_version     integer not null default 0,
  last_saved_at        timestamptz not null default now()
);

comment on table public.borrower_intake_progress is
  'Canonical source for borrower intake chapter position, purpose selections, and total amount. Updated atomically on every chapter transition.';

comment on column public.borrower_intake_progress.deal_id is
  'FK to deals.id. One row per deal.';

comment on column public.borrower_intake_progress.current_chapter is
  'Chapter the borrower was on when progress was last saved (1=Financing, 2=Business, 3=Ownership, 4=Financials, 5=Review).';

comment on column public.borrower_intake_progress.purposes is
  'Selected use-of-proceeds categories (e.g. franchise, working_capital).';

comment on column public.borrower_intake_progress.total_amount is
  'Total loan amount requested (from Chapter 1: Financing).';

comment on column public.borrower_intake_progress.completed_chapters is
  'Chapters the borrower has completed (navigated past). Used to reconstruct review state.';

comment on column public.borrower_intake_progress.last_completed_chapter is
  'Highest chapter the borrower has ever completed. Forward progress only — never decrements. Used as a floor when computing current_chapter.';

comment on column public.borrower_intake_progress.progress_version is
  'Monotonic counter incremented on every save. Used to detect stale vs fresh writes and for observability.';

comment on column public.borrower_intake_progress.last_saved_at is
  'Timestamp of the most recent progress save. Distinct from updated_at to survive schema-level refreshes.';

-- 2. Indexes
create index if not exists idx_intake_progress_deal
  on public.borrower_intake_progress(deal_id);

-- 3. RLS
alter table public.borrower_intake_progress enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policy p
    join pg_class c on c.oid = p.polrelid
    where c.relname = 'borrower_intake_progress' and p.polname = 'service_role_all'
  ) then
    create policy "service_role_all"
      on public.borrower_intake_progress
      for all
      to service_role
      using (true)
      with check (true);
  end if;
end $$;

-- 4. Schema manifest entry will be added in a follow-up commit
