-- 20251219_deal_reminder_runs.sql
-- Canonical run audit table for reminders (service-role writes; no app reads by default)

create extension if not exists pgcrypto;

create table if not exists public.deal_reminder_runs (
  id uuid primary key default gen_random_uuid(),
  subscription_id uuid not null,
  due_at timestamptz,
  ran_at timestamptz not null default now(),
  status text not null check (status in ('ok','error','skipped')),
  error text,
  meta jsonb not null default '{}'::jsonb
);

create index if not exists deal_reminder_runs_subscription_id_idx
  on public.deal_reminder_runs (subscription_id);

create index if not exists deal_reminder_runs_ran_at_idx
  on public.deal_reminder_runs (ran_at desc);

alter table public.deal_reminder_runs enable row level security;

-- Intentionally no policies.
-- Service-role bypasses RLS; anon/auth cannot read/write.
