-- Phase 53: Buddy Validation Pass + Phase 54: Buddy Eval Suite

-- 1. Validation reports — cached per snapshot hash
create table if not exists public.buddy_validation_reports (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references public.deals(id) on delete cascade,
  run_at timestamptz not null default now(),
  overall_status text not null check (
    overall_status in ('PASS','PASS_WITH_FLAGS','FAIL')
  ),
  gating_decision text not null check (
    gating_decision in ('ALLOW_GENERATION','BLOCK_GENERATION')
  ),
  flag_count integer not null default 0,
  block_count integer not null default 0,
  summary text,
  checks jsonb not null default '[]'::jsonb,
  snapshot_hash text,
  created_at timestamptz not null default now()
);

create index if not exists idx_bvr_deal_id
  on public.buddy_validation_reports(deal_id, run_at desc);

-- 2. Eval runs
create table if not exists public.buddy_eval_runs (
  id uuid primary key default gen_random_uuid(),
  run_at timestamptz not null default now(),
  mode text not null,
  triggered_by text,
  total_cases integer not null,
  passed_cases integer not null default 0,
  failed_cases integer not null default 0,
  overall_accuracy numeric(5,4),
  duration_ms integer,
  git_sha text,
  created_at timestamptz not null default now()
);

-- 3. Per-case eval scores
create table if not exists public.buddy_eval_scores (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.buddy_eval_runs(id) on delete cascade,
  case_id text not null,
  case_name text,
  passed boolean not null,
  overall_score numeric(5,4),
  fact_accuracy numeric(5,4),
  ratio_accuracy numeric(5,4),
  narrative_quality numeric(5,4),
  incorrect_facts jsonb default '[]'::jsonb,
  judge_reasoning text,
  raw_output jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_bes_run_id
  on public.buddy_eval_scores(run_id);
create index if not exists idx_bes_case_id
  on public.buddy_eval_scores(case_id, created_at desc);
