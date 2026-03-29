-- Phase 65N: Portfolio Intelligence
-- Score snapshots (append-only), current scores (latest), signals

-- Current portfolio scores (latest projection per relationship)
create table if not exists public.relationship_portfolio_scores (
  id uuid primary key default gen_random_uuid(),
  relationship_id uuid not null,
  bank_id uuid not null references public.banks(id) on delete cascade,

  system_tier text not null,
  rank_position integer not null,
  total_score integer not null,

  severity_weight integer not null default 0,
  deadline_weight integer not null default 0,
  exposure_weight integer not null default 0,
  evidence_weight integer not null default 0,
  policy_weight integer not null default 0,
  age_weight integer not null default 0,

  primary_action_code text null,
  explanation text not null,
  drivers jsonb not null default '{}',

  computed_at timestamptz not null default now(),

  constraint rel_portfolio_scores_tier_check check (
    system_tier in ('integrity','critical_distress','time_bound_work','borrower_blocked','protection','growth','informational')
  )
);

alter table public.relationship_portfolio_scores enable row level security;

create policy "bank_scoped_portfolio_scores" on public.relationship_portfolio_scores
  using (bank_id = (select bank_id from bank_users where user_id = auth.uid() limit 1));

create unique index if not exists uq_rel_portfolio_scores_relationship
  on public.relationship_portfolio_scores (relationship_id);
create index if not exists idx_rel_portfolio_scores_bank_rank
  on public.relationship_portfolio_scores (bank_id, rank_position);

-- Score snapshot history (append-only for audit)
create table if not exists public.relationship_portfolio_score_snapshots (
  id uuid primary key default gen_random_uuid(),
  relationship_id uuid not null,
  bank_id uuid not null references public.banks(id) on delete cascade,

  system_tier text not null,
  rank_position integer not null,
  total_score integer not null,
  primary_action_code text null,
  drivers jsonb not null default '{}',
  snapshot_at timestamptz not null default now()
);

alter table public.relationship_portfolio_score_snapshots enable row level security;

create policy "bank_scoped_portfolio_score_snapshots" on public.relationship_portfolio_score_snapshots
  using (bank_id = (select bank_id from bank_users where user_id = auth.uid() limit 1));

create index if not exists idx_rel_portfolio_score_snapshots_relationship
  on public.relationship_portfolio_score_snapshots (relationship_id, snapshot_at desc);

-- Portfolio signals (cross-relationship pattern detection)
create table if not exists public.portfolio_signals (
  id uuid primary key default gen_random_uuid(),
  bank_id uuid not null references public.banks(id) on delete cascade,

  signal_type text not null,
  severity text not null default 'low',
  relationship_ids jsonb not null default '[]',
  explanation text not null,
  evidence_ids jsonb not null default '[]',

  detected_at timestamptz not null default now(),

  constraint portfolio_signals_type_check check (
    signal_type in (
      'deposit_runoff_cluster',
      'renewal_wave',
      'industry_stress_cluster',
      'treasury_stall_cluster',
      'growth_opportunity_cluster'
    )
  ),
  constraint portfolio_signals_severity_check check (
    severity in ('low','moderate','high','critical')
  )
);

alter table public.portfolio_signals enable row level security;

create policy "bank_scoped_portfolio_signals" on public.portfolio_signals
  using (bank_id = (select bank_id from bank_users where user_id = auth.uid() limit 1));

create index if not exists idx_portfolio_signals_bank
  on public.portfolio_signals (bank_id, detected_at desc);
create index if not exists idx_portfolio_signals_type
  on public.portfolio_signals (signal_type, severity);
