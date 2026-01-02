-- =============================================================================
-- INEVITABLE DEAL SYSTEM - SUBMISSION GATING + WEBHOOKS
-- =============================================================================
-- 
-- Pillars:
-- 1. Submission gating (deals.submitted_at, submission_block_reason)
-- 2. Webhook automation (deal_webhooks table)
-- 
-- Safe to run multiple times (idempotent)
-- =============================================================================

-- =============================================================================
-- PILLAR 1: SUBMISSION GATING
-- =============================================================================

-- Add submission tracking to deals table
alter table public.deals
add column if not exists submitted_at timestamptz;

alter table public.deals
add column if not exists submission_block_reason text;

comment on column public.deals.submitted_at is
  'Timestamp when deal was submitted for underwriting. NULL = not yet submitted.';

comment on column public.deals.submission_block_reason is
  'If set, explains why submission is blocked (e.g., "Checklist incomplete", "Uploads processing").';

-- Index for submitted deals queries
create index if not exists idx_deals_submitted_at
on public.deals(submitted_at)
where submitted_at is not null;

-- =============================================================================
-- PILLAR 2: WEBHOOK AUTOMATION
-- =============================================================================

-- Create webhooks table for event automation
create table if not exists public.deal_webhooks (
  id uuid primary key default gen_random_uuid(),
  bank_id uuid not null references public.banks(id) on delete cascade,
  event text not null, -- e.g., "deal.ready", "deal.submitted"
  url text not null,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  
  constraint valid_event check (event in (
    'deal.ready',
    'deal.submitted',
    'deal.blocked',
    'checklist.completed'
  ))
);

comment on table public.deal_webhooks is
  'Webhook configurations for automated deal event notifications';

-- Enable RLS
alter table public.deal_webhooks enable row level security;

-- Bank-scoped policies
create policy bank_select on public.deal_webhooks
for select to authenticated
using (bank_id = public.get_current_bank_id());

create policy bank_insert on public.deal_webhooks
for insert to authenticated
with check (bank_id = public.get_current_bank_id());

create policy bank_update on public.deal_webhooks
for update to authenticated
using (bank_id = public.get_current_bank_id())
with check (bank_id = public.get_current_bank_id());

create policy bank_delete on public.deal_webhooks
for delete to authenticated
using (bank_id = public.get_current_bank_id());

-- Index for efficient webhook lookups
create index if not exists idx_webhooks_bank_event
on public.deal_webhooks(bank_id, event)
where enabled = true;

-- =============================================================================
-- PILLAR 3: WEBHOOK EVENT LOG (for debugging)
-- =============================================================================

create table if not exists public.webhook_deliveries (
  id uuid primary key default gen_random_uuid(),
  webhook_id uuid references public.deal_webhooks(id) on delete set null,
  event text not null,
  payload jsonb not null,
  response_status int,
  response_body text,
  delivered_at timestamptz not null default now(),
  error text
);

comment on table public.webhook_deliveries is
  'Audit log of webhook delivery attempts';

-- Index for recent deliveries
create index if not exists idx_webhook_deliveries_recent
on public.webhook_deliveries(delivered_at desc);

-- =============================================================================
-- VERIFICATION QUERIES
-- =============================================================================

-- Check submission columns exist
select 
  column_name,
  data_type,
  is_nullable
from information_schema.columns
where table_name = 'deals'
  and column_name in ('submitted_at', 'submission_block_reason');

-- Check webhook tables exist
select 
  tablename,
  rowsecurity as rls_enabled
from pg_tables
where tablename in ('deal_webhooks', 'webhook_deliveries');

-- Check webhook policies
select 
  schemaname,
  tablename,
  policyname
from pg_policies
where tablename = 'deal_webhooks';

-- =============================================================================
-- EXPECTED RESULTS
-- =============================================================================
-- ✅ deals.submitted_at column exists (timestamptz, nullable)
-- ✅ deals.submission_block_reason column exists (text, nullable)
-- ✅ deal_webhooks table exists with RLS enabled
-- ✅ webhook_deliveries table exists
-- ✅ 4 RLS policies on deal_webhooks
-- ✅ Indexes created for performance
-- =============================================================================
