-- Phase 65H — Banker Work Queue & Command Center
-- Tables: banker_queue_snapshots, banker_focus_sessions, banker_queue_acknowledgements

-- 1. Cached queue surface for fast rendering (self-healing: regenerated on read)
create table if not exists public.banker_queue_snapshots (
  id uuid primary key default gen_random_uuid(),
  bank_id uuid not null references public.banks(id) on delete cascade,
  deal_id uuid not null references public.deals(id) on delete cascade,
  canonical_stage text not null,
  urgency_bucket text not null check (
    urgency_bucket in ('healthy','watch','urgent','critical')
  ),
  urgency_score integer not null default 0,
  primary_action_code text null,
  primary_action_label text null,
  primary_action_priority text null,
  primary_action_age_hours integer null,
  is_action_executable boolean not null default false,
  queue_domain text not null,
  queue_reason_code text not null,
  queue_reason_label text not null,
  blocking_party text not null check (
    blocking_party in ('banker','borrower','buddy','mixed','unknown')
  ),
  borrower_campaign_status text null,
  borrower_overdue_count integer not null default 0,
  review_backlog_count integer not null default 0,
  active_escalation_count integer not null default 0,
  latest_activity_at timestamptz null,
  computed_at timestamptz not null default now()
);

create index if not exists idx_banker_queue_snapshots_bank_id
  on public.banker_queue_snapshots(bank_id, computed_at desc);

create index if not exists idx_banker_queue_snapshots_deal_id
  on public.banker_queue_snapshots(deal_id, computed_at desc);

-- 2. Focus sessions: tracks banker viewing/working sessions
create table if not exists public.banker_focus_sessions (
  id uuid primary key default gen_random_uuid(),
  bank_id uuid not null references public.banks(id) on delete cascade,
  user_id text not null,
  started_at timestamptz not null default now(),
  ended_at timestamptz null,
  active_filter jsonb not null default '{}'::jsonb
);

create index if not exists idx_banker_focus_sessions_user
  on public.banker_focus_sessions(bank_id, user_id, started_at desc);

-- 3. Acknowledgements: banker can ack a queue item without suppressing urgency
create table if not exists public.banker_queue_acknowledgements (
  id uuid primary key default gen_random_uuid(),
  bank_id uuid not null references public.banks(id) on delete cascade,
  user_id text not null,
  deal_id uuid not null references public.deals(id) on delete cascade,
  queue_reason_code text not null,
  acknowledged_at timestamptz not null default now(),
  note text null
);

create index if not exists idx_banker_queue_ack_deal
  on public.banker_queue_acknowledgements(deal_id, acknowledged_at desc);

create index if not exists idx_banker_queue_ack_user
  on public.banker_queue_acknowledgements(bank_id, user_id, acknowledged_at desc);
