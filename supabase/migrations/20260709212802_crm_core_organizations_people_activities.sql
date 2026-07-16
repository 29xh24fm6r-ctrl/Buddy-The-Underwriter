-- Reconstructed from live schema (supabase_migrations.schema_migrations) --
-- applied directly to the production project and never committed to the
-- repo. Captured verbatim for governance/reproducibility (see CRM audit,
-- 2026-07-16).

-- CRM core for Buddy Brokerage — Twenty-inspired data model, clean-room
-- implementation (concepts/relationships studied from twentyhq/twenty's
-- public standard-objects, no code copied; AGPL applies to their code, not
-- to the architectural patterns it expresses).
--
-- Three tables:
--   crm_organizations — companies/entities a relationship exists with:
--     referral sources (CPAs, attorneys, business brokers), professional
--     partners — distinct from `banks`, which is lenders/tenants specifically.
--   crm_people         — contacts at those organizations, or independent
--     contacts (a referring CPA who isn't tied to a firm in the system yet).
--   crm_activities     — the unified timeline. One activity table, not
--     separate notes/tasks/calls tables — every interaction type is a row
--     here with a `kind` discriminator. This mirrors Twenty's
--     TimelineActivity: happens_at, name/kind, JSON properties, actor, and
--     explicit nullable target FKs (the "Target" pattern) so one activity
--     attaches to exactly one deal, organization, or person.
--
-- Tenant-scoped via bank_id, consistent with every other table in this app.

create table crm_organizations (
  id uuid primary key default gen_random_uuid(),
  bank_id uuid not null references banks(id) on delete cascade,
  name text not null,
  organization_type text not null default 'referral_source'
    check (organization_type in ('referral_source', 'professional_partner', 'other')),
  website_url text,
  phone text,
  address_line1 text,
  city text,
  state text,
  postal_code text,
  notes text,
  created_by_clerk_user_id text,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

create index idx_crm_organizations_bank_id on crm_organizations(bank_id);

create table crm_people (
  id uuid primary key default gen_random_uuid(),
  bank_id uuid not null references banks(id) on delete cascade,
  organization_id uuid references crm_organizations(id) on delete set null,
  first_name text,
  last_name text,
  email text,
  phone text,
  job_title text,
  linkedin_url text,
  notes text,
  created_by_clerk_user_id text,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

create index idx_crm_people_bank_id on crm_people(bank_id);
create index idx_crm_people_organization_id on crm_people(organization_id);

create table crm_activities (
  id uuid primary key default gen_random_uuid(),
  bank_id uuid not null references banks(id) on delete cascade,
  kind text not null
    check (kind in ('note', 'task', 'call', 'email', 'meeting', 'stage_change', 'system')),
  happens_at timestamp with time zone not null default now(),
  title text,
  properties jsonb not null default '{}'::jsonb,
  actor_clerk_user_id text,
  -- Target pattern (Twenty-style): nullable FK per attachable type.
  -- Exactly one of these should be set per activity.
  target_deal_id uuid references deals(id) on delete cascade,
  target_organization_id uuid references crm_organizations(id) on delete cascade,
  target_person_id uuid references crm_people(id) on delete cascade,
  -- Task-specific fields (kind = 'task'); null for other kinds.
  due_at timestamp with time zone,
  completed_at timestamp with time zone,
  assigned_to_clerk_user_id text,
  created_at timestamp with time zone not null default now(),
  constraint crm_activities_exactly_one_target check (
    (target_deal_id is not null)::int
    + (target_organization_id is not null)::int
    + (target_person_id is not null)::int = 1
  )
);

create index idx_crm_activities_bank_id on crm_activities(bank_id);
create index idx_crm_activities_target_deal on crm_activities(target_deal_id) where target_deal_id is not null;
create index idx_crm_activities_target_org on crm_activities(target_organization_id) where target_organization_id is not null;
create index idx_crm_activities_target_person on crm_activities(target_person_id) where target_person_id is not null;
create index idx_crm_activities_happens_at on crm_activities(happens_at desc);
