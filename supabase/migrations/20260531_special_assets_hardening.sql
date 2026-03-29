-- Phase 65M: Special Assets Fusion & Hardening
-- Adds hardening columns, distress rollups, and SLA tracking

-- 65M.2: Watchlist entry hardening columns
alter table public.deal_watchlist_cases
  add column if not exists next_review_due_at timestamptz null,
  add column if not exists exit_criteria_json jsonb not null default '{}',
  add column if not exists policy_basis_code text null,
  add column if not exists entered_with_evidence_count integer not null default 0;

-- 65M.3: Workout strategy hardening columns
alter table public.deal_workout_cases
  add column if not exists next_milestone_due_at timestamptz null,
  add column if not exists strategy_rationale text null,
  add column if not exists expected_exit_path text null,
  add column if not exists downside_path text null,
  add column if not exists legal_involved boolean not null default false,
  add column if not exists approved_strategy_at timestamptz null,
  add column if not exists approved_strategy_by uuid null;

-- 65M.3: Action item hardening
alter table public.deal_workout_action_items
  add column if not exists blocker_type text null,
  add column if not exists blocker_detail text null,
  add column if not exists waived_at timestamptz null,
  add column if not exists waived_by uuid null,
  add column if not exists waiver_reason text null;

-- 65M.7: Relationship distress rollups
create table if not exists public.relationship_distress_rollups (
  id uuid primary key default gen_random_uuid(),
  relationship_id uuid not null,
  bank_id uuid not null references public.banks(id) on delete cascade,

  highest_state text not null default 'healthy',
  highest_severity text null,
  active_deal_count integer not null default 0,
  active_watchlist_count integer not null default 0,
  active_workout_count integer not null default 0,

  recomputed_at timestamptz not null default now(),

  constraint rel_distress_rollups_state_check check (
    highest_state in ('healthy','monitored','watchlist_exposure','workout_exposure','mixed_distress','resolved')
  )
);

alter table public.relationship_distress_rollups enable row level security;

create policy "bank_scoped_distress_rollups" on public.relationship_distress_rollups
  using (bank_id = (select bank_id from bank_users where user_id = auth.uid() limit 1));

create index if not exists idx_rel_distress_rollups_relationship
  on public.relationship_distress_rollups (relationship_id);
create index if not exists idx_rel_distress_rollups_bank
  on public.relationship_distress_rollups (bank_id, highest_state);

-- 65K.6: Decision transition events
create table if not exists public.relationship_decision_transitions (
  id uuid primary key default gen_random_uuid(),
  relationship_id uuid not null,
  bank_id uuid not null references public.banks(id) on delete cascade,

  previous_tier text null,
  new_tier text not null,
  previous_action_code text null,
  new_action_code text null,
  changes jsonb not null default '[]',
  envelope_snapshot jsonb not null default '{}',

  transitioned_at timestamptz not null default now(),

  constraint rel_decision_transitions_tier_check check (
    new_tier in ('integrity','critical_distress','time_bound_work','borrower_blocked','protection','growth','informational')
  )
);

alter table public.relationship_decision_transitions enable row level security;

create policy "bank_scoped_decision_transitions" on public.relationship_decision_transitions
  using (bank_id = (select bank_id from bank_users where user_id = auth.uid() limit 1));

create index if not exists idx_rel_decision_transitions_relationship
  on public.relationship_decision_transitions (relationship_id, transitioned_at desc);
