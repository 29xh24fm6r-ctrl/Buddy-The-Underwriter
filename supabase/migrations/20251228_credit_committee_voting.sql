-- ============================================================
-- Credit Committee Voting + Policy Auto-Extraction
-- ============================================================
-- PURPOSE: Enable multi-member credit committee voting with
-- quorum logic, policy auto-extraction from uploaded docs,
-- and full audit trail.
--
-- TABLES:
-- 1. bank_credit_committee_members (who can vote)
-- 2. credit_committee_votes (immutable vote records)
-- 3. policy_extracted_rules (AI-assisted rule extraction)
-- ============================================================

-- ------------------------------------------------------------
-- Credit committee members (per bank)
-- ------------------------------------------------------------
create table if not exists public.bank_credit_committee_members (
  id uuid primary key default gen_random_uuid(),
  bank_id uuid not null references public.banks(id) on delete cascade,
  user_id text not null, -- Clerk user ID
  role text not null, -- chair, member, observer
  created_at timestamptz not null default now(),
  
  unique(bank_id, user_id)
);

create index if not exists committee_members_bank_idx
  on public.bank_credit_committee_members(bank_id);

-- ------------------------------------------------------------
-- Credit committee votes (per snapshot)
-- ------------------------------------------------------------
create table if not exists public.credit_committee_votes (
  id uuid primary key default gen_random_uuid(),
  bank_id uuid not null references public.banks(id) on delete cascade,
  deal_id uuid not null references public.deals(id) on delete cascade,
  decision_snapshot_id uuid not null references public.decision_snapshots(id) on delete cascade,
  voter_user_id text not null, -- Clerk user ID
  voter_name text null, -- Display name
  vote text not null check (vote in ('approve', 'approve_with_conditions', 'decline')),
  comment text null,
  created_at timestamptz not null default now(),
  
  unique(decision_snapshot_id, voter_user_id)
);

create index if not exists committee_votes_snapshot_idx
  on public.credit_committee_votes(decision_snapshot_id);

create index if not exists committee_votes_deal_idx
  on public.credit_committee_votes(deal_id);

-- ------------------------------------------------------------
-- Policy auto-extracted rules (staged, reviewable)
-- ------------------------------------------------------------
create table if not exists public.policy_extracted_rules (
  id uuid primary key default gen_random_uuid(),
  bank_id uuid not null references public.banks(id) on delete cascade,
  source_upload_id uuid not null references public.uploads(id) on delete cascade,
  extracted_rules_json jsonb not null default '{}'::jsonb,
  extraction_confidence text null, -- high, medium, low
  extraction_explanation text null,
  approved boolean not null default false,
  approved_by_user_id text null,
  approved_at timestamptz null,
  created_at timestamptz not null default now(),
  
  unique(bank_id, source_upload_id)
);

create index if not exists policy_extracted_rules_bank_idx
  on public.policy_extracted_rules(bank_id);

-- RLS: Server-side only (deny all for security)
alter table public.bank_credit_committee_members enable row level security;
alter table public.credit_committee_votes enable row level security;
alter table public.policy_extracted_rules enable row level security;

-- Comments
comment on table public.bank_credit_committee_members is 
  'Defines which users are credit committee members per bank. Used for voting eligibility.';
comment on table public.credit_committee_votes is 
  'Immutable vote records for credit committee decisions. One vote per user per snapshot.';
comment on table public.policy_extracted_rules is 
  'AI-extracted governance rules from uploaded credit policy documents. Requires human approval.';
comment on column public.credit_committee_votes.vote is 
  'approve: unconditional approval, approve_with_conditions: conditional approval, decline: reject decision';
comment on column public.policy_extracted_rules.approved is 
  'If true, these rules are active and will be used for committee requirement evaluation.';
