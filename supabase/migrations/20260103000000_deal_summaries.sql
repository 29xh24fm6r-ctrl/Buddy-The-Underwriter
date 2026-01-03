-- Migration: Add deal_summaries table for "Buddy Explains" AI summaries
-- Run in Supabase SQL Editor

begin;

-- Create deal_summaries table
create table if not exists public.deal_summaries (
  id uuid primary key default gen_random_uuid(),
  bank_id uuid not null,
  deal_id uuid not null references public.deals(id) on delete cascade,
  kind text not null default 'buddy_explains',
  summary_md text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- Create indexes
create index if not exists deal_summaries_deal_id_idx on public.deal_summaries(deal_id);
create index if not exists deal_summaries_bank_id_idx on public.deal_summaries(bank_id);
create index if not exists deal_summaries_created_at_idx on public.deal_summaries(created_at desc);

-- RLS policies (deny-all pattern, access via service role)
alter table public.deal_summaries enable row level security;

create policy "deal_summaries_deny_all" on public.deal_summaries
  for all using (false);

commit;
