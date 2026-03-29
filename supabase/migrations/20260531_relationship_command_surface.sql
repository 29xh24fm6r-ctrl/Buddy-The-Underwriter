-- Phase 65L: Relationship OS Command Surface + Operating Discipline Hardening
-- 3 new tables: surface snapshots, acknowledgements, focus sessions

-- ---------------------------------------------------------------------------
-- 15.1 Surface Snapshots (cached, disposable projections for fast render)
-- ---------------------------------------------------------------------------
create table if not exists public.relationship_surface_snapshots (
  id uuid primary key default gen_random_uuid(),
  relationship_id uuid not null,
  bank_id uuid not null references public.banks(id) on delete cascade,

  priority_bucket text not null,
  priority_score integer not null,
  primary_reason_code text not null,
  primary_action_code text null,
  changed_since_viewed boolean not null default false,

  surface_payload jsonb not null,
  computed_at timestamptz not null default now(),

  constraint relationship_surface_snapshots_priority_check check (
    priority_bucket in ('critical','urgent','watch','healthy')
  )
);

alter table public.relationship_surface_snapshots enable row level security;

create policy "bank_scoped_surface_snapshots" on public.relationship_surface_snapshots
  using (bank_id = (select bank_id from bank_users where user_id = auth.uid() limit 1));

create index if not exists idx_rel_surface_snapshots_relationship
  on public.relationship_surface_snapshots (relationship_id, computed_at desc);
create index if not exists idx_rel_surface_snapshots_bank_priority
  on public.relationship_surface_snapshots (bank_id, priority_bucket, priority_score desc);

-- ---------------------------------------------------------------------------
-- 13. Surface Acknowledgements
-- ---------------------------------------------------------------------------
create table if not exists public.relationship_surface_acknowledgements (
  id uuid primary key default gen_random_uuid(),
  relationship_id uuid not null,
  bank_id uuid not null references public.banks(id) on delete cascade,
  user_id uuid not null,

  primary_reason_code text not null,
  acknowledged_at timestamptz not null default now(),
  note text null
);

alter table public.relationship_surface_acknowledgements enable row level security;

create policy "bank_scoped_surface_acknowledgements" on public.relationship_surface_acknowledgements
  using (bank_id = (select bank_id from bank_users where user_id = auth.uid() limit 1));

create index if not exists idx_rel_surface_ack_relationship
  on public.relationship_surface_acknowledgements (relationship_id, acknowledged_at desc);
create index if not exists idx_rel_surface_ack_user
  on public.relationship_surface_acknowledgements (user_id, acknowledged_at desc);

-- ---------------------------------------------------------------------------
-- 15.2 Focus Sessions (banker attention tracking)
-- ---------------------------------------------------------------------------
create table if not exists public.relationship_focus_sessions (
  id uuid primary key default gen_random_uuid(),
  relationship_id uuid not null,
  bank_id uuid not null references public.banks(id) on delete cascade,
  user_id uuid not null,

  started_at timestamptz not null default now(),
  ended_at timestamptz null,
  context jsonb not null default '{}'::jsonb
);

alter table public.relationship_focus_sessions enable row level security;

create policy "bank_scoped_focus_sessions" on public.relationship_focus_sessions
  using (bank_id = (select bank_id from bank_users where user_id = auth.uid() limit 1));

create index if not exists idx_rel_focus_sessions_relationship
  on public.relationship_focus_sessions (relationship_id, started_at desc);
create index if not exists idx_rel_focus_sessions_user
  on public.relationship_focus_sessions (user_id, started_at desc);
