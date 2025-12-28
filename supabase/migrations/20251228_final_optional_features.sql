-- ============================================================
-- Final Optional Governance Features
-- ============================================================
-- PURPOSE: Policy drift detection, counterfactual decisions,
-- living credit policy, and board-ready quarterly reports.
-- ============================================================

-- ------------------------------------------------------------
-- Policy drift findings (nightly output)
-- ------------------------------------------------------------
create table if not exists public.policy_drift_findings (
  id uuid primary key default gen_random_uuid(),
  bank_id uuid not null references public.banks(id) on delete cascade,
  
  -- Which policy rule
  rule_key text not null,
  expected_value text,
  observed_value text,
  
  -- Drift metrics
  drift_rate numeric not null default 0,
  violation_count integer not null default 0,
  total_decisions integer not null default 0,
  
  created_at timestamptz not null default now()
);

create index if not exists policy_drift_bank_idx
  on public.policy_drift_findings(bank_id, created_at desc);

-- ------------------------------------------------------------
-- Counterfactual decision results ("what if")
-- ------------------------------------------------------------
create table if not exists public.counterfactual_decisions (
  id uuid primary key default gen_random_uuid(),
  decision_snapshot_id uuid not null,
  
  -- Scenario definition (e.g., {"remove_exceptions": true, "dscr_increase": 0.1})
  scenario_json jsonb not null default '{}'::jsonb,
  
  -- AI-generated outcome
  outcome text not null,
  confidence numeric,
  explanation text,
  
  created_at timestamptz not null default now()
);

create index if not exists counterfactual_snapshot_idx
  on public.counterfactual_decisions(decision_snapshot_id);

-- ------------------------------------------------------------
-- Living credit policy suggestions (AI-driven)
-- ------------------------------------------------------------
create table if not exists public.policy_update_suggestions (
  id uuid primary key default gen_random_uuid(),
  bank_id uuid not null references public.banks(id) on delete cascade,
  
  -- Policy rule to update
  rule_key text not null,
  current_value text,
  suggested_change text not null,
  rationale text not null,
  
  -- Approval workflow
  approved boolean not null default false,
  approved_by_user_id text,
  approved_at timestamptz,
  
  created_at timestamptz not null default now()
);

create index if not exists policy_suggestions_bank_idx
  on public.policy_update_suggestions(bank_id, approved, created_at desc);

-- ------------------------------------------------------------
-- Board-ready quarterly risk reports
-- ------------------------------------------------------------
create table if not exists public.board_risk_reports (
  id uuid primary key default gen_random_uuid(),
  bank_id uuid not null references public.banks(id) on delete cascade,
  
  -- Quarter (e.g., "2025-Q4")
  quarter text not null,
  
  -- AI-generated report content (markdown)
  content text not null,
  
  -- Metrics snapshot
  metrics_json jsonb not null default '{}'::jsonb,
  
  created_at timestamptz not null default now(),
  
  unique(bank_id, quarter)
);

create index if not exists board_reports_bank_idx
  on public.board_risk_reports(bank_id, quarter desc);

-- RLS: Server-side only
alter table public.policy_drift_findings enable row level security;
alter table public.counterfactual_decisions enable row level security;
alter table public.policy_update_suggestions enable row level security;
alter table public.board_risk_reports enable row level security;

-- Comments
comment on table public.policy_drift_findings is 
  'Nightly policy drift detection results. Compares actual decisions to stated policy.';
comment on table public.counterfactual_decisions is 
  'What-if scenario results. Replay decisions with modified assumptions.';
comment on table public.policy_update_suggestions is 
  'AI-generated policy update suggestions based on drift patterns.';
comment on table public.board_risk_reports is 
  'Quarterly board-ready risk reports with AI-generated narratives.';
