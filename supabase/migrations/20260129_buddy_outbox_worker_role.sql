-- Dedicated DB role for buddy-core-worker.
--
-- The buddy_outbox_events table has RLS enabled with a deny-all default.
-- This migration creates a dedicated login role (buddy_worker) and an
-- explicit permissive RLS policy so the worker can read/write outbox rows
-- without needing to bypass RLS as postgres/service_role.
--
-- After running this migration, update the BUDDY_DB_URL secret in
-- Google Secret Manager to use the buddy_worker role:
--
--   postgresql://buddy_worker:<PASSWORD>@db.<ref>.supabase.co:6543/postgres?sslmode=require
--
-- Run this ONCE in the Supabase SQL editor as the postgres role.

-- 1) Create a dedicated login role for the worker
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'buddy_worker') then
    create role buddy_worker login password 'REPLACE_WITH_STRONG_PASSWORD';
  end if;
end $$;

-- 2) Grant table privileges (RLS still applies per-row)
grant usage on schema public to buddy_worker;
grant select, insert, update on public.buddy_outbox_events to buddy_worker;

-- 3) Allow ONLY buddy_worker via RLS (permissive = allows access)
drop policy if exists "allow_worker" on public.buddy_outbox_events;

create policy "allow_worker"
on public.buddy_outbox_events
as permissive
for all
to buddy_worker
using (true)
with check (true);

-- 4) Keep deny-all for everyone else (restrictive = always denies for non-worker roles)
drop policy if exists "deny_all" on public.buddy_outbox_events;

create policy "deny_all"
on public.buddy_outbox_events
as restrictive
for all
to public
using (false);
