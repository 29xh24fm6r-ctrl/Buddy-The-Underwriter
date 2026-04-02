-- ============================================================================
-- Phase 66C: Live Outcome Dominance
-- ============================================================================
-- Creates:
--   1. buddy_outcome_events (outcome measurement)
--   2. buddy_outcome_snapshots (outcome measurement)
--   3. buddy_recommendation_outcomes (recommendation quality)
--   4. buddy_borrower_actions_taken (borrower uplift)
--   5. buddy_readiness_uplift_snapshots (borrower uplift)
--   6. buddy_banker_trust_events (banker trust calibration)
--   7. buddy_tuning_candidates (production tuning)
--   8. buddy_tuning_decisions (production tuning)
--   9. buddy_feedback_events (human feedback)
--  10. buddy_experiments (experimentation)
--  11. buddy_experiment_assignments (experimentation)
-- ============================================================================

-- 1. buddy_outcome_events
create table if not exists buddy_outcome_events (
  id uuid primary key default gen_random_uuid(),
  bank_id uuid not null references banks(id),
  deal_id uuid not null references deals(id) on delete cascade,
  actor_type text not null check (actor_type in ('banker','borrower','system')),
  event_type text not null,
  source_system text not null,
  visibility_scope text not null check (visibility_scope in ('banker','borrower','system','internal')),
  payload_json jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index if not exists idx_outcome_events_deal on buddy_outcome_events(deal_id, event_type, created_at desc);
create index if not exists idx_outcome_events_bank on buddy_outcome_events(bank_id, created_at desc);

-- 2. buddy_outcome_snapshots
create table if not exists buddy_outcome_snapshots (
  id uuid primary key default gen_random_uuid(),
  bank_id uuid not null references banks(id),
  deal_id uuid not null references deals(id) on delete cascade,
  snapshot_type text not null check (snapshot_type in ('daily','weekly','milestone','final')),
  metrics_json jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index if not exists idx_outcome_snapshots_deal on buddy_outcome_snapshots(deal_id, snapshot_type, created_at desc);

-- 3. buddy_recommendation_outcomes
create table if not exists buddy_recommendation_outcomes (
  id uuid primary key default gen_random_uuid(),
  bank_id uuid not null references banks(id),
  deal_id uuid not null references deals(id) on delete cascade,
  recommendation_id uuid not null references buddy_action_recommendations(id) on delete cascade,
  outcome_status text not null check (outcome_status in ('accepted','rejected','ignored','deferred','completed','invalidated')),
  accepted_by_actor_type text null,
  usefulness_score int null check (usefulness_score is null or usefulness_score between 1 and 5),
  timing_score int null check (timing_score is null or timing_score between 1 and 5),
  impact_score int null check (impact_score is null or impact_score between 1 and 5),
  overridden boolean not null default false,
  override_reason text null,
  created_at timestamptz not null default now()
);
create index if not exists idx_rec_outcomes_deal on buddy_recommendation_outcomes(deal_id, outcome_status);
create index if not exists idx_rec_outcomes_rec on buddy_recommendation_outcomes(recommendation_id);

-- 4. buddy_borrower_actions_taken
create table if not exists buddy_borrower_actions_taken (
  id uuid primary key default gen_random_uuid(),
  bank_id uuid not null references banks(id),
  deal_id uuid not null references deals(id) on delete cascade,
  readiness_path_id uuid null references buddy_borrower_readiness_paths(id) on delete set null,
  action_key text not null,
  action_source text not null check (action_source in ('recommendation','milestone','coaching','self_initiated')),
  status text not null check (status in ('pending','in_progress','completed','abandoned','not_applicable')),
  evidence_json jsonb not null default '{}',
  completed_at timestamptz null,
  created_at timestamptz not null default now()
);
create index if not exists idx_borrower_actions_deal on buddy_borrower_actions_taken(deal_id, status);

-- 5. buddy_readiness_uplift_snapshots
create table if not exists buddy_readiness_uplift_snapshots (
  id uuid primary key default gen_random_uuid(),
  bank_id uuid not null references banks(id),
  deal_id uuid not null references deals(id) on delete cascade,
  readiness_score_before numeric null,
  readiness_score_after numeric null,
  uplift_summary_json jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index if not exists idx_readiness_uplift_deal on buddy_readiness_uplift_snapshots(deal_id, created_at desc);

-- 6. buddy_banker_trust_events
create table if not exists buddy_banker_trust_events (
  id uuid primary key default gen_random_uuid(),
  bank_id uuid not null references banks(id),
  deal_id uuid not null references deals(id) on delete cascade,
  actor_id uuid null,
  event_type text not null check (event_type in ('badge_viewed','evidence_drilldown','recommendation_accepted','recommendation_rejected','override','manual_edit','memo_reuse','trust_questioned')),
  conclusion_key text null,
  recommendation_id uuid null references buddy_action_recommendations(id) on delete set null,
  payload_json jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index if not exists idx_banker_trust_events_deal on buddy_banker_trust_events(deal_id, event_type, created_at desc);
create index if not exists idx_banker_trust_events_bank on buddy_banker_trust_events(bank_id);

-- 7. buddy_tuning_candidates
create table if not exists buddy_tuning_candidates (
  id uuid primary key default gen_random_uuid(),
  bank_id uuid null references banks(id) on delete set null,
  tuning_domain text not null check (tuning_domain in ('action_ranking','trust_thresholds','scenario_order','warning_suppression','handoff_priority','borrower_sequencing','presentation_order')),
  candidate_key text not null,
  before_json jsonb not null default '{}',
  after_json jsonb not null default '{}',
  evidence_json jsonb not null default '{}',
  status text not null default 'proposed' check (status in ('proposed','approved','rejected','applied','rolled_back')),
  created_at timestamptz not null default now()
);
create index if not exists idx_tuning_candidates_domain on buddy_tuning_candidates(tuning_domain, status);

-- 8. buddy_tuning_decisions
create table if not exists buddy_tuning_decisions (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references buddy_tuning_candidates(id) on delete cascade,
  decision text not null check (decision in ('approve','reject','defer','rollback')),
  decision_reason text null,
  approved_by text null,
  created_at timestamptz not null default now()
);
create index if not exists idx_tuning_decisions_candidate on buddy_tuning_decisions(candidate_id);

-- 9. buddy_feedback_events
create table if not exists buddy_feedback_events (
  id uuid primary key default gen_random_uuid(),
  bank_id uuid not null references banks(id),
  deal_id uuid null references deals(id) on delete set null,
  actor_type text not null check (actor_type in ('banker','borrower','system')),
  feedback_type text not null check (feedback_type in ('helpful','unhelpful','confusing','irrelevant','too_early','too_late','unrealistic','misleading','override_reason','suggestion')),
  source_surface text not null,
  linked_entity_type text null,
  linked_entity_id uuid null,
  feedback_text text null,
  normalized_feedback_json jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index if not exists idx_feedback_events_deal on buddy_feedback_events(deal_id, feedback_type, created_at desc);
create index if not exists idx_feedback_events_bank on buddy_feedback_events(bank_id);

-- 10. buddy_experiments
create table if not exists buddy_experiments (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  domain text not null check (domain in ('card_order','wording','trust_badges','scenario_order','recommendation_grouping','dashboard_layout')),
  status text not null default 'draft' check (status in ('draft','running','paused','completed','rolled_back')),
  definition_json jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index if not exists idx_experiments_status on buddy_experiments(status);

-- 11. buddy_experiment_assignments
create table if not exists buddy_experiment_assignments (
  id uuid primary key default gen_random_uuid(),
  experiment_id uuid not null references buddy_experiments(id) on delete cascade,
  bank_id uuid not null references banks(id),
  deal_id uuid null references deals(id) on delete set null,
  actor_type text not null check (actor_type in ('banker','borrower')),
  variant_key text not null,
  created_at timestamptz not null default now()
);
create index if not exists idx_experiment_assignments_exp on buddy_experiment_assignments(experiment_id, variant_key);
create index if not exists idx_experiment_assignments_bank on buddy_experiment_assignments(bank_id);

-- ============================================================================
-- RLS
-- ============================================================================
alter table buddy_outcome_events enable row level security;
alter table buddy_outcome_snapshots enable row level security;
alter table buddy_recommendation_outcomes enable row level security;
alter table buddy_borrower_actions_taken enable row level security;
alter table buddy_readiness_uplift_snapshots enable row level security;
alter table buddy_banker_trust_events enable row level security;
alter table buddy_tuning_candidates enable row level security;
alter table buddy_tuning_decisions enable row level security;
alter table buddy_feedback_events enable row level security;
alter table buddy_experiments enable row level security;
alter table buddy_experiment_assignments enable row level security;

-- Bank isolation
create policy "outcome_events_bank" on buddy_outcome_events for all using (bank_id = (select bank_id from auth.users where id = auth.uid()));
create policy "outcome_snapshots_bank" on buddy_outcome_snapshots for all using (bank_id = (select bank_id from auth.users where id = auth.uid()));
create policy "rec_outcomes_bank" on buddy_recommendation_outcomes for all using (bank_id = (select bank_id from auth.users where id = auth.uid()));
create policy "borrower_actions_bank" on buddy_borrower_actions_taken for all using (bank_id = (select bank_id from auth.users where id = auth.uid()));
create policy "readiness_uplift_bank" on buddy_readiness_uplift_snapshots for all using (bank_id = (select bank_id from auth.users where id = auth.uid()));
create policy "banker_trust_bank" on buddy_banker_trust_events for all using (bank_id = (select bank_id from auth.users where id = auth.uid()));
create policy "tuning_candidates_access" on buddy_tuning_candidates for all using (bank_id is null or bank_id = (select bank_id from auth.users where id = auth.uid()));
create policy "tuning_decisions_access" on buddy_tuning_decisions for all using (exists (select 1 from buddy_tuning_candidates c where c.id = candidate_id and (c.bank_id is null or c.bank_id = (select bank_id from auth.users where id = auth.uid()))));
create policy "feedback_events_bank" on buddy_feedback_events for all using (bank_id = (select bank_id from auth.users where id = auth.uid()));
create policy "experiments_access" on buddy_experiments for select using (true);
create policy "experiment_assignments_bank" on buddy_experiment_assignments for all using (bank_id = (select bank_id from auth.users where id = auth.uid()));

-- Service role bypass
create policy "sr_outcome_events" on buddy_outcome_events for all using (auth.role() = 'service_role');
create policy "sr_outcome_snapshots" on buddy_outcome_snapshots for all using (auth.role() = 'service_role');
create policy "sr_rec_outcomes" on buddy_recommendation_outcomes for all using (auth.role() = 'service_role');
create policy "sr_borrower_actions" on buddy_borrower_actions_taken for all using (auth.role() = 'service_role');
create policy "sr_readiness_uplift" on buddy_readiness_uplift_snapshots for all using (auth.role() = 'service_role');
create policy "sr_banker_trust" on buddy_banker_trust_events for all using (auth.role() = 'service_role');
create policy "sr_tuning_candidates" on buddy_tuning_candidates for all using (auth.role() = 'service_role');
create policy "sr_tuning_decisions" on buddy_tuning_decisions for all using (auth.role() = 'service_role');
create policy "sr_feedback_events" on buddy_feedback_events for all using (auth.role() = 'service_role');
create policy "sr_experiments" on buddy_experiments for all using (auth.role() = 'service_role');
create policy "sr_experiment_assignments" on buddy_experiment_assignments for all using (auth.role() = 'service_role');

-- Grants
grant select on buddy_outcome_events to authenticated;
grant select on buddy_outcome_snapshots to authenticated;
grant select on buddy_recommendation_outcomes to authenticated;
grant select on buddy_borrower_actions_taken to authenticated;
grant select on buddy_readiness_uplift_snapshots to authenticated;
grant select on buddy_banker_trust_events to authenticated;
grant select on buddy_tuning_candidates to authenticated;
grant select on buddy_tuning_decisions to authenticated;
grant select on buddy_feedback_events to authenticated;
grant select on buddy_experiments to authenticated;
grant select on buddy_experiment_assignments to authenticated;
