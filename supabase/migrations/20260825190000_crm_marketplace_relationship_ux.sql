-- CRM marketplace relationship model: keep one canonical bank record while
-- tracking how that bank participates in the SBA marketplace.

alter table public.crm_lender_profiles
  add column if not exists marketplace_role text,
  add column if not exists marketplace_access_status text not null default 'not_invited',
  add column if not exists marketplace_onboarding_notes text,
  add column if not exists marketplace_first_active_at timestamptz,
  add column if not exists marketplace_last_active_at timestamptz;

alter table public.crm_lender_profiles
  drop constraint if exists crm_lender_profiles_marketplace_role_check,
  add constraint crm_lender_profiles_marketplace_role_check
    check (marketplace_role is null or marketplace_role in ('buyer','seller','buyer_seller','viewer')),
  drop constraint if exists crm_lender_profiles_marketplace_access_status_check,
  add constraint crm_lender_profiles_marketplace_access_status_check
    check (marketplace_access_status in ('not_invited','invited','onboarding','active','suspended','inactive')),
  drop constraint if exists crm_lender_profiles_relationship_status_check,
  add constraint crm_lender_profiles_relationship_status_check
    check (relationship_status in ('prospect','qualified','active','preferred','paused','inactive'));

create index if not exists idx_crm_lender_profiles_marketplace
  on public.crm_lender_profiles(bank_id, marketplace_access_status)
  where marketplace_role is not null;

comment on column public.crm_lender_profiles.marketplace_role is
  'Role of this canonical bank organization in the Buddy SBA marketplace; null means not a marketplace participant.';
comment on column public.crm_lender_profiles.marketplace_access_status is
  'Operational marketplace access lifecycle, distinct from the commercial buyer relationship status.';
