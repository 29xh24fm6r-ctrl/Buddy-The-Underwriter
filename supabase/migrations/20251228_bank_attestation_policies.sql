-- Bank Attestation Policies: Configurable governance for decision sign-offs
-- Purpose: Banks define how many attestations are required and from which roles
-- Use case: Credit committee governance, SOX compliance, regulatory requirements

create table if not exists public.bank_attestation_policies (
  bank_id uuid primary key references public.banks(id) on delete cascade,
  required_count integer not null default 1 check (required_count >= 1),
  required_roles text[] null, -- e.g. ['underwriter', 'credit_chair', 'cro']
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Index for lookups
create index if not exists idx_bank_attestation_policies_bank
  on public.bank_attestation_policies(bank_id);

-- RLS: Deny-all (access via supabaseAdmin only)
alter table public.bank_attestation_policies enable row level security;

create policy "deny_all_bank_attestation_policies"
  on public.bank_attestation_policies
  for all
  using (false);

-- Grant permissions
grant select, insert, update on public.bank_attestation_policies to authenticated;
grant select, insert, update on public.bank_attestation_policies to service_role;

-- Default policy for existing banks (1 attestation required, any role)
insert into public.bank_attestation_policies (bank_id, required_count, required_roles)
select id, 1, null
from public.banks
where id not in (select bank_id from public.bank_attestation_policies)
on conflict (bank_id) do nothing;

-- Comment
comment on table public.bank_attestation_policies is
  'Bank-level configuration for decision attestation requirements. Defines governance rules for multi-party sign-offs.';

comment on column public.bank_attestation_policies.required_count is
  'Minimum number of attestations required before decision is considered complete.';

comment on column public.bank_attestation_policies.required_roles is
  'Optional: If set, attestations must come from specified roles. If null, any role is accepted.';
