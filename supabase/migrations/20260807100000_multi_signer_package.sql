-- §5: Multi-signer package completeness
--
-- Two things here:
--   1. Create public.fill_runs, which code has referenced since
--      2025-12 but which no migration has ever created.
--   2. Add ownership_entity_id to sba_package_run_items so per-owner
--      forms (413, 912, 4506-C, 148, 148L) get one row per
--      (template_code, owner) instead of one row per template_code.
--
-- CORRECTION (audit 2026-08-01): this file originally contained
--
--   ALTER TABLE public.fill_runs ADD COLUMN IF NOT EXISTS ownership_entity_id uuid NULL;
--
-- public.fill_runs does not exist. 20251218000013_sba_package_builder.sql
-- created sba_package_run_items.fill_run_id as a bare `uuid null` with NO
-- foreign key and never created the target table; no later migration did
-- either, and it is absent from both schema-reap batches
-- (20260729030000 / 20260729040000) — never dropped, because never
-- created. `ADD COLUMN IF NOT EXISTS` guards the column, not the table,
-- so the statement raised 42P01 and — migrations being transactional —
-- rolled back this entire file, meaning the sba_package_run_items column
-- never landed either. Every prepareSbaPackage() call has thrown on its
-- first item since December.
--
-- fill_runs is load-bearing, not vestigial: it carries
-- (template_code, ownership_entity_id) from buildPackage.ts to
-- generatePdfForFillRun.ts, which reads it back to call
-- renderSbaPackageItem() with the right form for the right signer.
-- Without it the §5 per-owner expansion has no route to the dispatcher.
-- So it is created here, with ownership_entity_id present from the start.
--
-- Applied to production 2026-08-01 as migrations
-- `create_fill_runs_table` and `multi_signer_package_run_items`.

create table if not exists public.fill_runs (
  id                   uuid primary key default gen_random_uuid(),
  deal_id              uuid not null references public.deals(id) on delete cascade,
  template_code        text not null,
  ownership_entity_id  uuid null references public.ownership_entities(id) on delete set null,
  status               text not null default 'prepared',
  context              jsonb not null default '{}'::jsonb,
  error                text null,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create index if not exists idx_fill_runs_deal on public.fill_runs(deal_id);
create index if not exists idx_fill_runs_template on public.fill_runs(template_code);
create index if not exists idx_fill_runs_owner
  on public.fill_runs(ownership_entity_id) where ownership_entity_id is not null;

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'trg_fill_runs_updated_at') then
    create trigger trg_fill_runs_updated_at
      before update on public.fill_runs
      for each row execute function public.set_updated_at();
  end if;
end $$;

alter table public.fill_runs enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policy p
    join pg_class c on c.oid = p.polrelid
    where c.relname = 'fill_runs' and p.polname = 'service_role_all'
  ) then
    create policy "service_role_all"
      on public.fill_runs
      for all
      to service_role
      using (true)
      with check (true);
  end if;
end $$;

comment on table public.fill_runs is
  'Per-form fill run for the SBA package builder. Carries (template_code, '
  'ownership_entity_id) from prepareSbaPackage to generatePdfForFillRun, '
  'which dispatches to renderSbaPackageItem. Created 2026-08-01; referenced '
  'by code since 20251218000013 but never previously created. '
  'RLS: service_role only.';

ALTER TABLE public.sba_package_run_items
  ADD COLUMN IF NOT EXISTS ownership_entity_id uuid NULL
    REFERENCES public.ownership_entities(id);

CREATE INDEX IF NOT EXISTS idx_sba_pkg_run_items_owner
  ON public.sba_package_run_items(ownership_entity_id)
  WHERE ownership_entity_id IS NOT NULL;
