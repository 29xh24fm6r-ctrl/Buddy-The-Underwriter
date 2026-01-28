-- Buddy Observability Spine (Pulse)
-- Tables:
--  1) buddy_observer_events (append-only log)
--  2) buddy_deal_state (current state per deal; updated by ingestion)
--  3) buddy_incidents (optional incident ledger)

-- 1) Append-only event log
create table if not exists public.buddy_observer_events (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),

  schema_version int not null default 1,

  product text not null default 'buddy',
  env text not null, -- prod | preview | dev

  severity text not null, -- debug | info | warn | error | fatal
  type text not null,     -- deal.transition | deal.error | service.error | guard.fail | integration.fail

  deal_id text null,
  stage text null,        -- intake | underwriting | docs | closing | etc

  message text not null,

  fingerprint text not null, -- stable grouping key (SHA-256)

  context jsonb not null default '{}'::jsonb,
  error jsonb null,

  trace_id text null,
  request_id text null,

  release text null
);

create index if not exists buddy_events_created_at_idx
  on public.buddy_observer_events (created_at desc);

create index if not exists buddy_events_deal_id_created_at_idx
  on public.buddy_observer_events (deal_id, created_at desc);

create index if not exists buddy_events_severity_created_at_idx
  on public.buddy_observer_events (severity, created_at desc);

create index if not exists buddy_events_fingerprint_idx
  on public.buddy_observer_events (fingerprint);

create index if not exists buddy_events_type_stage_idx
  on public.buddy_observer_events (type, stage);

-- 2) Current deal state (fast queries; updated by ingestion)
create table if not exists public.buddy_deal_state (
  deal_id text primary key,

  env text not null,

  current_stage text null,
  last_event_at timestamptz not null default now(),

  last_transition_at timestamptz null,
  last_error_at timestamptz null,
  last_error_fingerprint text null,
  last_error_message text null,

  last_trace_id text null,
  last_request_id text null,
  last_release text null,

  updated_at timestamptz not null default now()
);

create index if not exists buddy_deal_state_env_last_event_idx
  on public.buddy_deal_state (env, last_event_at desc);

create index if not exists buddy_deal_state_env_stage_idx
  on public.buddy_deal_state (env, current_stage);

create index if not exists buddy_deal_state_env_last_error_idx
  on public.buddy_deal_state (env, last_error_at desc);

-- 3) Incidents (optional push mode)
create table if not exists public.buddy_incidents (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),

  env text not null,
  fingerprint text not null,

  window_min int not null,
  threshold int not null,

  count int not null,
  first_seen_at timestamptz not null,
  last_seen_at timestamptz not null,

  status text not null default 'open', -- open|ack|resolved
  last_notified_at timestamptz null
);

create index if not exists buddy_incidents_env_created_idx
  on public.buddy_incidents (env, created_at desc);

create index if not exists buddy_incidents_env_fingerprint_idx
  on public.buddy_incidents (env, fingerprint);

-- RLS: deny all direct access (service role bypasses RLS)
alter table public.buddy_observer_events enable row level security;
alter table public.buddy_deal_state enable row level security;
alter table public.buddy_incidents enable row level security;

drop policy if exists "deny_all" on public.buddy_observer_events;
create policy "deny_all" on public.buddy_observer_events for all using (false);

drop policy if exists "deny_all" on public.buddy_deal_state;
create policy "deny_all" on public.buddy_deal_state for all using (false);

drop policy if exists "deny_all" on public.buddy_incidents;
create policy "deny_all" on public.buddy_incidents for all using (false);
