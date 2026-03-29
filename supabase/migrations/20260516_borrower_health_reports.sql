-- Phase 56: Borrower Financial Health Report

-- 1. Industry benchmarks (NAICS-keyed)
create table if not exists public.buddy_industry_benchmarks (
  id uuid primary key default gen_random_uuid(),
  naics_code text not null,
  naics_description text,
  metric_name text not null,
  median_value numeric(10,4),
  percentile_25 numeric(10,4),
  percentile_75 numeric(10,4),
  source text,
  effective_date date,
  created_at timestamptz default now(),
  unique(naics_code, metric_name)
);

create index if not exists idx_bib_naics
  on public.buddy_industry_benchmarks(naics_code);

-- 2. Borrower health reports
create table if not exists public.buddy_borrower_reports (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references public.deals(id) on delete cascade,
  generated_at timestamptz not null default now(),
  naics_code text,
  health_score_composite integer,
  health_score_profitability integer,
  health_score_liquidity integer,
  health_score_leverage integer,
  health_score_efficiency integer,
  computed_ratios jsonb not null default '{}'::jsonb,
  benchmark_comparisons jsonb,
  strengths jsonb,
  improvement_opportunities jsonb,
  altman_z_score numeric(6,4),
  altman_zone text,
  narrative_rationale text,
  pdf_url text,
  snapshot_hash text,
  status text not null default 'draft' check (
    status in ('draft','ready','delivered')
  ),
  delivered_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_bbr_deal_id
  on public.buddy_borrower_reports(deal_id, generated_at desc);
