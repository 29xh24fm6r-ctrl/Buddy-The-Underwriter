-- SPEC-BORROWER-RESUME-PERSISTENCE-V3
--
-- Persistent borrower intake progress tracking table.
--
-- COLUMNS:
--   deal_id              PK/FK to public.deals(id), cascade delete
--   current_chapter      Chapter the borrower is currently on (1-5)
--   last_valid_chapter   Highest chapter where all required facts are saved
--   progress_version     Monotonic counter incremented on every save
--   last_saved_at        Timestamp of most recent progress save
--
-- DESIGN:
--   This table tracks position only. Chapter facts belong in canonical
--   domain tables (deals, borrowers, ownership_entities, deal_documents,
--   borrower_concierge_sessions.extracted_facts, etc.).
--   Completion is derived server-side from canonical facts, never
--   accepted as authoritative from the client.
--
-- RLS: Only service_role may access this table.

create table if not exists public.borrower_intake_progress (
  deal_id               uuid primary key references public.deals(id) on delete cascade,
  current_chapter       smallint not null default 1
                        check (current_chapter between 1 and 5),
  last_valid_chapter    smallint
                        check (last_valid_chapter between 1 and 5),
  progress_version      integer not null default 0,
  last_saved_at         timestamptz not null default now()
);

comment on table public.borrower_intake_progress is
  'Canonical source for borrower intake chapter position. Fact storage is in domain tables — this tracks progress position only.';

comment on column public.borrower_intake_progress.deal_id is
  'FK to deals.id. One row per deal, cascade-deleted with the deal.';

comment on column public.borrower_intake_progress.current_chapter is
  'Last chapter the borrower was on during a confirmed save (1=Financing, 2=Business, 3=Ownership, 4=Financials, 5=Review).';

comment on column public.borrower_intake_progress.last_valid_chapter is
  'Highest chapter where all required canonical facts are confirmed saved. Server-derived — not client-claimed.';

comment on column public.borrower_intake_progress.progress_version is
  'Monotonic counter incremented on every save. Used for observability and to detect stale writes.';

comment on column public.borrower_intake_progress.last_saved_at is
  'Timestamp of the most recent confirmed progress save.';

create index if not exists idx_intake_progress_deal
  on public.borrower_intake_progress(deal_id);

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
