-- Phase 55: Buddy Covenants Recommendation Engine

-- 1. Covenant packages
create table if not exists public.buddy_covenant_packages (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references public.deals(id) on delete cascade,
  generated_at timestamptz not null default now(),
  risk_grade text,
  deal_type text,
  financial_covenants jsonb not null default '[]'::jsonb,
  reporting_covenants jsonb not null default '[]'::jsonb,
  behavioral_covenants jsonb not null default '[]'::jsonb,
  springing_covenants jsonb not null default '[]'::jsonb,
  rationale text,
  customizations jsonb default '[]'::jsonb,
  banker_notes text,
  snapshot_hash text,
  rule_engine_version text,
  status text not null default 'draft' check (
    status in ('draft','banker_reviewed','approved')
  ),
  created_at timestamptz not null default now()
);

create index if not exists idx_bcp_deal_id
  on public.buddy_covenant_packages(deal_id, generated_at desc);

-- 2. Append-only override log
create table if not exists public.buddy_covenant_overrides (
  id uuid primary key default gen_random_uuid(),
  package_id uuid not null references public.buddy_covenant_packages(id) on delete cascade,
  covenant_id text not null,
  override_type text not null check (
    override_type in ('modify_threshold','remove','add_custom','approve')
  ),
  original_value jsonb,
  new_value jsonb,
  justification text not null,
  overridden_by text,
  overridden_at timestamptz not null default now()
);

create index if not exists idx_bco_package_id
  on public.buddy_covenant_overrides(package_id);
