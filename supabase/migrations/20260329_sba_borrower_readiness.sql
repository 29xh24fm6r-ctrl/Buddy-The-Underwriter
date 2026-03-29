-- Phase 57: SBA Borrower Readiness Module
-- Assumption interview (one per deal, mutable until confirmed)
create table if not exists buddy_sba_assumptions (
  id                  uuid primary key default gen_random_uuid(),
  deal_id             uuid not null references deals(id) on delete cascade,
  revenue_streams     jsonb not null default '[]',
  cost_assumptions    jsonb not null default '{}',
  working_capital     jsonb not null default '{}',
  loan_impact         jsonb not null default '{}',
  management_team     jsonb not null default '[]',
  status              text not null default 'draft',
  confirmed_at        timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique(deal_id)
);
alter table buddy_sba_assumptions enable row level security;
create policy "bank_scoped_sba_assumptions" on buddy_sba_assumptions
  using (
    deal_id in (
      select id from deals where bank_id = (
        select bank_id from bank_users where user_id = auth.uid() limit 1
      )
    )
  );
create index idx_sba_assumptions_deal_id on buddy_sba_assumptions(deal_id);

-- Generated packages (append-only — new row per generation)
create table if not exists buddy_sba_packages (
  id                      uuid primary key default gen_random_uuid(),
  deal_id                 uuid not null references deals(id) on delete cascade,
  assumptions_id          uuid not null references buddy_sba_assumptions(id),
  generated_at            timestamptz not null default now(),
  base_year_data          jsonb not null default '{}',
  projections_annual      jsonb not null default '{}',
  projections_monthly     jsonb not null default '{}',
  break_even              jsonb not null default '{}',
  sensitivity_scenarios   jsonb not null default '{}',
  use_of_proceeds         jsonb not null default '[]',
  dscr_year1_base         numeric(6,4),
  dscr_year2_base         numeric(6,4),
  dscr_year3_base         numeric(6,4),
  dscr_year1_downside     numeric(6,4),
  dscr_below_threshold    boolean not null default false,
  break_even_revenue      numeric(14,2),
  margin_of_safety_pct    numeric(6,4),
  business_overview_narrative text,
  sensitivity_narrative   text,
  pdf_url                 text,
  snapshot_hash           text,
  status                  text not null default 'draft',
  reviewed_at             timestamptz,
  submitted_at            timestamptz,
  created_at              timestamptz not null default now()
);
alter table buddy_sba_packages enable row level security;
create policy "bank_scoped_sba_packages" on buddy_sba_packages
  using (
    deal_id in (
      select id from deals where bank_id = (
        select bank_id from bank_users where user_id = auth.uid() limit 1
      )
    )
  );
create index idx_sba_packages_deal_id on buddy_sba_packages(deal_id, generated_at desc);
