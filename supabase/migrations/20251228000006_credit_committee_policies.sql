-- ============================================================
-- Credit Committee Governance (Policy-Driven)
-- ============================================================
-- PURPOSE: Bank-configurable rules that determine when credit
-- committee approval is required for a decision.
--
-- RULES CAN BE:
--   1. Manually configured in Bank Settings
--   2. Auto-derived from uploaded credit policy documents
--
-- EXAMPLE rules_json:
-- {
--   "loan_amount_gt": 500000,
--   "dscr_lt": 1.15,
--   "ltv_gt": 0.85,
--   "risk_rating_gte": 7,
--   "exceptions_present": true,
--   "collateral_shortfall_gt": 0
-- }
-- ============================================================

create table if not exists public.bank_credit_committee_policies (
  bank_id uuid primary key references public.banks(id) on delete cascade,
  
  -- Toggle committee governance
  enabled boolean not null default false,

  -- Structured rules (deterministic, not AI)
  rules_json jsonb not null default '{}'::jsonb,

  -- Source tracking
  derived_from_upload_id uuid null references public.uploads(id) on delete set null,
  last_evaluated_at timestamptz null,

  -- Timestamps
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- RLS: Server-side only (deny all)
alter table public.bank_credit_committee_policies enable row level security;

-- Insert default policies for existing banks
insert into public.bank_credit_committee_policies (bank_id, enabled, rules_json)
select id, false, '{}'::jsonb
from public.banks
on conflict (bank_id) do nothing;

-- Comments
comment on table public.bank_credit_committee_policies is 
  'Bank-configurable rules for when credit committee approval is required. Rules are deterministic (not AI-driven).';
comment on column public.bank_credit_committee_policies.enabled is 
  'If false, credit committee governance is disabled for this bank.';
comment on column public.bank_credit_committee_policies.rules_json is 
  'Structured rules: {loan_amount_gt, dscr_lt, ltv_gt, risk_rating_gte, exceptions_present, etc.}';
comment on column public.bank_credit_committee_policies.derived_from_upload_id is 
  'If rules were auto-extracted from a credit policy upload, reference that upload here.';
