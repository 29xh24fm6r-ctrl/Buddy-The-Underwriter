-- ============================================================
-- LENDER PACKAGING + BORROWER NUDGES (AUTOMATIC CONVERGENCE)
-- ============================================================
-- Run this in Supabase SQL Editor ONLY
-- DO NOT run in terminal
-- ============================================================

-- 1️⃣ LENDER PACKAGING: Add package reference columns
alter table public.deals
add column if not exists lender_package_id text;

alter table public.deals
add column if not exists lender_package_generated_at timestamptz;

create index if not exists idx_deals_package_id 
  on public.deals(lender_package_id);

-- 2️⃣ BORROWER NUDGES: Tracking table
create table if not exists public.borrower_nudges (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references public.deals(id) on delete cascade,
  nudge_type text not null,
  message text not null,
  sent_at timestamptz not null default now(),
  metadata jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_borrower_nudges_deal_sent 
  on public.borrower_nudges(deal_id, sent_at desc);

-- 3️⃣ RLS: Tenant isolation for nudges
alter table public.borrower_nudges enable row level security;

drop policy if exists "Nudges via deal tenant-scoped" on public.borrower_nudges;
create policy "Nudges via deal tenant-scoped"
  on public.borrower_nudges
  for all
  using (
    deal_id in (
      select id from public.deals
      where bank_id::text = current_setting('app.current_bank_id', true)
    )
  );

-- ============================================================
-- VERIFICATION QUERIES
-- ============================================================
-- Verify package columns exist:
-- select column_name, data_type 
-- from information_schema.columns 
-- where table_name = 'deals' 
-- and column_name in ('lender_package_id', 'lender_package_generated_at');

-- Verify borrower_nudges table exists:
-- select tablename from pg_tables where tablename = 'borrower_nudges';

-- ============================================================
-- END OF MIGRATION
-- ============================================================
