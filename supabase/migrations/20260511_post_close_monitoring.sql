-- Phase 65I — Post-Close Monitoring OS
-- Tables: deal_monitoring_programs, deal_monitoring_obligations,
--         deal_monitoring_cycles, deal_monitoring_exceptions,
--         deal_annual_reviews, deal_renewal_prep

-- 1. One monitoring program per active post-close deal
create table if not exists public.deal_monitoring_programs (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references public.deals(id) on delete cascade,
  bank_id uuid not null references public.banks(id) on delete cascade,
  status text not null check (
    status in ('active','paused','completed','cancelled')
  ),
  loan_closed_at timestamptz null,
  next_review_due_at timestamptz null,
  next_reporting_due_at timestamptz null,
  next_renewal_prep_at timestamptz null,
  created_by text not null,
  created_at timestamptz not null default now(),
  unique (deal_id)
);

create index if not exists idx_dmp_bank_id
  on public.deal_monitoring_programs(bank_id);

-- 2. Canonical tracked obligations
create table if not exists public.deal_monitoring_obligations (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references public.deals(id) on delete cascade,
  bank_id uuid not null references public.banks(id) on delete cascade,
  program_id uuid not null references public.deal_monitoring_programs(id) on delete cascade,
  obligation_type text not null,
  title text not null,
  description text not null,
  cadence text not null check (
    cadence in ('one_time','monthly','quarterly','semi_annual','annual','custom')
  ),
  due_day integer null,
  due_month integer null,
  requires_borrower_submission boolean not null default true,
  requires_banker_review boolean not null default true,
  is_financial_reporting boolean not null default false,
  is_covenant_related boolean not null default false,
  is_annual_review_input boolean not null default false,
  is_renewal_related boolean not null default false,
  status text not null check (
    status in ('active','paused','satisfied','waived','cancelled')
  ),
  source text not null default 'post_close_monitoring',
  source_record_id uuid null,
  created_at timestamptz not null default now()
);

create index if not exists idx_dmo_deal_id
  on public.deal_monitoring_obligations(deal_id);

create index if not exists idx_dmo_program_id
  on public.deal_monitoring_obligations(program_id);

-- 3. Cycle instances generated from obligations
create table if not exists public.deal_monitoring_cycles (
  id uuid primary key default gen_random_uuid(),
  obligation_id uuid not null references public.deal_monitoring_obligations(id) on delete cascade,
  deal_id uuid not null references public.deals(id) on delete cascade,
  bank_id uuid not null references public.banks(id) on delete cascade,
  cycle_start_at timestamptz null,
  due_at timestamptz not null,
  status text not null check (
    status in ('upcoming','due','overdue','submitted','under_review','completed','waived','exception_open')
  ),
  borrower_campaign_id uuid null references public.borrower_request_campaigns(id) on delete set null,
  submission_received_at timestamptz null,
  review_started_at timestamptz null,
  reviewed_at timestamptz null,
  completed_at timestamptz null,
  created_at timestamptz not null default now()
);

create index if not exists idx_dmc_deal_id
  on public.deal_monitoring_cycles(deal_id, due_at);

create index if not exists idx_dmc_obligation_id
  on public.deal_monitoring_cycles(obligation_id, due_at);

create index if not exists idx_dmc_status
  on public.deal_monitoring_cycles(status);

-- 4. Open exceptions / waivers / misses
create table if not exists public.deal_monitoring_exceptions (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references public.deals(id) on delete cascade,
  bank_id uuid not null references public.banks(id) on delete cascade,
  cycle_id uuid null references public.deal_monitoring_cycles(id) on delete set null,
  obligation_id uuid null references public.deal_monitoring_obligations(id) on delete set null,
  exception_code text not null,
  severity text not null check (
    severity in ('watch','urgent','critical')
  ),
  status text not null check (
    status in ('open','acknowledged','waived','resolved')
  ),
  opened_at timestamptz not null default now(),
  resolved_at timestamptz null,
  opened_by text not null,
  resolution_note text null
);

create index if not exists idx_dme_deal_id
  on public.deal_monitoring_exceptions(deal_id, status);

create index if not exists idx_dme_cycle_id
  on public.deal_monitoring_exceptions(cycle_id);

-- 5. Annual review seeds and lifecycle
create table if not exists public.deal_annual_reviews (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references public.deals(id) on delete cascade,
  bank_id uuid not null references public.banks(id) on delete cascade,
  review_year integer not null,
  status text not null check (
    status in ('seeded','requested','in_progress','ready','completed','waived')
  ),
  due_at timestamptz not null,
  borrower_campaign_id uuid null references public.borrower_request_campaigns(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (deal_id, review_year)
);

create index if not exists idx_dar_deal_id
  on public.deal_annual_reviews(deal_id);

-- 6. Renewal prep seeding
create table if not exists public.deal_renewal_prep (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references public.deals(id) on delete cascade,
  bank_id uuid not null references public.banks(id) on delete cascade,
  target_maturity_date timestamptz not null,
  prep_start_at timestamptz not null,
  status text not null check (
    status in ('seeded','in_progress','ready','completed','cancelled')
  ),
  created_at timestamptz not null default now(),
  unique (deal_id, target_maturity_date)
);

create index if not exists idx_drp_deal_id
  on public.deal_renewal_prep(deal_id);
