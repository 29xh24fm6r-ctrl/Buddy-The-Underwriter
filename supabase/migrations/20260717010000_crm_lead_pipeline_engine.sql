-- SPEC-BROKERAGE-OPERATING-SYSTEM-V1 PR2 — Lead, Opportunity, and Brokerage
-- Pipeline Engine.
--
-- Turns brokerage_leads (currently a 5-status inbox with no qualification
-- model, no owner, no next-action tracking) into a controlled pipeline:
-- a 17-stage transition-guarded status machine, a structured qualification
-- record with per-field provenance, and SLA/next-action tracking.
--
-- Additive only:
--   - brokerage_leads.status CHECK widened (existing 5 values are a strict
--     subset of the new 17 — no data reinterpretation)
--   - brokerage_leads gains new nullable columns (stage/SLA/qualification
--     bookkeeping) — no existing column changes meaning
--   - crm_activities gains target_lead_id, extending the existing
--     "target pattern" CHECK from 3 to 4 nullable FKs, same pattern PR1
--     used for deal_party_roles. This makes crm_activities the shared
--     timeline for lead stage-changes and contact attempts too, rather
--     than forking a parallel lead-activity table.
--   - new one-to-one brokerage_lead_qualifications table.
--
-- Referral attribution stays on the PR1-established path: deal_source_attribution
-- is authoritative once a deal exists; brokerage_leads.referral_source_org_id
-- (added in #715) is carried into it at conversion time, not replaced here.

-- ── 1. Widen brokerage_leads.status: 5 values -> full 17-stage pipeline ────

alter table public.brokerage_leads drop constraint if exists brokerage_leads_status_check;
alter table public.brokerage_leads add constraint brokerage_leads_status_check
  check (status in (
    'new', 'attempting_contact', 'contacted', 'discovery_scheduled',
    'discovery_complete', 'information_requested', 'preliminary_qualification',
    'qualified', 'engagement_pending', 'engagement_accepted', 'application_started',
    'converted', 'nurture', 'unresponsive', 'disqualified', 'withdrawn', 'lost'
  ));

-- ── 2. New tracking columns ─────────────────────────────────────────────

alter table public.brokerage_leads
  add column if not exists stage_entered_at timestamptz not null default now(),
  add column if not exists owner_clerk_user_id text,
  add column if not exists priority text not null default 'medium'
    check (priority in ('low', 'medium', 'high', 'urgent')),
  add column if not exists loan_program text,
  add column if not exists next_action text,
  add column if not exists next_action_due_at timestamptz,
  add column if not exists last_attempted_contact_at timestamptz,
  add column if not exists last_successful_contact_at timestamptz,
  add column if not exists expected_conversion_date date,
  add column if not exists disqualification_reason text,
  add column if not exists lost_reason text,
  add column if not exists competitor_or_alternate_financing text,
  add column if not exists converted_by_clerk_user_id text;

create index if not exists idx_brokerage_leads_owner on public.brokerage_leads(bank_id, owner_clerk_user_id)
  where owner_clerk_user_id is not null;
create index if not exists idx_brokerage_leads_next_action_due on public.brokerage_leads(bank_id, next_action_due_at)
  where next_action_due_at is not null;
create index if not exists idx_brokerage_leads_stage_entered on public.brokerage_leads(bank_id, stage_entered_at);

-- ── 3. Qualification record — distinct from final underwriting facts ───────

create table if not exists public.brokerage_lead_qualifications (
  id uuid primary key default gen_random_uuid(),
  bank_id uuid not null references public.banks(id) on delete cascade,
  lead_id uuid not null unique references public.brokerage_leads(id) on delete cascade,
  use_of_proceeds text,
  business_age_years numeric,
  deal_type text check (deal_type in ('startup', 'acquisition', 'expansion', 'refinance', 'other')),
  ownership_structure text,
  owner_citizenship_state text,
  credit_estimate text,
  liquidity_estimate numeric,
  equity_injection_available numeric,
  annual_revenue_estimate numeric,
  cash_flow_estimate numeric,
  debt_obligations_notes text,
  collateral_notes text,
  industry text,
  naics_code text,
  franchise_status text check (franchise_status in ('franchise', 'independent', 'unknown')),
  geographic_location text,
  time_sensitivity text,
  existing_lender_discussions text,
  known_eligibility_concerns text,
  -- Per-field provenance: { "credit_estimate": "borrower_stated", ... }.
  -- Values constrained at the application layer (unknown / borrower_stated /
  -- document_supported / verified / conflicting / not_applicable) — kept as
  -- jsonb metadata rather than ~20 parallel provenance columns, per this
  -- program's own JSON-for-metadata-not-workflow-state principle (the facts
  -- themselves are structured columns above; provenance is metadata *about*
  -- them, not itself a workflow-driving fact).
  field_provenance jsonb not null default '{}'::jsonb,
  created_by_clerk_user_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.brokerage_lead_qualifications enable row level security;
create policy service_role_all on public.brokerage_lead_qualifications
  for all to service_role using (true) with check (true);

create index idx_brokerage_lead_qualifications_bank_id on public.brokerage_lead_qualifications(bank_id);

-- ── 4. Extend crm_activities target pattern to leads ───────────────────────
-- Reuses the existing unified timeline (kind='stage_change' was already
-- reserved but unused) instead of a parallel lead-activity/audit table.

alter table public.crm_activities add column if not exists target_lead_id uuid
  references public.brokerage_leads(id) on delete cascade;

alter table public.crm_activities drop constraint if exists crm_activities_exactly_one_target;
alter table public.crm_activities add constraint crm_activities_exactly_one_target check (
  (target_deal_id is not null)::int
  + (target_organization_id is not null)::int
  + (target_person_id is not null)::int
  + (target_lead_id is not null)::int = 1
);

create index if not exists idx_crm_activities_target_lead on public.crm_activities(target_lead_id)
  where target_lead_id is not null;
