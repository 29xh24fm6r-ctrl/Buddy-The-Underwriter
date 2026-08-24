-- Brokerage bank-buyer CRM: canonical lender relationship profiles and
-- per-bank deal distribution/outcome tracking.

create table public.crm_lender_profiles (
  id uuid primary key default gen_random_uuid(),
  bank_id uuid not null references public.banks(id) on delete cascade,
  organization_id uuid not null references public.crm_organizations(id) on delete cascade,
  linked_lender_bank_id uuid references public.banks(id) on delete set null,
  relationship_status text not null default 'prospect'
    check (relationship_status in ('prospect','active','paused','inactive')),
  lender_type text not null default 'bank'
    check (lender_type in ('bank','credit_union','non_bank','investor','other')),
  sba_7a_appetite boolean not null default true,
  sba_504_appetite boolean not null default false,
  conventional_appetite boolean not null default false,
  min_loan_amount numeric(16,2),
  max_loan_amount numeric(16,2),
  min_dscr numeric(6,3),
  max_ltv numeric(6,3),
  minimum_fico integer,
  industries text[] not null default '{}',
  excluded_industries text[] not null default '{}',
  geographies text[] not null default '{}',
  collateral_preferences text[] not null default '{}',
  deal_preferences text,
  referral_fee_bps integer,
  response_sla_days integer,
  relationship_owner_clerk_user_id text,
  last_appetite_reviewed_at timestamptz,
  created_by_clerk_user_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint crm_lender_profiles_tenant_org_unique unique (bank_id, organization_id),
  constraint crm_lender_profiles_amount_range check (
    min_loan_amount is null or max_loan_amount is null or min_loan_amount <= max_loan_amount
  ),
  constraint crm_lender_profiles_ratio_bounds check (
    (min_dscr is null or min_dscr between 0 and 10) and
    (max_ltv is null or max_ltv between 0 and 2)
  )
);

create index idx_crm_lender_profiles_bank on public.crm_lender_profiles(bank_id);
create index idx_crm_lender_profiles_org on public.crm_lender_profiles(organization_id);
create index idx_crm_lender_profiles_status on public.crm_lender_profiles(bank_id, relationship_status);

create table public.crm_deal_lender_submissions (
  id uuid primary key default gen_random_uuid(),
  bank_id uuid not null references public.banks(id) on delete cascade,
  deal_id uuid not null references public.deals(id) on delete cascade,
  lender_profile_id uuid not null references public.crm_lender_profiles(id) on delete restrict,
  banker_person_id uuid references public.crm_people(id) on delete set null,
  status text not null default 'planned'
    check (status in ('planned','sent','reviewing','interested','term_sheet','approved','declined','withdrawn','lost','closed')),
  amount_sent numeric(16,2),
  approved_amount numeric(16,2),
  closed_amount numeric(16,2),
  sent_at timestamptz,
  responded_at timestamptz,
  decision_at timestamptz,
  closed_at timestamptz,
  next_follow_up_at timestamptz,
  decline_reason text,
  lost_reason text,
  fit_rationale text,
  notes text,
  created_by_clerk_user_id text,
  updated_by_clerk_user_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint crm_deal_lender_submission_unique unique (bank_id, deal_id, lender_profile_id),
  constraint crm_deal_lender_submission_nonnegative check (
    coalesce(amount_sent,0) >= 0 and coalesce(approved_amount,0) >= 0 and coalesce(closed_amount,0) >= 0
  ),
  constraint crm_deal_lender_submission_closed_shape check (
    status <> 'closed' or (closed_at is not null and closed_amount is not null)
  ),
  constraint crm_deal_lender_submission_decline_shape check (
    status <> 'declined' or nullif(trim(decline_reason),'') is not null
  )
);

create index idx_crm_deal_lender_submissions_bank_status on public.crm_deal_lender_submissions(bank_id, status);
create index idx_crm_deal_lender_submissions_deal on public.crm_deal_lender_submissions(deal_id);
create index idx_crm_deal_lender_submissions_lender on public.crm_deal_lender_submissions(lender_profile_id, created_at desc);
create index idx_crm_deal_lender_submissions_followup on public.crm_deal_lender_submissions(bank_id, next_follow_up_at)
  where status not in ('declined','withdrawn','lost','closed');

create table public.crm_lender_submission_events (
  id uuid primary key default gen_random_uuid(),
  bank_id uuid not null references public.banks(id) on delete cascade,
  submission_id uuid not null references public.crm_deal_lender_submissions(id) on delete cascade,
  event_type text not null check (event_type in ('created','sent','status_changed','amount_changed','note','follow_up')),
  from_status text,
  to_status text,
  details jsonb not null default '{}',
  actor_clerk_user_id text,
  happened_at timestamptz not null default now()
);

create index idx_crm_lender_submission_events_submission on public.crm_lender_submission_events(submission_id, happened_at desc);
create index idx_crm_lender_submission_events_bank on public.crm_lender_submission_events(bank_id, happened_at desc);

alter table public.crm_lender_profiles enable row level security;
alter table public.crm_deal_lender_submissions enable row level security;
alter table public.crm_lender_submission_events enable row level security;

create policy "service_role_all" on public.crm_lender_profiles
  for all to service_role using (true) with check (true);
create policy "service_role_all" on public.crm_deal_lender_submissions
  for all to service_role using (true) with check (true);
create policy "service_role_all" on public.crm_lender_submission_events
  for all to service_role using (true) with check (true);

comment on table public.crm_lender_profiles is 'Brokerage-owned relationship and credit-appetite profile for a potential SBA deal buyer.';
comment on table public.crm_deal_lender_submissions is 'Canonical many-to-many ledger of deals distributed to lenders and their commercial outcomes.';
comment on table public.crm_lender_submission_events is 'Append-only audit history for lender submission lifecycle changes.';
