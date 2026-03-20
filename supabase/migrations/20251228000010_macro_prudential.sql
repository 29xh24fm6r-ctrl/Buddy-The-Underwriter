-- ============================================================
-- Macro-Prudential Intelligence
-- ============================================================
-- PURPOSE: Portfolio-level risk aggregation, stress testing,
-- and supervisory-grade systemic risk analysis.
--
-- TABLES:
-- 1. portfolio_risk_snapshots (time-series system state)
-- 2. stress_test_scenarios (shock definitions)
-- 3. stress_test_results (stress test outcomes)
-- ============================================================

-- ------------------------------------------------------------
-- Portfolio risk snapshots (system-wide state)
-- ------------------------------------------------------------
create table if not exists public.portfolio_risk_snapshots (
  id uuid primary key default gen_random_uuid(),
  bank_id uuid not null references public.banks(id) on delete cascade,
  
  -- Snapshot timestamp
  as_of_date date not null,
  
  -- Portfolio metrics
  total_exposure numeric not null default 0,
  risk_weighted_exposure numeric not null default 0,
  total_decisions integer not null default 0,
  
  -- Exception tracking
  decisions_with_exceptions integer not null default 0,
  exception_rate numeric not null default 0,
  
  -- Committee governance
  committee_required_count integer not null default 0,
  committee_override_rate numeric not null default 0,
  
  -- Concentration metrics (JSON for flexibility)
  concentration_json jsonb not null default '{}'::jsonb,
  
  created_at timestamptz not null default now(),
  
  unique(bank_id, as_of_date)
);

create index if not exists portfolio_snapshots_bank_date_idx
  on public.portfolio_risk_snapshots(bank_id, as_of_date desc);

-- ------------------------------------------------------------
-- Stress test scenarios (shock definitions)
-- ------------------------------------------------------------
create table if not exists public.stress_test_scenarios (
  id uuid primary key default gen_random_uuid(),
  bank_id uuid not null references public.banks(id) on delete cascade,
  
  -- Scenario metadata
  name text not null,
  description text null,
  
  -- Shock parameters (flexible JSON)
  -- Example: {"dscr_delta": -0.2, "ltv_delta": 0.1, "loan_amount_multiplier": 0.9}
  shock_json jsonb not null default '{}'::jsonb,
  
  created_at timestamptz not null default now()
);

create index if not exists stress_scenarios_bank_idx
  on public.stress_test_scenarios(bank_id);

-- ------------------------------------------------------------
-- Stress test results (scenario outcomes)
-- ------------------------------------------------------------
create table if not exists public.stress_test_results (
  id uuid primary key default gen_random_uuid(),
  scenario_id uuid not null references public.stress_test_scenarios(id) on delete cascade,
  bank_id uuid not null references public.banks(id) on delete cascade,
  
  -- Test scope
  total_deals_tested integer not null default 0,
  
  -- Impact metrics
  approvals_flipped_to_decline integer not null default 0,
  declines_flipped_to_approval integer not null default 0,
  capital_at_risk numeric not null default 0,
  
  -- Detailed results (per-deal outcomes)
  results_json jsonb not null default '[]'::jsonb,
  
  created_at timestamptz not null default now()
);

create index if not exists stress_results_scenario_idx
  on public.stress_test_results(scenario_id);

create index if not exists stress_results_bank_idx
  on public.stress_test_results(bank_id, created_at desc);

-- RLS: Server-side only
alter table public.portfolio_risk_snapshots enable row level security;
alter table public.stress_test_scenarios enable row level security;
alter table public.stress_test_results enable row level security;

-- Comments
comment on table public.portfolio_risk_snapshots is 
  'Time-series snapshots of portfolio-level risk metrics. Generated nightly via cron job.';
comment on table public.stress_test_scenarios is 
  'User-defined stress test scenarios (e.g., "20% DSCR deterioration", "10% LTV increase").';
comment on table public.stress_test_results is 
  'Results of applying stress scenarios to historical decision portfolio.';
comment on column public.portfolio_risk_snapshots.concentration_json is 
  'Concentration metrics by industry, geography, loan size, etc. Flexible JSON structure.';
comment on column public.stress_test_scenarios.shock_json is 
  'Shock parameters: dscr_delta, ltv_delta, loan_amount_multiplier, etc.';
comment on column public.stress_test_results.results_json is 
  'Array of per-deal stress test outcomes: [{deal_id, original_decision, stressed_decision, risk_delta}]';
