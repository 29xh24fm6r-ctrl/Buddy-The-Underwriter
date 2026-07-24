-- SPEC-BROKERAGE-OPERATING-SYSTEM-V1, PR1: unified relationship graph.
--
-- Decisions locked before writing this (see discovery note, 2026-07-17):
--   - ownership_entities remains authoritative for borrower/owner/guarantor
--     identity on a deal. borrower_owners (SBA Form 601/155 signature
--     generation, PFS requirements) is untouched -- 9 live call sites, no
--     evidence it's safe to migrate away from, out of scope for this PR.
--   - deal_participants remains authoritative for internal-staff deal roles
--     (underwriter/bank_admin/observer already live; widened here to add
--     broker/co_broker/closer/processor rather than inventing a parallel
--     staff-role table).
--   - deal_party_roles (new, below) is therefore scoped to EXTERNAL parties
--     only -- referral sources/contacts, CPAs, attorneys, and other service
--     providers -- roles with no existing authoritative table. It is an
--     index, not a replacement, per the no-parallel-representations rule.
--
-- Also captures untracked prod drift found during discovery:
-- deal_participants_role_check already includes 'observer' live, but no
-- migration in this repo added it.

-- ---------------------------------------------------------------------
-- 1. Widen crm_organizations.organization_type for the broader role set
--    the relationship graph needs (CPA firms, law firms, lenders, title
--    companies, etc.) -- was previously just 3 generic values.
-- ---------------------------------------------------------------------

alter table public.crm_organizations
  drop constraint crm_organizations_organization_type_check;

alter table public.crm_organizations
  add constraint crm_organizations_organization_type_check
  check (organization_type in (
    'referral_source', 'professional_partner', 'borrower_business', 'cpa_firm',
    'law_firm', 'lender', 'insurance_provider', 'appraisal_firm',
    'environmental_firm', 'title_company', 'franchise_organization', 'seller',
    'landlord', 'investor', 'vendor', 'other'
  ));

-- ---------------------------------------------------------------------
-- 2. crm_people: add the fields a real contact record needs, plus a
--    soft-merge pair (merged_into_id/merged_at) so dedup never deletes
--    history -- a merged record stays queryable, just flagged.
-- ---------------------------------------------------------------------

alter table public.crm_people
  add column if not exists preferred_name text,
  add column if not exists mobile_phone text,
  add column if not exists communication_preference text,
  add column if not exists contact_status text not null default 'active',
  add column if not exists relationship_owner_clerk_user_id text,
  add column if not exists do_not_contact boolean not null default false,
  add column if not exists last_contacted_at timestamptz,
  add column if not exists last_response_at timestamptz,
  add column if not exists merged_into_id uuid references public.crm_people(id),
  add column if not exists merged_at timestamptz;

alter table public.crm_people
  add constraint crm_people_contact_status_check
  check (contact_status in ('active', 'inactive', 'do_not_contact'));

-- Same soft-merge pair for organizations.
alter table public.crm_organizations
  add column if not exists merged_into_id uuid references public.crm_organizations(id),
  add column if not exists merged_at timestamptz;

-- ---------------------------------------------------------------------
-- 3. crm_person_organization_roles: a person may belong to multiple
--    organizations with multiple roles -- crm_people.organization_id
--    (kept, not dropped, for backward compatibility) can only ever
--    represent one.
-- ---------------------------------------------------------------------

create table if not exists public.crm_person_organization_roles (
  id uuid primary key default gen_random_uuid(),
  bank_id uuid not null references public.banks(id) on delete cascade,
  person_id uuid not null references public.crm_people(id) on delete cascade,
  organization_id uuid not null references public.crm_organizations(id) on delete cascade,
  role text not null default 'contact'
    check (role in ('contact', 'decision_maker', 'billing_contact', 'referral_contact', 'primary_contact', 'other')),
  job_title text,
  start_date date,
  end_date date,
  is_primary_contact boolean not null default false,
  is_decision_maker boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_crm_person_org_roles_person on public.crm_person_organization_roles(person_id);
create index if not exists idx_crm_person_org_roles_org on public.crm_person_organization_roles(organization_id);
create index if not exists idx_crm_person_org_roles_bank on public.crm_person_organization_roles(bank_id);

alter table public.crm_person_organization_roles enable row level security;
create policy "service_role_all" on public.crm_person_organization_roles
  as permissive for all to service_role using (true) with check (true);

-- ---------------------------------------------------------------------
-- 4. deal_party_roles: EXTERNAL parties only (see header note). Target
--    pattern mirrors crm_activities -- exactly one of person_id /
--    organization_id per row.
-- ---------------------------------------------------------------------

create table if not exists public.deal_party_roles (
  id uuid primary key default gen_random_uuid(),
  bank_id uuid not null references public.banks(id) on delete cascade,
  deal_id uuid not null references public.deals(id) on delete cascade,
  role text not null
    check (role in (
      'referral_source', 'referral_contact', 'cpa', 'attorney', 'insurance_agent',
      'appraiser', 'environmental_firm', 'title_company', 'franchise_representative',
      'seller', 'landlord', 'investor', 'other'
    )),
  person_id uuid references public.crm_people(id) on delete cascade,
  organization_id uuid references public.crm_organizations(id) on delete cascade,
  notes text,
  created_by_clerk_user_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint deal_party_roles_exactly_one_target check (
    ((person_id is not null)::int + (organization_id is not null)::int) = 1
  )
);

create index if not exists idx_deal_party_roles_deal on public.deal_party_roles(deal_id);
create index if not exists idx_deal_party_roles_person on public.deal_party_roles(person_id) where person_id is not null;
create index if not exists idx_deal_party_roles_org on public.deal_party_roles(organization_id) where organization_id is not null;
create index if not exists idx_deal_party_roles_bank on public.deal_party_roles(bank_id);

alter table public.deal_party_roles enable row level security;
create policy "service_role_all" on public.deal_party_roles
  as permissive for all to service_role using (true) with check (true);

-- ---------------------------------------------------------------------
-- 5. deal_source_attribution: structured replacement for the
--    single-field deals.referral_source_org_id (kept, not dropped, for
--    backward compatibility -- this table is additive).
-- ---------------------------------------------------------------------

create table if not exists public.deal_source_attribution (
  id uuid primary key default gen_random_uuid(),
  bank_id uuid not null references public.banks(id) on delete cascade,
  deal_id uuid not null references public.deals(id) on delete cascade,
  first_touch_source text,
  last_touch_source text,
  referring_organization_id uuid references public.crm_organizations(id) on delete set null,
  referring_person_id uuid references public.crm_people(id) on delete set null,
  campaign text,
  marketing_channel text,
  internal_owner_clerk_user_id text,
  co_broker_org_id uuid references public.crm_organizations(id) on delete set null,
  attribution_percentage numeric,
  referral_fee_arrangement text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint deal_source_attribution_one_per_deal unique (deal_id)
);

create index if not exists idx_deal_source_attribution_bank on public.deal_source_attribution(bank_id);
create index if not exists idx_deal_source_attribution_referring_org on public.deal_source_attribution(referring_organization_id) where referring_organization_id is not null;

alter table public.deal_source_attribution enable row level security;
create policy "service_role_all" on public.deal_source_attribution
  as permissive for all to service_role using (true) with check (true);

-- ---------------------------------------------------------------------
-- 6. crm_merge_log: append-only audit trail for person/org dedup merges.
--    A merge never deletes the losing record -- it gets flagged via
--    merged_into_id/merged_at (added in step 2) and this row captures a
--    full snapshot + reason for rollback/history.
-- ---------------------------------------------------------------------

create table if not exists public.crm_merge_log (
  id uuid primary key default gen_random_uuid(),
  bank_id uuid not null references public.banks(id) on delete cascade,
  entity_type text not null check (entity_type in ('person', 'organization')),
  source_id uuid not null,
  target_id uuid not null,
  merged_by_clerk_user_id text not null,
  reason text,
  source_snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_crm_merge_log_bank on public.crm_merge_log(bank_id);
create index if not exists idx_crm_merge_log_target on public.crm_merge_log(target_id);

alter table public.crm_merge_log enable row level security;
create policy "service_role_all" on public.crm_merge_log
  as permissive for all to service_role using (true) with check (true);

-- ---------------------------------------------------------------------
-- 7. deal_participants: widen role set to cover internal brokerage staff
--    roles from the relationship graph (broker/co_broker/closer/
--    processor), reusing this authoritative table rather than a new one.
--    Also captures 'observer', which is live in prod but was never
--    tracked in this repo's migration history (drift found during
--    discovery for this program).
-- ---------------------------------------------------------------------

alter table public.deal_participants
  drop constraint deal_participants_role_check;

alter table public.deal_participants
  add constraint deal_participants_role_check
  check (role in ('borrower', 'underwriter', 'bank_admin', 'observer', 'broker', 'co_broker', 'closer', 'processor'));

-- ---------------------------------------------------------------------
-- 8. Backfill (idempotent -- safe to run more than once). Both are
--    effectively no-ops today (0 rows in crm_people, 0 deals with
--    referral_source_org_id set, verified live before writing this),
--    kept for correctness / future data.
-- ---------------------------------------------------------------------

insert into public.crm_person_organization_roles (bank_id, person_id, organization_id, role, job_title, is_primary_contact)
select p.bank_id, p.id, p.organization_id, 'contact', p.job_title, true
from public.crm_people p
where p.organization_id is not null
  and not exists (
    select 1 from public.crm_person_organization_roles r
    where r.person_id = p.id and r.organization_id = p.organization_id
  );

insert into public.deal_source_attribution (bank_id, deal_id, last_touch_source, referring_organization_id)
select d.bank_id, d.id, 'legacy_referral_source_org_id', d.referral_source_org_id
from public.deals d
where d.referral_source_org_id is not null
  and not exists (select 1 from public.deal_source_attribution a where a.deal_id = d.id);
