-- Deal Pricing Inputs: banker-configurable loan terms + index selection

create table if not exists public.deal_pricing_inputs (
  deal_id uuid primary key references public.deals(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Index selection
  index_code text not null default 'SOFR', -- 'SOFR' | 'UST_5Y' | 'PRIME'
  index_source text not null default 'nyfed', -- 'nyfed' | 'treasury' | 'fed_h15'
  index_tenor text null, -- e.g. '5Y' for UST, null for SOFR/Prime
  index_rate_pct numeric null, -- cached snapshot when banker saved (optional)

  -- Loan terms
  loan_amount numeric null,
  term_months int not null default 120,
  amort_months int not null default 300,
  interest_only_months int not null default 0,

  -- Optional overrides
  spread_override_bps int null,
  base_rate_override_pct numeric null,

  notes text null
);

-- updated_at trigger (expects public.set_updated_at() already exists)
drop trigger if exists deal_pricing_inputs_set_updated_at on public.deal_pricing_inputs;
create trigger deal_pricing_inputs_set_updated_at
before update on public.deal_pricing_inputs
for each row execute function public.set_updated_at();

create index if not exists deal_pricing_inputs_index_code_idx
  on public.deal_pricing_inputs(index_code);
