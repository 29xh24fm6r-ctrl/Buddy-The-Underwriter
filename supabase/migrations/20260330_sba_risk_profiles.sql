-- Phase 58A: SBA Risk Profiles — computed composite risk per deal
create table if not exists buddy_sba_risk_profiles (
  id                    uuid primary key default gen_random_uuid(),
  deal_id               uuid not null references deals(id) on delete cascade,
  naics_code            text,
  business_age_months   integer,
  is_new_business       boolean not null default false,
  loan_term_months      integer,
  is_urban              boolean,

  -- Component scores (0-100, higher = lower risk)
  industry_score        numeric(5,2) not null default 50,
  business_age_score    numeric(5,2) not null default 50,
  loan_term_score       numeric(5,2) not null default 50,
  location_score        numeric(5,2) not null default 50,

  -- Composite
  composite_score       numeric(5,2) not null,
  risk_tier             text not null,  -- LOW / MODERATE / ELEVATED / HIGH

  -- New business protocol
  dscr_threshold_applied numeric(4,2) not null default 1.25,
  new_business_flags    jsonb not null default '[]',

  -- Metadata
  computed_at           timestamptz not null default now(),
  engine_version        text not null default 'sba_risk_v1',

  created_at            timestamptz not null default now()
);

alter table buddy_sba_risk_profiles enable row level security;
create policy "bank_scoped_sba_risk_profiles" on buddy_sba_risk_profiles
  using (
    deal_id in (
      select id from deals where bank_id = (
        select bank_id from bank_users where user_id = auth.uid() limit 1
      )
    )
  );

create index idx_sba_risk_profiles_deal_id on buddy_sba_risk_profiles(deal_id, computed_at desc);
