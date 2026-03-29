-- Phase 55: Deal Control Layer
-- Loan request system + review queue audit support

-- ─── Loan Requests ────────────────────────────────────────────────────────────
create table if not exists public.loan_requests (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null unique references public.deals(id) on delete cascade,

  request_name text null,
  loan_amount numeric(18,2) null,
  loan_purpose text null,
  loan_type text null,
  collateral_type text null,
  collateral_description text null,
  term_months int null,
  amortization_months int null,
  interest_type text null,
  rate_index text null,
  repayment_type text null,
  facility_purpose text null,
  occupancy_type text null,
  recourse_type text null,
  guarantor_required boolean not null default false,
  guarantor_notes text null,
  requested_close_date date null,
  use_of_proceeds_json jsonb null,
  covenant_notes text null,
  structure_notes text null,

  source text not null default 'banker',
  created_by uuid not null,
  updated_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.loan_requests enable row level security;

create policy "bank_scoped_loan_requests" on public.loan_requests
  using (
    deal_id in (
      select id from deals where bank_id = (
        select bank_id from bank_users where user_id = auth.uid() limit 1
      )
    )
  );

-- ─── Loan Request Facilities ──────────────────────────────────────────────────
create table if not exists public.loan_request_facilities (
  id uuid primary key default gen_random_uuid(),
  loan_request_id uuid not null references public.loan_requests(id) on delete cascade,

  facility_type text not null,
  amount numeric(18,2) null,
  purpose text null,
  term_months int null,
  amortization_months int null,
  interest_type text null,
  repayment_type text null,
  lien_position text null,
  collateral_description text null,
  sort_order int not null default 0,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.loan_request_facilities enable row level security;

create policy "bank_scoped_loan_request_facilities" on public.loan_request_facilities
  using (
    loan_request_id in (
      select id from loan_requests where deal_id in (
        select id from deals where bank_id = (
          select bank_id from bank_users where user_id = auth.uid() limit 1
        )
      )
    )
  );

create index if not exists idx_loan_request_facilities_request
  on public.loan_request_facilities (loan_request_id, sort_order);
