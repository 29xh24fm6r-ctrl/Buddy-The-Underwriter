-- =========================================================
-- Fix: readiness + lifecycle query safety
--
-- 1) Add ready_at / ready_reason columns to deals (used by
--    readiness.ts but never migrated — only
--    underwriting_ready_at existed).
--
-- 2) Ensure deal_status has FK to deals so Supabase
--    PostgREST can resolve the relationship for LEFT joins.
-- =========================================================

-- 1) Readiness columns on deals
alter table public.deals
  add column if not exists ready_at timestamptz,
  add column if not exists ready_reason text;

-- 2) FK from deal_status → deals (enables PostgREST join shorthand)
do $$
begin
  if not exists (
    select 1 from information_schema.table_constraints
    where constraint_type = 'FOREIGN KEY'
      and table_name = 'deal_status'
      and constraint_name = 'deal_status_deal_id_fkey'
  ) then
    alter table public.deal_status
      add constraint deal_status_deal_id_fkey
      foreign key (deal_id) references public.deals(id) on delete cascade;
  end if;
end $$;
