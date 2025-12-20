-- 20251219_ops_incidents.sql
-- Institutional Ops Incidents for Reminder System
-- Stores incidents persistently + acknowledgements + notes + action audit

begin;

-- 1) Ops Incidents (persistent)
create table if not exists public.ops_incidents (
  id text primary key,                           -- stable client-generated key (e.g. `${endAt}|${latestRunId}`)
  source text not null default 'reminders',       -- future-proof (other subsystems)
  severity text not null check (severity in ('SEV-1','SEV-2','SEV-3')),
  status text not null default 'open' check (status in ('open','resolved')),

  started_at timestamptz not null,
  ended_at timestamptz not null,
  resolved_at timestamptz null,

  error_count integer not null default 0,
  unique_subscriptions integer not null default 0,
  subscription_ids uuid[] not null default '{}'::uuid[],

  latest_run_id uuid null,
  latest_error text null,

  acknowledged_at timestamptz null,
  acknowledged_by uuid null,
  notes text null,

  last_action_at timestamptz null,
  last_action text null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists ops_incidents_source_started_at_idx on public.ops_incidents (source, started_at desc);
create index if not exists ops_incidents_source_status_idx on public.ops_incidents (source, status, ended_at desc);
create index if not exists ops_incidents_source_severity_idx on public.ops_incidents (source, severity, ended_at desc);

-- 2) Action audit log
create table if not exists public.ops_incident_actions (
  id uuid primary key default gen_random_uuid(),
  incident_id text not null references public.ops_incidents(id) on delete cascade,
  source text not null default 'reminders',

  action text not null,                           -- e.g. mute, force_run
  actor text null,                                -- future: user_id/email/service, for now optional
  payload jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now()
);

create index if not exists ops_incident_actions_incident_id_idx on public.ops_incident_actions (incident_id, created_at desc);

-- 3) Updated_at trigger helper
create or replace function public.tg_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_updated_at_on_ops_incidents on public.ops_incidents;
create trigger set_updated_at_on_ops_incidents
before update on public.ops_incidents
for each row
execute function public.tg_set_updated_at();

-- 4) RLS (locked down). supabaseAdmin(service_role) bypasses RLS.
alter table public.ops_incidents enable row level security;
alter table public.ops_incident_actions enable row level security;

-- No policies = locked to service_role only (good for admin-only ops tables)

commit;
