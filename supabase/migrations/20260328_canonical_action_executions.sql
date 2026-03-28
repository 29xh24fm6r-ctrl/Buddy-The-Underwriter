-- Phase 65E — Canonical Action Executions
-- Separate from deal_action_executions (55G credit recommendations).
-- Tracks execution of canonical Buddy actions derived from state + blockers.

create table if not exists public.canonical_action_executions (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references public.deals(id) on delete cascade,
  bank_id uuid not null references public.banks(id) on delete cascade,
  action_code text not null,
  source text not null default 'canonical_action',
  target_system text not null,
  target_record_id text null,
  execution_status text not null check (
    execution_status in ('created','queued','already_exists','noop','failed')
  ),
  executed_by text not null,
  actor_type text not null check (actor_type in ('banker','system')),
  error_text text null,
  created_at timestamptz not null default now()
);

create index if not exists idx_cae_deal_id on public.canonical_action_executions(deal_id);
create index if not exists idx_cae_action_code on public.canonical_action_executions(action_code);

alter table public.canonical_action_executions enable row level security;
create policy "service_role_full_access" on public.canonical_action_executions
  for all using (true) with check (true);
