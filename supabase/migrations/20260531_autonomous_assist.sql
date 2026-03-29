-- Phase 65P: Autonomous Assist — guarded, optional autonomy layer

-- Autonomy profiles (bank/user preferences)
create table if not exists public.relationship_autonomy_profiles (
  id uuid primary key default gen_random_uuid(),
  bank_id uuid not null references public.banks(id) on delete cascade,
  user_id uuid not null,

  autonomy_mode text not null default 'manual',
  allow_auto_execute boolean not null default false,
  require_bundle_approval boolean not null default true,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint relationship_autonomy_profiles_mode_check check (
    autonomy_mode in ('manual','assistive','precommit_review','controlled_autonomy')
  )
);

alter table public.relationship_autonomy_profiles enable row level security;
create policy "bank_scoped_autonomy_profiles" on public.relationship_autonomy_profiles
  using (bank_id = (select bank_id from bank_users where user_id = auth.uid() limit 1));
create unique index if not exists uq_rel_autonomy_profiles_bank_user
  on public.relationship_autonomy_profiles (bank_id, user_id);

-- Autonomy plans (audit log)
create table if not exists public.relationship_autonomy_plans (
  id uuid primary key default gen_random_uuid(),
  relationship_id uuid not null,
  bank_id uuid not null references public.banks(id) on delete cascade,
  user_id uuid not null,

  autonomy_mode text not null,
  plan_payload jsonb not null,
  rationale jsonb not null default '[]'::jsonb,

  requires_approval boolean not null default true,
  status text not null default 'generated',

  generated_at timestamptz not null default now(),

  constraint relationship_autonomy_plans_mode_check check (
    autonomy_mode in ('manual','assistive','precommit_review','controlled_autonomy')
  ),
  constraint relationship_autonomy_plans_status_check check (
    status in ('generated','approved','partially_executed','executed','blocked','cancelled','failed')
  )
);

alter table public.relationship_autonomy_plans enable row level security;
create policy "bank_scoped_autonomy_plans" on public.relationship_autonomy_plans
  using (bank_id = (select bank_id from bank_users where user_id = auth.uid() limit 1));
create index if not exists idx_rel_autonomy_plans_relationship
  on public.relationship_autonomy_plans (relationship_id, generated_at desc);

-- Execution log (immutable)
create table if not exists public.relationship_autonomy_execution_log (
  id uuid primary key default gen_random_uuid(),
  relationship_id uuid not null,
  bank_id uuid not null references public.banks(id) on delete cascade,
  user_id uuid not null,

  plan_id uuid null references public.relationship_autonomy_plans(id) on delete set null,

  action_type text not null,
  execution_mode text not null,
  status text not null,

  payload jsonb not null,
  evidence jsonb not null default '[]'::jsonb,
  error_message text null,

  created_at timestamptz not null default now(),

  constraint relationship_autonomy_execution_mode_check check (
    execution_mode in ('draft_only','approval_required','auto_execute')
  ),
  constraint relationship_autonomy_execution_status_check check (
    status in ('planned','blocked','approved','executed','failed','cancelled')
  )
);

alter table public.relationship_autonomy_execution_log enable row level security;
create policy "bank_scoped_autonomy_execution_log" on public.relationship_autonomy_execution_log
  using (bank_id = (select bank_id from bank_users where user_id = auth.uid() limit 1));
create index if not exists idx_rel_autonomy_execution_log_plan
  on public.relationship_autonomy_execution_log (plan_id, created_at desc);
create index if not exists idx_rel_autonomy_execution_log_relationship
  on public.relationship_autonomy_execution_log (relationship_id, created_at desc);

-- Autonomy events (append-only ledger)
create table if not exists public.relationship_autonomy_events (
  id uuid primary key default gen_random_uuid(),
  relationship_id uuid not null,
  bank_id uuid not null references public.banks(id) on delete cascade,

  event_code text not null,
  actor_type text not null default 'system',
  actor_user_id uuid null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),

  constraint relationship_autonomy_events_actor_type_check check (
    actor_type in ('system','banker','borrower','cron','migration')
  )
);

alter table public.relationship_autonomy_events enable row level security;
create policy "bank_scoped_autonomy_events" on public.relationship_autonomy_events
  using (bank_id = (select bank_id from bank_users where user_id = auth.uid() limit 1));
create index if not exists idx_rel_autonomy_events_relationship
  on public.relationship_autonomy_events (relationship_id, created_at desc);
