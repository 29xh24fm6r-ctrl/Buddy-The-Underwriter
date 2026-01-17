-- ============================================================
-- BANK-GRADE PRICING: inputs + immutable snapshots + immutable quotes
-- ============================================================

-- 1) Banker-editable deal inputs (1 row per deal)
create table if not exists public.deal_pricing_inputs (
  deal_id uuid primary key references public.deals(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Index selection
  index_code text not null default 'SOFR',        -- 'SOFR' | 'UST_5Y' | 'PRIME'
  index_tenor text null,                         -- e.g. '5Y'
  -- Optional manual overrides
  base_rate_override_pct numeric null,           -- override base index rate
  spread_override_bps int null,                  -- override model spread

  -- Loan terms
  loan_amount numeric null,
  term_months int not null default 120,
  amort_months int not null default 300,
  interest_only_months int not null default 0,

  notes text null
);

-- 2) Immutable index snapshots (append-only)
create table if not exists public.rate_index_snapshots (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),

  bank_id uuid null references public.banks(id) on delete set null,
  deal_id uuid null references public.deals(id) on delete set null,

  index_code text not null,                      -- 'SOFR' | 'UST_5Y' | 'PRIME'
  index_label text not null,
  index_rate_pct numeric not null,
  as_of_date text not null,                      -- source "as of" (date or ISO)
  source text not null,                          -- 'nyfed' | 'treasury' | 'fed_h15' | 'fred'
  source_url text null,
  raw jsonb null                                 -- optional raw payload excerpt for audit
);

create index if not exists rate_index_snapshots_deal_idx
  on public.rate_index_snapshots(deal_id, created_at desc);

create index if not exists rate_index_snapshots_code_idx
  on public.rate_index_snapshots(index_code, created_at desc);

-- 3) Immutable deal quotes (append-only)
create table if not exists public.deal_pricing_quotes (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),

  bank_id uuid not null references public.banks(id) on delete restrict,
  deal_id uuid not null references public.deals(id) on delete cascade,

  -- Link to the index snapshot used
  rate_snapshot_id uuid null references public.rate_index_snapshots(id) on delete set null,

  -- Inputs at quote time (frozen)
  index_code text not null,
  base_rate_pct numeric not null,
  spread_bps int not null,
  all_in_rate_pct numeric not null,

  loan_amount numeric not null,
  term_months int not null,
  amort_months int not null,
  interest_only_months int not null,

  -- Derived payments (frozen)
  monthly_payment_pi numeric null,
  monthly_payment_io numeric null,

  -- Policy engine provenance (frozen)
  pricing_policy_id text null,
  pricing_policy_version text null,
  pricing_model_hash text null,                  -- optional: hash of rule set / code rev
  pricing_explain jsonb null                     -- optional: reasons / factors

);

create index if not exists deal_pricing_quotes_deal_idx
  on public.deal_pricing_quotes(deal_id, created_at desc);

-- 4) updated_at trigger for inputs
--    (expects public.set_updated_at() exists; create if missing)
do $$
begin
  if not exists (select 1 from pg_proc where proname = 'set_updated_at') then
    create function public.set_updated_at()
    returns trigger as $fn$
    begin
      new.updated_at = now();
      return new;
    end;
    $fn$ language plpgsql;
  end if;

  if not exists (select 1 from pg_trigger where tgname = 'trg_deal_pricing_inputs_updated_at') then
    create trigger trg_deal_pricing_inputs_updated_at
    before update on public.deal_pricing_inputs
    for each row execute function public.set_updated_at();
  end if;
end $$;
