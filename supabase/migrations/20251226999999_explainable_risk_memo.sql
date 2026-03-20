-- =========================================
-- Explainable Risk → Memo Pipeline schema
-- =========================================

-- Risk runs (one per "generate risk" action)
create table if not exists public.risk_runs (
  id uuid primary key default gen_random_uuid(),
  deal_id text not null,
  created_at timestamptz not null default now(),

  model_name text not null default 'ai:stub',
  model_version text not null default 'v0',
  status text not null default 'completed', -- queued|running|completed|failed

  -- JSON payload for transparency/debug
  inputs jsonb not null default '{}'::jsonb,
  outputs jsonb not null default '{}'::jsonb,

  error text
);

create index if not exists risk_runs_deal_id_created_at_idx
  on public.risk_runs (deal_id, created_at desc);

-- Individual factors/drivers for explainability
create table if not exists public.risk_factors (
  id uuid primary key default gen_random_uuid(),
  risk_run_id uuid not null references public.risk_runs(id) on delete cascade,
  created_at timestamptz not null default now(),

  -- Human readable
  label text not null,
  category text not null default 'general', -- cashflow|collateral|concentration|compliance|...
  direction text not null check (direction in ('positive','negative','neutral')),

  -- Numeric explainability
  contribution numeric not null default 0, -- e.g. +0.6 or -0.4
  confidence numeric not null default 0.75, -- 0..1

  -- Evidence refs (array of objects)
  evidence jsonb not null default '[]'::jsonb,

  -- Freeform AI rationale
  rationale text not null default ''
);

create index if not exists risk_factors_risk_run_id_idx
  on public.risk_factors (risk_run_id);

-- Memo runs (one per "generate memo" action)
create table if not exists public.memo_runs (
  id uuid primary key default gen_random_uuid(),
  deal_id text not null,
  created_at timestamptz not null default now(),

  risk_run_id uuid references public.risk_runs(id) on delete set null,

  model_name text not null default 'ai:stub',
  model_version text not null default 'v0',
  status text not null default 'completed', -- queued|running|completed|failed

  inputs jsonb not null default '{}'::jsonb,
  error text
);

create index if not exists memo_runs_deal_id_created_at_idx
  on public.memo_runs (deal_id, created_at desc);

-- Memo sections, each with citations
create table if not exists public.memo_sections (
  id uuid primary key default gen_random_uuid(),
  memo_run_id uuid not null references public.memo_runs(id) on delete cascade,
  created_at timestamptz not null default now(),

  section_key text not null, -- executive_summary|borrower|facility|risk|mitigants|pricing|covenants|conditions
  title text not null,
  content text not null,

  -- citations: array of EvidenceRef
  citations jsonb not null default '[]'::jsonb
);

create index if not exists memo_sections_memo_run_id_idx
  on public.memo_sections (memo_run_id);
