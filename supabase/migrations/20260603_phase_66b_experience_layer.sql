-- ============================================================================
-- Phase 66B: Buddy God-Tier Experience Layer
-- ============================================================================
-- Creates:
--   1. buddy_material_change_events (material change engine)
--   2. buddy_agent_handoffs (agent choreography)
--   3. buddy_action_recommendations (decision engine)
--   4. buddy_conclusion_trust (trust layer)
--   5. buddy_borrower_readiness_paths (borrower storytelling)
--   6. buddy_monitoring_signals (monitoring flywheel)
-- ============================================================================

-- ============================================================================
-- 1. buddy_material_change_events
-- ============================================================================

create table if not exists buddy_material_change_events (
  id uuid primary key default gen_random_uuid(),
  bank_id uuid not null references banks(id),
  deal_id uuid not null references deals(id) on delete cascade,
  buddy_research_mission_id uuid null references buddy_research_missions(id) on delete set null,

  -- Change classification
  change_type text not null check (
    change_type in (
      'document_uploaded',
      'loan_amount_changed',
      'entity_name_changed',
      'financial_data_updated',
      'structure_changed',
      'benchmark_refreshed',
      'manual_override',
      'monitoring_signal'
    )
  ),
  change_scope text not null check (
    change_scope in ('trivial', 'localized', 'material', 'mission_wide')
  ),

  -- Fingerprints
  old_fingerprint text null,
  new_fingerprint text null,

  -- Materiality assessment
  materiality_score text not null check (
    materiality_score in ('none', 'low', 'medium', 'high', 'critical')
  ),

  -- Affected systems and reuse plan
  affected_systems_json jsonb not null default '{}',
  reuse_plan_json jsonb not null default '{}',

  -- Audit
  created_at timestamptz not null default now()
);

create index if not exists idx_material_changes_deal
  on buddy_material_change_events(deal_id, created_at desc);

create index if not exists idx_material_changes_bank
  on buddy_material_change_events(bank_id, change_scope);

-- ============================================================================
-- 2. buddy_agent_handoffs
-- ============================================================================

create table if not exists buddy_agent_handoffs (
  id uuid primary key default gen_random_uuid(),
  bank_id uuid not null references banks(id),
  deal_id uuid not null references deals(id) on delete cascade,

  -- Handoff routing
  from_agent_type text not null,
  to_agent_type text not null,
  visibility_scope text not null check (
    visibility_scope in ('banker', 'borrower', 'system', 'committee')
  ),
  handoff_type text not null check (
    handoff_type in (
      'data_request',
      'evidence_request',
      'analysis_request',
      'coaching_update',
      'escalation',
      'monitoring_alert'
    )
  ),

  -- Execution state
  status text not null default 'pending' check (
    status in ('pending', 'in_progress', 'complete', 'failed', 'cancelled')
  ),

  -- Contract and result
  task_contract_json jsonb not null default '{}',
  result_summary_json jsonb not null default '{}',

  -- Audit
  created_at timestamptz not null default now(),
  completed_at timestamptz null
);

create index if not exists idx_agent_handoffs_deal
  on buddy_agent_handoffs(deal_id, status, created_at desc);

create index if not exists idx_agent_handoffs_bank
  on buddy_agent_handoffs(bank_id);

-- ============================================================================
-- 3. buddy_action_recommendations
-- ============================================================================

create table if not exists buddy_action_recommendations (
  id uuid primary key default gen_random_uuid(),
  bank_id uuid not null references banks(id),
  deal_id uuid not null references deals(id) on delete cascade,

  -- Target
  visibility_scope text not null check (
    visibility_scope in ('banker', 'borrower', 'system')
  ),
  actor_type text not null check (
    actor_type in ('underwriter', 'borrower', 'system', 'committee')
  ),
  action_category text not null check (
    action_category in (
      'diligence_request',
      'structure_adjustment',
      'monitoring_step',
      'memo_improvement',
      'document_fix',
      'cash_improvement',
      'capital_structure',
      'lender_readiness',
      'operational_fix'
    )
  ),

  -- Priority + scoring
  priority_score int not null check (priority_score between 1 and 100),
  urgency_score int not null check (urgency_score between 1 and 100),
  confidence_score text not null check (
    confidence_score in ('high', 'medium', 'low')
  ),

  -- Context
  rationale_json jsonb not null default '{}',
  blocked_by_json jsonb not null default '{}',
  expected_impact_json jsonb not null default '{}',

  -- Lifecycle
  status text not null default 'open' check (
    status in ('open', 'accepted', 'dismissed', 'completed', 'invalidated')
  ),
  created_at timestamptz not null default now(),
  resolved_at timestamptz null
);

create index if not exists idx_action_recommendations_deal
  on buddy_action_recommendations(deal_id, status, priority_score desc);

create index if not exists idx_action_recommendations_bank
  on buddy_action_recommendations(bank_id, actor_type, status);

-- ============================================================================
-- 4. buddy_conclusion_trust
-- ============================================================================

create table if not exists buddy_conclusion_trust (
  id uuid primary key default gen_random_uuid(),
  bank_id uuid not null references banks(id),
  deal_id uuid not null references deals(id) on delete cascade,
  buddy_research_mission_id uuid null references buddy_research_missions(id) on delete set null,

  -- Conclusion identification
  conclusion_key text not null,

  -- Trust classification
  support_type text not null check (
    support_type in ('observed', 'derived', 'inferred', 'weakly_supported', 'stale', 'disputed')
  ),
  confidence_level text not null check (
    confidence_level in ('high', 'medium', 'low', 'insufficient')
  ),
  freshness_status text not null check (
    freshness_status in ('fresh', 'aging', 'stale', 'expired')
  ),
  contradiction_status text not null check (
    contradiction_status in ('none', 'minor', 'significant', 'unresolved')
  ),
  evidence_density text not null check (
    evidence_density in ('rich', 'adequate', 'sparse', 'none')
  ),
  decision_safe boolean not null default false,

  -- Summary
  trust_summary_json jsonb not null default '{}',

  -- Audit
  created_at timestamptz not null default now(),

  unique(deal_id, conclusion_key)
);

create index if not exists idx_conclusion_trust_deal
  on buddy_conclusion_trust(deal_id, support_type);

create index if not exists idx_conclusion_trust_bank
  on buddy_conclusion_trust(bank_id);

-- ============================================================================
-- 5. buddy_borrower_readiness_paths
-- ============================================================================

create table if not exists buddy_borrower_readiness_paths (
  id uuid primary key default gen_random_uuid(),
  bank_id uuid not null references banks(id),
  deal_id uuid not null references deals(id) on delete cascade,

  -- Readiness state
  path_status text not null check (
    path_status in ('on_track', 'at_risk', 'off_track', 'ready')
  ),
  primary_constraint text not null,
  secondary_constraints_json jsonb not null default '[]',
  milestones_json jsonb not null default '[]',
  recommended_sequence_json jsonb not null default '[]',

  -- Audit
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_readiness_paths_deal
  on buddy_borrower_readiness_paths(deal_id);

-- Updated_at trigger
create or replace function update_readiness_path_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_readiness_path_updated_at on buddy_borrower_readiness_paths;
create trigger trg_readiness_path_updated_at
  before update on buddy_borrower_readiness_paths
  for each row execute function update_readiness_path_updated_at();

-- ============================================================================
-- 6. buddy_monitoring_signals
-- ============================================================================

create table if not exists buddy_monitoring_signals (
  id uuid primary key default gen_random_uuid(),
  bank_id uuid not null references banks(id),
  deal_id uuid not null references deals(id) on delete cascade,

  -- Signal classification
  signal_type text not null check (
    signal_type in (
      'ar_deterioration',
      'margin_pressure',
      'covenant_drift',
      'payment_delay',
      'doc_pattern',
      'cash_anomaly',
      'leverage_spike',
      'revenue_decline',
      'expense_surge',
      'custom'
    )
  ),
  severity text not null check (severity in ('info', 'warning', 'alert', 'critical')),
  direction text not null check (direction in ('improving', 'stable', 'deteriorating')),

  -- Context
  source_context_json jsonb not null default '{}',
  recommended_actions_json jsonb not null default '[]',

  -- Flywheel flags
  fed_into_underwriting boolean not null default false,
  fed_into_borrower_coaching boolean not null default false,

  -- Audit
  created_at timestamptz not null default now()
);

create index if not exists idx_monitoring_signals_deal
  on buddy_monitoring_signals(deal_id, created_at desc);

create index if not exists idx_monitoring_signals_bank_severity
  on buddy_monitoring_signals(bank_id, severity);

-- ============================================================================
-- 7. RLS Policies
-- ============================================================================

alter table buddy_material_change_events enable row level security;
alter table buddy_agent_handoffs enable row level security;
alter table buddy_action_recommendations enable row level security;
alter table buddy_conclusion_trust enable row level security;
alter table buddy_borrower_readiness_paths enable row level security;
alter table buddy_monitoring_signals enable row level security;

-- Bank isolation policies
create policy "material_changes_bank_isolation" on buddy_material_change_events
  for all using (bank_id = (select bank_id from auth.users where id = auth.uid()));

create policy "agent_handoffs_bank_isolation" on buddy_agent_handoffs
  for all using (bank_id = (select bank_id from auth.users where id = auth.uid()));

create policy "action_recommendations_bank_isolation" on buddy_action_recommendations
  for all using (bank_id = (select bank_id from auth.users where id = auth.uid()));

create policy "conclusion_trust_bank_isolation" on buddy_conclusion_trust
  for all using (bank_id = (select bank_id from auth.users where id = auth.uid()));

create policy "readiness_paths_bank_isolation" on buddy_borrower_readiness_paths
  for all using (bank_id = (select bank_id from auth.users where id = auth.uid()));

create policy "monitoring_signals_bank_isolation" on buddy_monitoring_signals
  for all using (bank_id = (select bank_id from auth.users where id = auth.uid()));

-- Service role bypass
create policy "service_role_material_changes" on buddy_material_change_events
  for all using (auth.role() = 'service_role');
create policy "service_role_agent_handoffs" on buddy_agent_handoffs
  for all using (auth.role() = 'service_role');
create policy "service_role_action_recommendations" on buddy_action_recommendations
  for all using (auth.role() = 'service_role');
create policy "service_role_conclusion_trust" on buddy_conclusion_trust
  for all using (auth.role() = 'service_role');
create policy "service_role_readiness_paths" on buddy_borrower_readiness_paths
  for all using (auth.role() = 'service_role');
create policy "service_role_monitoring_signals" on buddy_monitoring_signals
  for all using (auth.role() = 'service_role');

-- ============================================================================
-- 8. Grants
-- ============================================================================

grant select on buddy_material_change_events to authenticated;
grant select on buddy_agent_handoffs to authenticated;
grant select on buddy_action_recommendations to authenticated;
grant select on buddy_conclusion_trust to authenticated;
grant select on buddy_borrower_readiness_paths to authenticated;
grant select on buddy_monitoring_signals to authenticated;
