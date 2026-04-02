-- ============================================================================
-- Phase 66A: Buddy Multi-Agent Control Plane + Resumable Intelligence Runtime
-- ============================================================================
-- Creates:
--   1. buddy_research_missions extensions (checkpoint/resume columns)
--   2. buddy_research_thread_runs (per-stage execution tracking)
--   3. buddy_research_checkpoints (resumable state snapshots)
--   4. buddy_research_failure_library (institutional failure memory)
--   5. buddy_research_evidence (structured evidence linkage)
--   6. buddy_agent_sessions (multi-agent session state)
--   7. buddy_borrower_insight_runs (borrower financial insights)
--   8. buddy_ratio_explanations (plain-English ratio explanations)
-- ============================================================================

-- ============================================================================
-- 1. Extend buddy_research_missions (checkpoint/resume columns)
-- ============================================================================

do $$
begin
  -- resume_from_checkpoint
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'buddy_research_missions'
      and column_name = 'resume_from_checkpoint'
  ) then
    alter table public.buddy_research_missions
      add column resume_from_checkpoint uuid null,
      add column current_stage text null,
      add column attempt_count int not null default 1,
      add column model_bundle_version text null,
      add column prompt_bundle_version text null,
      add column orchestrator_version text null,
      add column input_fingerprint text null,
      add column last_heartbeat_at timestamptz null,
      add column error_count int not null default 0,
      add column warning_count int not null default 0,
      add column summary_json jsonb null;
  end if;
end $$;

-- Index for heartbeat monitoring (stale mission detection)
create index if not exists idx_research_missions_heartbeat
  on buddy_research_missions(last_heartbeat_at)
  where status = 'running';

-- Index for input fingerprint dedup
create index if not exists idx_research_missions_input_fingerprint
  on buddy_research_missions(deal_id, input_fingerprint)
  where status in ('queued', 'running', 'complete');

-- ============================================================================
-- 2. buddy_research_thread_runs (per-stage execution tracking)
-- ============================================================================

create table if not exists buddy_research_thread_runs (
  id uuid primary key default gen_random_uuid(),
  mission_id uuid not null references buddy_research_missions(id) on delete cascade,

  -- Stage identification
  stage text not null check (
    stage in (
      'source_discovery',
      'source_ingestion',
      'fact_extraction',
      'inference_derivation',
      'narrative_compilation',
      'bie_enrichment',
      'gap_analysis',
      'flag_bridging'
    )
  ),
  thread_index int not null default 0,   -- parallel thread index within stage

  -- Execution state
  status text not null default 'pending' check (
    status in ('pending', 'running', 'complete', 'failed', 'skipped')
  ),
  started_at timestamptz,
  completed_at timestamptz,
  duration_ms int,

  -- Input/output tracking
  input_summary jsonb,
  output_summary jsonb,
  items_processed int not null default 0,
  items_failed int not null default 0,

  -- Error tracking
  error_message text,
  error_code text,
  retryable boolean not null default false,

  -- Audit
  created_at timestamptz not null default now()
);

create index if not exists idx_thread_runs_mission
  on buddy_research_thread_runs(mission_id, stage, thread_index);

-- ============================================================================
-- 3. buddy_research_checkpoints (resumable state snapshots)
-- ============================================================================

create table if not exists buddy_research_checkpoints (
  id uuid primary key default gen_random_uuid(),
  mission_id uuid not null references buddy_research_missions(id) on delete cascade,

  -- Checkpoint identification
  stage text not null,
  sequence_number int not null default 0,

  -- State snapshot
  state_json jsonb not null,            -- serialized stage state
  completed_source_ids uuid[] default '{}',
  completed_fact_ids uuid[] default '{}',
  pending_work_json jsonb,              -- what remains to be done

  -- Metadata
  created_at timestamptz not null default now(),
  byte_size int,                        -- approximate size for monitoring

  unique(mission_id, stage, sequence_number)
);

create index if not exists idx_checkpoints_mission_stage
  on buddy_research_checkpoints(mission_id, stage, sequence_number desc);

-- ============================================================================
-- 4. buddy_research_failure_library (institutional failure memory)
-- ============================================================================

create table if not exists buddy_research_failure_library (
  id uuid primary key default gen_random_uuid(),

  -- Failure pattern identification
  failure_code text not null,
  failure_category text not null check (
    failure_category in (
      'source_unavailable',
      'rate_limited',
      'extraction_failed',
      'inference_failed',
      'timeout',
      'schema_mismatch',
      'auth_expired',
      'data_quality',
      'model_error',
      'unknown'
    )
  ),

  -- Pattern matching
  source_domain text,                   -- e.g. "census.gov"
  mission_type text,
  error_signature text not null,        -- normalized error for dedup

  -- Resolution
  resolution_strategy text,             -- how to handle this failure
  auto_retryable boolean not null default false,
  cooldown_seconds int,                 -- wait before retry

  -- Evidence
  example_mission_id uuid references buddy_research_missions(id) on delete set null,
  occurrence_count int not null default 1,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),

  -- Dedup
  unique(failure_code, error_signature)
);

create index if not exists idx_failure_library_category
  on buddy_research_failure_library(failure_category, last_seen_at desc);

create index if not exists idx_failure_library_domain
  on buddy_research_failure_library(source_domain)
  where source_domain is not null;

-- ============================================================================
-- 5. buddy_research_evidence (structured evidence linkage)
-- ============================================================================

create table if not exists buddy_research_evidence (
  id uuid primary key default gen_random_uuid(),
  mission_id uuid not null references buddy_research_missions(id) on delete cascade,

  -- Evidence source
  evidence_type text not null check (
    evidence_type in (
      'fact',
      'inference',
      'narrative_citation',
      'external_document',
      'financial_metric',
      'benchmark_comparison'
    )
  ),
  source_entity_id uuid,               -- references fact/inference/doc id
  source_table text,                    -- originating table name

  -- Evidence content
  claim text not null,                  -- the assertion being evidenced
  supporting_data jsonb not null,       -- structured evidence payload
  confidence numeric not null check (confidence between 0 and 1),

  -- Corroboration
  corroborated_by uuid[],              -- other evidence IDs that agree
  contradicted_by uuid[],              -- other evidence IDs that disagree

  -- Audit
  created_at timestamptz not null default now()
);

create index if not exists idx_research_evidence_mission
  on buddy_research_evidence(mission_id, evidence_type);

-- ============================================================================
-- 6. buddy_agent_sessions (multi-agent session state)
-- ============================================================================

create table if not exists buddy_agent_sessions (
  id uuid primary key default gen_random_uuid(),
  bank_id uuid not null references banks(id),
  deal_id uuid not null references deals(id) on delete cascade,

  -- Agent identification
  agent_type text not null check (
    agent_type in (
      'sba_policy',
      'eligibility',
      'credit',
      'cash_flow',
      'collateral',
      'management',
      'risk',
      'narrative',
      'evidence',
      'banker_copilot',
      'research',
      'borrower_insights'
    )
  ),

  -- Channel + visibility
  channel_type text not null default 'web' check (
    channel_type in ('web', 'sms', 'email', 'api', 'internal')
  ),
  visibility_scope text not null default 'banker' check (
    visibility_scope in ('banker', 'borrower', 'system', 'committee')
  ),

  -- State (explicitly isolated from BuddyCanonicalState / OmegaAdvisoryState)
  -- This is AGENT-LOCAL session state only (tool bindings, conversation context)
  -- It does NOT duplicate deal lifecycle, readiness, or advisory state
  session_state_json jsonb not null default '{}',
  memory_pointer_json jsonb not null default '{}',

  -- Lifecycle
  status text not null default 'active' check (
    status in ('active', 'suspended', 'completed', 'expired')
  ),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz
);

create index if not exists idx_agent_sessions_deal
  on buddy_agent_sessions(deal_id, agent_type, status);

create index if not exists idx_agent_sessions_bank
  on buddy_agent_sessions(bank_id, created_at desc);

-- Updated_at trigger
create or replace function update_agent_session_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_agent_session_updated_at on buddy_agent_sessions;
create trigger trg_agent_session_updated_at
  before update on buddy_agent_sessions
  for each row execute function update_agent_session_updated_at();

-- ============================================================================
-- 7. buddy_borrower_insight_runs (borrower financial insights)
-- ============================================================================

create table if not exists buddy_borrower_insight_runs (
  id uuid primary key default gen_random_uuid(),
  bank_id uuid not null references banks(id),
  deal_id uuid not null references deals(id) on delete cascade,

  -- Link to research
  buddy_research_mission_id uuid null references buddy_research_missions(id),

  -- Execution state
  status text not null default 'pending' check (
    status in ('pending', 'running', 'complete', 'failed')
  ),
  input_fingerprint text,

  -- Insight outputs
  insight_summary_json jsonb,           -- Business Health Summary, What Changed, etc.
  scenario_json jsonb,                  -- Scenario Engine results
  benchmark_json jsonb,                 -- Peer Context / industry comparisons
  warning_flags_json jsonb,             -- Bankability action items

  -- Audit
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists idx_borrower_insight_runs_deal
  on buddy_borrower_insight_runs(deal_id, created_at desc);

create index if not exists idx_borrower_insight_runs_bank
  on buddy_borrower_insight_runs(bank_id, status);

-- ============================================================================
-- 8. buddy_ratio_explanations (plain-English ratio explanations)
-- ============================================================================

create table if not exists buddy_ratio_explanations (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references deals(id) on delete cascade,

  -- Ratio identification
  metric_key text not null,             -- e.g. "dscr", "ltv", "debt_yield"
  period_label text,                    -- e.g. "2024", "TTM"

  -- Values
  computed_value numeric,
  threshold_value numeric,              -- policy threshold if applicable
  pass boolean,

  -- Explanation
  explanation_text text not null,       -- plain-English borrower-safe
  banker_note text,                     -- internal-only context
  formula_used text,                    -- human-readable formula string

  -- Source traceability
  snapshot_id uuid,                     -- link to deal_model_snapshots
  source_facts jsonb,                   -- fact keys that fed computation

  -- Audit
  created_at timestamptz not null default now(),

  unique(deal_id, metric_key, period_label)
);

create index if not exists idx_ratio_explanations_deal
  on buddy_ratio_explanations(deal_id);

-- ============================================================================
-- 9. RLS Policies
-- ============================================================================

alter table buddy_research_thread_runs enable row level security;
alter table buddy_research_checkpoints enable row level security;
alter table buddy_research_failure_library enable row level security;
alter table buddy_research_evidence enable row level security;
alter table buddy_agent_sessions enable row level security;
alter table buddy_borrower_insight_runs enable row level security;
alter table buddy_ratio_explanations enable row level security;

-- Thread runs: via mission (inherits mission RLS)
create policy "thread_runs_via_mission" on buddy_research_thread_runs
  for all using (
    exists (
      select 1 from buddy_research_missions m
      where m.id = mission_id
      and (m.bank_id = (select bank_id from auth.users where id = auth.uid()) or m.bank_id is null)
    )
  );

-- Checkpoints: via mission
create policy "checkpoints_via_mission" on buddy_research_checkpoints
  for all using (
    exists (
      select 1 from buddy_research_missions m
      where m.id = mission_id
      and (m.bank_id = (select bank_id from auth.users where id = auth.uid()) or m.bank_id is null)
    )
  );

-- Failure library: service role only (internal learning)
create policy "failure_library_service_only" on buddy_research_failure_library
  for all using (auth.role() = 'service_role');

-- Evidence: via mission
create policy "evidence_via_mission" on buddy_research_evidence
  for all using (
    exists (
      select 1 from buddy_research_missions m
      where m.id = mission_id
      and (m.bank_id = (select bank_id from auth.users where id = auth.uid()) or m.bank_id is null)
    )
  );

-- Agent sessions: bank isolation
create policy "agent_sessions_bank_isolation" on buddy_agent_sessions
  for all using (
    bank_id = (select bank_id from auth.users where id = auth.uid())
  );

-- Borrower insight runs: bank isolation
create policy "borrower_insights_bank_isolation" on buddy_borrower_insight_runs
  for all using (
    bank_id = (select bank_id from auth.users where id = auth.uid())
  );

-- Ratio explanations: via deal
create policy "ratio_explanations_via_deal" on buddy_ratio_explanations
  for all using (
    exists (
      select 1 from deals d
      where d.id = deal_id
      and d.bank_id = (select bank_id from auth.users where id = auth.uid())
    )
  );

-- Service role bypass for all new tables
create policy "service_role_thread_runs" on buddy_research_thread_runs
  for all using (auth.role() = 'service_role');
create policy "service_role_checkpoints" on buddy_research_checkpoints
  for all using (auth.role() = 'service_role');
create policy "service_role_evidence" on buddy_research_evidence
  for all using (auth.role() = 'service_role');
create policy "service_role_agent_sessions" on buddy_agent_sessions
  for all using (auth.role() = 'service_role');
create policy "service_role_borrower_insights" on buddy_borrower_insight_runs
  for all using (auth.role() = 'service_role');
create policy "service_role_ratio_explanations" on buddy_ratio_explanations
  for all using (auth.role() = 'service_role');

-- ============================================================================
-- 10. Grants
-- ============================================================================

grant select on buddy_research_thread_runs to authenticated;
grant select on buddy_research_checkpoints to authenticated;
grant select on buddy_research_evidence to authenticated;
grant select on buddy_agent_sessions to authenticated;
grant select on buddy_borrower_insight_runs to authenticated;
grant select on buddy_ratio_explanations to authenticated;
