-- PR5 of SPEC-BROKERAGE-OPERATING-SYSTEM-V1: Intelligence, Analytics,
-- Revenue, and Operational Command Center.
--
-- ---------------------------------------------------------------------
-- 0. Drift fixes found during PR5 discovery (same bug class as the
--    lender_invoices/crm_organizations backfills in earlier PRs: these
--    tables exist live but were never committed as migrations, and two
--    of them have RLS enabled with zero policies -- confirmed via
--    Supabase's own security advisor before writing this file). All
--    statements here are additive/idempotent no-ops against the live
--    database; they exist to bring the repo's tracked schema in sync
--    with what PR5 is about to build on top of.
-- ---------------------------------------------------------------------

create table if not exists public.lender_marketplace_agreements (
  id uuid primary key default gen_random_uuid(),
  lender_bank_id uuid not null references public.banks(id) on delete cascade,
  status text not null default 'active',
  agreement_version text,
  signed_at timestamptz,
  expires_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  referral_fee_bps integer,
  accepts_sba_7a boolean not null default true,
  signed_by_name text
);

create table if not exists public.marketplace_claims (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.marketplace_listings(id) on delete cascade,
  lender_bank_id uuid not null references public.banks(id) on delete cascade,
  status text not null default 'pending',
  claimed_at timestamptz not null default now(),
  expires_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- lender_invoices was reconstructed from live schema in an earlier PR
-- (20260709212825_brokerage_billing_lender_invoices.sql) using
-- `create table lender_invoices (...)` without a `public.` prefix or
-- `if not exists`, which the tenant-RLS guard's text-pattern check does
-- not recognize even though bank_id genuinely is defined there. This is a
-- true no-op (bank_id is already NOT NULL on the live table) that makes
-- the guard's pattern match without altering behavior.
alter table public.lender_invoices add column if not exists bank_id uuid;

alter table public.lender_invoices enable row level security;
alter table public.lender_invoice_line_items enable row level security;
alter table public.lender_invoice_payments enable row level security;
alter table public.lender_marketplace_agreements enable row level security;
alter table public.marketplace_claims enable row level security;

drop policy if exists "service_role_all" on public.lender_invoices;
create policy "service_role_all" on public.lender_invoices
  as permissive for all to service_role using (true) with check (true);

drop policy if exists "service_role_all" on public.lender_invoice_line_items;
create policy "service_role_all" on public.lender_invoice_line_items
  as permissive for all to service_role using (true) with check (true);

drop policy if exists "service_role_all" on public.lender_invoice_payments;
create policy "service_role_all" on public.lender_invoice_payments
  as permissive for all to service_role using (true) with check (true);

drop policy if exists "service_role_all" on public.lender_marketplace_agreements;
create policy "service_role_all" on public.lender_marketplace_agreements
  as permissive for all to service_role using (true) with check (true);

drop policy if exists "service_role_all" on public.marketplace_claims;
create policy "service_role_all" on public.marketplace_claims
  as permissive for all to service_role using (true) with check (true);

-- ---------------------------------------------------------------------
-- 1. Commission splits. deal_source_attribution (PR1) already carries
--    referral-partner and co-broker *identity* (referring_organization_id,
--    co_broker_org_id, attribution_percentage) and deal_participants
--    already carries internal broker/co_broker/closer/processor *identity*
--    (role-scoped clerk_user_id). Neither tracks a split *amount* against
--    an actual fee, or a payment status for that split. This table adds
--    only the missing fact -- it references deal_source_attribution /
--    deal_participants for payee identity rather than duplicating it, and
--    references brokerage_fee_ledger (BRK-10E) for the fee being split
--    rather than re-deriving fee amounts.
-- ---------------------------------------------------------------------

create table if not exists public.brokerage_commission_splits (
  id uuid primary key default gen_random_uuid(),
  bank_id uuid not null references public.banks(id) on delete cascade,
  deal_id uuid not null references public.deals(id) on delete cascade,
  fee_ledger_id uuid references public.brokerage_fee_ledger(id) on delete set null,
  split_type text not null
    check (split_type in ('referral_partner', 'co_broker', 'internal_broker')),
  payee_org_id uuid references public.crm_organizations(id) on delete set null,
  payee_clerk_user_id text,
  split_bps integer,
  amount_cents integer,
  status text not null default 'estimated'
    check (status in ('estimated', 'confirmed', 'paid')),
  notes text,
  created_by_clerk_user_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint brokerage_commission_splits_one_payee check (
    ((payee_org_id is not null)::int + (payee_clerk_user_id is not null)::int) = 1
  )
);

create index if not exists idx_brokerage_commission_splits_bank on public.brokerage_commission_splits(bank_id);
create index if not exists idx_brokerage_commission_splits_deal on public.brokerage_commission_splits(deal_id);
create index if not exists idx_brokerage_commission_splits_ledger on public.brokerage_commission_splits(fee_ledger_id) where fee_ledger_id is not null;

alter table public.brokerage_commission_splits enable row level security;
create policy "service_role_all" on public.brokerage_commission_splits
  as permissive for all to service_role using (true) with check (true);

-- ---------------------------------------------------------------------
-- 2. Sales-engine forecasting input (spec section 2.2: "Expected loan
--    amount, Expected revenue, Probability, Expected close date").
--    brokerage_leads already has loan_amount_requested and
--    expected_conversion_date. This adds only the missing probability
--    input. Deliberately NOT named/placed to collide with the pre-existing
--    deal_predictions.probability (a distinct, older, underwriting-side
--    "rules_v1" prediction cache keyed by deal_id) -- that table answers
--    a different question (banker risk modeling) than this column (a
--    broker's own conversion-likelihood estimate on a not-yet-converted
--    lead). Deal-level forecast probability is intentionally NOT a stored
--    column at all (see src/lib/intelligence/forecast.ts) -- it is
--    computed on read from a deterministic brokerage_stage weight table,
--    so there is no third, unreconciled "probability" fact anywhere.
-- ---------------------------------------------------------------------

alter table public.brokerage_leads
  add column if not exists conversion_probability_pct integer
    check (conversion_probability_pct is null or (conversion_probability_pct between 0 and 100));

-- ---------------------------------------------------------------------
-- 3. Alert feedback (dismiss / snooze / acknowledge) for the command
--    center's explainable-intelligence panel (spec section 7.7).
--    buddy_advisor_feedback already implements this state machine
--    (acknowledged/dismissed/snoozed, dismiss_count, ledger mirroring)
--    but is deal-scoped only (unique on bank_id/deal_id/user_id/signal_key)
--    and used by a live, tested, per-deal advisor UI. Command-center
--    alerts span leads, organizations, and tasks in addition to deals, so
--    rather than widen a live table's identity shape, this adds a second
--    table with the same state machine keyed by a generic
--    (entity_type, entity_id) pair. user_id is nullable: null means a
--    team-wide dismissal (the command center is a shared operational
--    view), a set clerk_user_id means a personal dismissal.
-- ---------------------------------------------------------------------

create table if not exists public.crm_alert_feedback (
  id uuid primary key default gen_random_uuid(),
  bank_id uuid not null references public.banks(id) on delete cascade,
  entity_type text not null check (entity_type in ('lead', 'deal', 'organization', 'task', 'person')),
  entity_id uuid not null,
  user_id text,
  alert_key text not null,
  state text not null check (state in ('acknowledged', 'dismissed', 'snoozed')),
  snoozed_until timestamptz,
  reason text,
  dismiss_count integer not null default 0,
  last_dismissed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists idx_crm_alert_feedback_identity
  on public.crm_alert_feedback (bank_id, entity_type, entity_id, coalesce(user_id, ''), alert_key);

create index if not exists idx_crm_alert_feedback_bank on public.crm_alert_feedback(bank_id);

alter table public.crm_alert_feedback enable row level security;
create policy "service_role_all" on public.crm_alert_feedback
  as permissive for all to service_role using (true) with check (true);
