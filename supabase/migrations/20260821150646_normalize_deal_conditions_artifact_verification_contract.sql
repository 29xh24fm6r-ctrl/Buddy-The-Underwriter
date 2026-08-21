-- Restore the canonical artifact-verification contract on the legacy
-- deal_conditions table. The original create-table migration used
-- CREATE TABLE IF NOT EXISTS, so older deployments retained an incomplete
-- table shape and silently lost institutional-review findings.

set lock_timeout = '5s';
set statement_timeout = '30s';

alter table public.deal_conditions
  add column if not exists category text not null default 'policy',
  add column if not exists source_key text,
  add column if not exists required_docs jsonb not null default '[]'::jsonb,
  add column if not exists borrower_message_subject text,
  add column if not exists borrower_message_body text,
  add column if not exists reminder_subscription_id uuid,
  add column if not exists created_by uuid;

do $constraints$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.deal_conditions'::regclass
      and conname = 'deal_conditions_category_check'
  ) then
    alter table public.deal_conditions
      add constraint deal_conditions_category_check
      check (category in ('policy','credit','legal','closing','other')) not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.deal_conditions'::regclass
      and conname = 'deal_conditions_status_check'
  ) then
    alter table public.deal_conditions
      add constraint deal_conditions_status_check
      check (status in ('open','satisfied','waived','rejected')) not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.deal_conditions'::regclass
      and conname = 'deal_conditions_source_check'
  ) then
    alter table public.deal_conditions
      add constraint deal_conditions_source_check
      check (source in ('policy','manual','system')) not valid;
  end if;
end
$constraints$;

alter table public.deal_conditions validate constraint deal_conditions_category_check;
alter table public.deal_conditions validate constraint deal_conditions_status_check;
alter table public.deal_conditions validate constraint deal_conditions_source_check;

create unique index if not exists deal_conditions_deal_source_key_uidx
  on public.deal_conditions (deal_id, source, source_key)
  where source_key is not null;

create index if not exists deal_conditions_deal_status_created_idx
  on public.deal_conditions (deal_id, status, created_at desc);

create index if not exists deal_conditions_bank_status_created_idx
  on public.deal_conditions (bank_id, status, created_at desc);

-- The legacy merged policies compared m.bank_id to itself, which did not
-- scope rows to the condition's bank. Replace them with explicit tenant
-- correlation and current Supabase role syntax.
drop policy if exists deal_conditions_select_merged on public.deal_conditions;
drop policy if exists deal_conditions_insert_merged on public.deal_conditions;
drop policy if exists deal_conditions_update_merged on public.deal_conditions;
drop policy if exists deal_conditions_delete_merged on public.deal_conditions;
drop policy if exists deal_conditions_select_member on public.deal_conditions;
drop policy if exists deal_conditions_insert_member on public.deal_conditions;
drop policy if exists deal_conditions_update_member on public.deal_conditions;
drop policy if exists deal_conditions_delete_member on public.deal_conditions;

create policy deal_conditions_select_member
on public.deal_conditions
for select
to authenticated
using (
  exists (
    select 1 from public.bank_memberships m
    where m.bank_id = deal_conditions.bank_id
      and m.user_id = (select auth.uid())
  )
);

create policy deal_conditions_insert_member
on public.deal_conditions
for insert
to authenticated
with check (
  exists (
    select 1 from public.bank_memberships m
    where m.bank_id = deal_conditions.bank_id
      and m.user_id = (select auth.uid())
  )
);

create policy deal_conditions_update_member
on public.deal_conditions
for update
to authenticated
using (
  exists (
    select 1 from public.bank_memberships m
    where m.bank_id = deal_conditions.bank_id
      and m.user_id = (select auth.uid())
  )
)
with check (
  exists (
    select 1 from public.bank_memberships m
    where m.bank_id = deal_conditions.bank_id
      and m.user_id = (select auth.uid())
  )
);

create policy deal_conditions_delete_member
on public.deal_conditions
for delete
to authenticated
using (
  exists (
    select 1 from public.bank_memberships m
    where m.bank_id = deal_conditions.bank_id
      and m.user_id = (select auth.uid())
  )
);

alter table public.deal_conditions enable row level security;

notify pgrst, 'reload schema';
