-- Phase 65G — Auto-Advance & SLA Intelligence
-- SLA snapshots, escalation events, auto-advance events, primary action history

-- 1. SLA aging snapshots (one row per computation cycle per deal)
create table if not exists public.deal_sla_snapshots (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references public.deals(id) on delete cascade,
  bank_id uuid not null references public.banks(id) on delete cascade,
  canonical_stage text not null,
  stage_started_at timestamptz null,
  stage_age_hours integer not null default 0,
  primary_action_code text null,
  primary_action_age_hours integer null,
  borrower_campaigns_open integer not null default 0,
  borrower_campaigns_overdue integer not null default 0,
  critical_items_overdue integer not null default 0,
  banker_tasks_stale integer not null default 0,
  is_stage_overdue boolean not null default false,
  is_primary_action_stale boolean not null default false,
  is_deal_stuck boolean not null default false,
  urgency_score integer not null default 0,
  urgency_bucket text not null check (
    urgency_bucket in ('healthy','watch','urgent','critical')
  ),
  computed_at timestamptz not null default now()
);

create index if not exists idx_dss_deal_id on public.deal_sla_snapshots(deal_id);
create index if not exists idx_dss_computed_at on public.deal_sla_snapshots(computed_at desc);

alter table public.deal_sla_snapshots enable row level security;
create policy "service_role_full_access_dss" on public.deal_sla_snapshots
  for all using (true) with check (true);

-- 2. Escalation events (stable, deduped, resolvable)
create table if not exists public.deal_escalation_events (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references public.deals(id) on delete cascade,
  bank_id uuid not null references public.banks(id) on delete cascade,
  escalation_code text not null,
  severity text not null check (
    severity in ('info','watch','urgent','critical')
  ),
  source text not null,
  related_object_type text null,
  related_object_id text null,
  message text not null,
  is_active boolean not null default true,
  first_triggered_at timestamptz not null default now(),
  last_triggered_at timestamptz not null default now(),
  resolved_at timestamptz null
);

create index if not exists idx_dee_deal_id on public.deal_escalation_events(deal_id);
create index if not exists idx_dee_is_active on public.deal_escalation_events(is_active)
  where is_active = true;

alter table public.deal_escalation_events enable row level security;
create policy "service_role_full_access_dee" on public.deal_escalation_events
  for all using (true) with check (true);

-- 3. Auto-advance events (audit trail)
create table if not exists public.deal_auto_advance_events (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references public.deals(id) on delete cascade,
  bank_id uuid not null references public.banks(id) on delete cascade,
  from_stage text null,
  to_stage text not null,
  trigger_code text not null,
  evidence jsonb not null default '{}'::jsonb,
  executed_by text not null default 'system',
  created_at timestamptz not null default now()
);

create index if not exists idx_daae_deal_id on public.deal_auto_advance_events(deal_id);

alter table public.deal_auto_advance_events enable row level security;
create policy "service_role_full_access_daae" on public.deal_auto_advance_events
  for all using (true) with check (true);

-- 4. Primary action history (lightweight tracking for action age stability)
create table if not exists public.deal_primary_action_history (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references public.deals(id) on delete cascade,
  action_code text not null,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  is_current boolean not null default true
);

create index if not exists idx_dpah_deal_id on public.deal_primary_action_history(deal_id);
create index if not exists idx_dpah_current on public.deal_primary_action_history(deal_id)
  where is_current = true;

alter table public.deal_primary_action_history enable row level security;
create policy "service_role_full_access_dpah" on public.deal_primary_action_history
  for all using (true) with check (true);
