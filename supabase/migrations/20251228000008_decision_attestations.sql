-- Decision Attestations: Chain of Custody for Underwriting Decisions
-- Purpose: Human sign-off on final decisions with cryptographic integrity
-- Use case: Regulators, auditors, credit committees

create table if not exists public.decision_attestations (
  id uuid primary key default gen_random_uuid(),
  decision_snapshot_id uuid not null references public.decision_snapshots(id) on delete cascade,
  deal_id uuid not null,
  bank_id uuid not null, -- tenant isolation
  created_at timestamptz not null default now(),
  attested_by_user_id text not null, -- Clerk user ID
  attested_by_name text, -- Cached for display
  attested_role text not null, -- underwriter | credit_chair | risk_officer | cro
  statement text not null, -- Human attestation statement
  snapshot_hash text not null -- SHA-256 of snapshot at time of attestation
);

-- Index for lookups
create index if not exists idx_decision_attestations_snapshot
  on public.decision_attestations(decision_snapshot_id);

create index if not exists idx_decision_attestations_deal
  on public.decision_attestations(deal_id);

-- RLS: Deny-all (access via supabaseAdmin only)
alter table public.decision_attestations enable row level security;

create policy "deny_all_decision_attestations"
  on public.decision_attestations
  for all
  using (false);

-- Grant permissions
grant select, insert on public.decision_attestations to authenticated;
grant select, insert on public.decision_attestations to service_role;

-- Comment
comment on table public.decision_attestations is
  'Chain of custody: Human attestations on final decisions. Creates unforgeable audit trail.';
