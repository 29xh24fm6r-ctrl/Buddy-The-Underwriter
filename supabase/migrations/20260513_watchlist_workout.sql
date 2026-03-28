-- Phase 65K — Watchlist, Special Assets & Workout
-- 6 tables: watchlist_cases, watchlist_reasons, watchlist_events,
--           workout_cases, workout_action_items, workout_events

-- 1. One active watchlist record per deal at a time
create table if not exists public.deal_watchlist_cases (
  id uuid primary key default gen_random_uuid(),
  bank_id uuid not null references public.banks(id) on delete cascade,
  deal_id uuid not null references public.deals(id) on delete cascade,
  status text not null check (
    status in ('active','escalated_to_workout','resolved','dismissed')
  ),
  severity text not null check (
    severity in ('low','moderate','high','critical')
  ),
  primary_reason text not null,
  opened_at timestamptz not null default now(),
  opened_by text null,
  assigned_to text null,
  resolution_summary text null,
  resolved_at timestamptz null,
  escalated_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_dwc_bank_status
  on public.deal_watchlist_cases(bank_id, status, severity);
create index if not exists idx_dwc_deal_status
  on public.deal_watchlist_cases(deal_id, status);
create unique index if not exists idx_dwc_deal_active
  on public.deal_watchlist_cases(deal_id) where status = 'active';

-- 2. Normalized reasons attached to a watchlist case
create table if not exists public.deal_watchlist_reasons (
  id uuid primary key default gen_random_uuid(),
  watchlist_case_id uuid not null references public.deal_watchlist_cases(id) on delete cascade,
  reason_code text not null,
  source_type text not null check (
    source_type in ('monitoring_trigger','annual_review','banker_manual','renewal','policy_exception')
  ),
  source_id uuid null,
  narrative text null,
  created_at timestamptz not null default now()
);

create index if not exists idx_dwr_case
  on public.deal_watchlist_reasons(watchlist_case_id);

-- 3. Append-only watchlist chronology
create table if not exists public.deal_watchlist_events (
  id uuid primary key default gen_random_uuid(),
  watchlist_case_id uuid not null references public.deal_watchlist_cases(id) on delete cascade,
  deal_id uuid not null references public.deals(id) on delete cascade,
  event_type text not null,
  actor_user_id text null,
  event_at timestamptz not null default now(),
  summary text not null,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_dwle_case
  on public.deal_watchlist_events(watchlist_case_id, event_at desc);
create index if not exists idx_dwle_deal
  on public.deal_watchlist_events(deal_id, event_at desc);

-- 4. Canonical workout / special assets case
create table if not exists public.deal_workout_cases (
  id uuid primary key default gen_random_uuid(),
  bank_id uuid not null references public.banks(id) on delete cascade,
  deal_id uuid not null references public.deals(id) on delete cascade,
  watchlist_case_id uuid null references public.deal_watchlist_cases(id) on delete set null,
  status text not null check (
    status in ('active','modification_in_process','forbearance_in_process',
               'refinance_exit','liquidation_path','legal_path',
               'returned_to_pass','closed_loss','closed_paid_off','closed_other')
  ),
  severity text not null check (
    severity in ('high','critical')
  ),
  workout_strategy text not null,
  stage text not null check (
    stage in ('triage','diagnosis','action_plan','negotiation','approval','execution','resolution')
  ),
  opened_at timestamptz not null default now(),
  opened_by text null,
  assigned_to text null,
  special_assets_officer_id text null,
  problem_loan_code text null,
  default_flag boolean not null default false,
  nonaccrual_flag boolean not null default false,
  criticized_classification text null check (
    criticized_classification is null or
    criticized_classification in ('pass','special_mention','substandard','doubtful','loss')
  ),
  resolution_outcome text null,
  resolved_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_dwoc_bank_status
  on public.deal_workout_cases(bank_id, status, stage);
create index if not exists idx_dwoc_deal_status
  on public.deal_workout_cases(deal_id, status);
create unique index if not exists idx_dwoc_deal_active
  on public.deal_workout_cases(deal_id) where status = 'active';

-- 5. Workout action items / remediation tasks
create table if not exists public.deal_workout_action_items (
  id uuid primary key default gen_random_uuid(),
  workout_case_id uuid not null references public.deal_workout_cases(id) on delete cascade,
  deal_id uuid not null references public.deals(id) on delete cascade,
  owner_user_id text null,
  action_type text not null,
  title text not null,
  description text null,
  due_at timestamptz null,
  status text not null check (
    status in ('open','in_progress','blocked','completed','cancelled')
  ),
  completed_at timestamptz null,
  created_by text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_dwai_case
  on public.deal_workout_action_items(workout_case_id, status, due_at);
create index if not exists idx_dwai_deal
  on public.deal_workout_action_items(deal_id, status);

-- 6. Append-only workout chronology
create table if not exists public.deal_workout_events (
  id uuid primary key default gen_random_uuid(),
  workout_case_id uuid not null references public.deal_workout_cases(id) on delete cascade,
  deal_id uuid not null references public.deals(id) on delete cascade,
  event_type text not null,
  actor_user_id text null,
  event_at timestamptz not null default now(),
  summary text not null,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_dwoe_case
  on public.deal_workout_events(workout_case_id, event_at desc);
create index if not exists idx_dwoe_deal
  on public.deal_workout_events(deal_id, event_at desc);
