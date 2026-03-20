-- ============================================================
-- DEAL READINESS → SUBMISSION → WEBHOOKS (MEGA SPEC)
-- ============================================================
-- Run this in Supabase SQL Editor ONLY
-- DO NOT run in terminal
-- ============================================================

-- 1️⃣ SUBMISSION GATING: Add submitted_at column
alter table public.deals
add column if not exists submitted_at timestamptz;

-- 2️⃣ WEBHOOKS: Schema for automation edge
create table if not exists public.deal_webhooks (
  id uuid primary key default gen_random_uuid(),
  bank_id uuid not null references public.banks(id) on delete cascade,
  url text not null,
  event text not null check (event in ('deal.ready', 'deal.submitted')),
  created_at timestamptz not null default now()
);

create index if not exists idx_deal_webhooks_bank_event 
  on public.deal_webhooks(bank_id, event);

-- 3️⃣ RLS: Tenant isolation for webhooks
alter table public.deal_webhooks enable row level security;

drop policy if exists "Webhooks tenant-scoped SELECT" on public.deal_webhooks;
create policy "Webhooks tenant-scoped SELECT"
  on public.deal_webhooks
  for select
  using (bank_id::text = current_setting('app.current_bank_id', true));

drop policy if exists "Webhooks tenant-scoped INSERT" on public.deal_webhooks;
create policy "Webhooks tenant-scoped INSERT"
  on public.deal_webhooks
  for insert
  with check (bank_id::text = current_setting('app.current_bank_id', true));

-- ============================================================
-- VERIFICATION QUERIES
-- ============================================================
-- Verify submitted_at column exists:
-- select column_name, data_type 
-- from information_schema.columns 
-- where table_name = 'deals' and column_name = 'submitted_at';

-- Verify deal_webhooks table exists:
-- select tablename from pg_tables where tablename = 'deal_webhooks';

-- ============================================================
-- END OF MIGRATION
-- ============================================================
