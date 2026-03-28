-- Phase 65J — Annual Review & Renewal Engine
-- Tables: deal_annual_review_cases, deal_renewal_cases,
--         deal_review_case_requirements, deal_review_case_exceptions,
--         deal_review_case_outputs

-- 1. Operational case for seeded annual reviews
create table if not exists public.deal_annual_review_cases (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references public.deals(id) on delete cascade,
  bank_id uuid not null references public.banks(id) on delete cascade,
  annual_review_id uuid not null references public.deal_annual_reviews(id) on delete cascade,
  review_year integer not null,
  status text not null check (
    status in ('seeded','requesting','collecting','under_review','ready','completed','waived')
  ),
  borrower_campaign_id uuid null references public.borrower_request_campaigns(id) on delete set null,
  readiness_state text not null check (
    readiness_state in ('not_started','missing_borrower_items','missing_banker_review','exception_open','ready')
  ),
  due_at timestamptz not null,
  ready_at timestamptz null,
  completed_at timestamptz null,
  created_at timestamptz not null default now(),
  unique (annual_review_id)
);

create index if not exists idx_darc_deal_id
  on public.deal_annual_review_cases(deal_id);

-- 2. Operational case for renewal prep
create table if not exists public.deal_renewal_cases (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references public.deals(id) on delete cascade,
  bank_id uuid not null references public.banks(id) on delete cascade,
  renewal_prep_id uuid not null references public.deal_renewal_prep(id) on delete cascade,
  target_maturity_date timestamptz not null,
  status text not null check (
    status in ('seeded','requesting','collecting','under_review','ready','decision_pending','completed','cancelled')
  ),
  borrower_campaign_id uuid null references public.borrower_request_campaigns(id) on delete set null,
  readiness_state text not null check (
    readiness_state in ('not_started','missing_borrower_items','missing_banker_review','exception_open','ready')
  ),
  due_at timestamptz not null,
  ready_at timestamptz null,
  completed_at timestamptz null,
  created_at timestamptz not null default now(),
  unique (renewal_prep_id)
);

create index if not exists idx_drc_deal_id
  on public.deal_renewal_cases(deal_id);

-- 3. Normalized checklist for review/renewal cases
create table if not exists public.deal_review_case_requirements (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references public.deals(id) on delete cascade,
  bank_id uuid not null references public.banks(id) on delete cascade,
  case_type text not null check (
    case_type in ('annual_review','renewal')
  ),
  case_id uuid not null,
  requirement_code text not null,
  title text not null,
  description text not null,
  source text not null,
  required boolean not null default true,
  borrower_visible boolean not null default true,
  status text not null check (
    status in ('pending','requested','submitted','under_review','completed','waived')
  ),
  evidence_type text not null,
  completed_at timestamptz null,
  created_at timestamptz not null default now()
);

create index if not exists idx_drcr_case
  on public.deal_review_case_requirements(case_id, case_type);

create index if not exists idx_drcr_deal
  on public.deal_review_case_requirements(deal_id);

-- 4. Carry-forward / case-specific exceptions
create table if not exists public.deal_review_case_exceptions (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references public.deals(id) on delete cascade,
  bank_id uuid not null references public.banks(id) on delete cascade,
  case_type text not null check (
    case_type in ('annual_review','renewal')
  ),
  case_id uuid not null,
  source_exception_id uuid null references public.deal_monitoring_exceptions(id) on delete set null,
  exception_code text not null,
  severity text not null check (
    severity in ('watch','urgent','critical')
  ),
  status text not null check (
    status in ('open','acknowledged','waived','resolved')
  ),
  opened_at timestamptz not null default now(),
  resolved_at timestamptz null,
  created_at timestamptz not null default now()
);

create index if not exists idx_drce_case
  on public.deal_review_case_exceptions(case_id, case_type);

-- 5. Banker-generated outputs for recurring reviews
create table if not exists public.deal_review_case_outputs (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references public.deals(id) on delete cascade,
  bank_id uuid not null references public.banks(id) on delete cascade,
  case_type text not null check (
    case_type in ('annual_review','renewal')
  ),
  case_id uuid not null,
  output_type text not null check (
    output_type in ('review_summary','renewal_packet','memo_refresh','financial_snapshot_refresh')
  ),
  status text not null check (
    status in ('queued','generated','reviewed','superseded','failed')
  ),
  artifact_ref text null,
  created_at timestamptz not null default now()
);

create index if not exists idx_drco_case
  on public.deal_review_case_outputs(case_id, case_type);
