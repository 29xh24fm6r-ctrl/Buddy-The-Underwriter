-- Permanent CRM removal is an explicit brokerage-admin action. Keep a
-- service-only receipt even after the business record itself is gone.
create table if not exists public.crm_admin_deletion_log (
  id uuid primary key default gen_random_uuid(),
  bank_id uuid not null references public.banks(id) on delete cascade,
  actor_clerk_user_id text not null,
  entity_type text not null check (entity_type in ('organization','person','lead','activity')),
  entity_id uuid not null,
  entity_label text not null,
  snapshot jsonb not null default '{}'::jsonb,
  status text not null default 'requested' check (status in ('requested','completed','failed')),
  failure_reason text,
  deleted_at timestamptz not null default now()
);

create index if not exists idx_crm_admin_deletion_log_bank_time
  on public.crm_admin_deletion_log(bank_id, deleted_at desc);

alter table public.crm_admin_deletion_log enable row level security;
revoke all on table public.crm_admin_deletion_log from anon, authenticated;
grant all on table public.crm_admin_deletion_log to service_role;

-- These relationships are attribution/history links, not ownership. A CRM
-- deletion should remove the selected record while preserving the deal or
-- lead on the other side.
alter table public.brokerage_leads
  drop constraint if exists brokerage_leads_referral_source_org_id_fkey,
  add constraint brokerage_leads_referral_source_org_id_fkey
    foreign key (referral_source_org_id) references public.crm_organizations(id) on delete set null;

alter table public.brokerage_conversion_events
  drop constraint if exists brokerage_conversion_events_lead_id_fkey,
  add constraint brokerage_conversion_events_lead_id_fkey
    foreign key (lead_id) references public.brokerage_leads(id) on delete cascade;

alter table public.crm_people
  drop constraint if exists crm_people_merged_into_id_fkey,
  add constraint crm_people_merged_into_id_fkey
    foreign key (merged_into_id) references public.crm_people(id) on delete set null;

alter table public.crm_organizations
  drop constraint if exists crm_organizations_merged_into_id_fkey,
  add constraint crm_organizations_merged_into_id_fkey
    foreign key (merged_into_id) references public.crm_organizations(id) on delete set null;
