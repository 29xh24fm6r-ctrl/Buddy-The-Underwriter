-- ============================================================
-- Committee Minutes + Dissent Opinions
-- ============================================================
-- PURPOSE: Auto-generated meeting minutes and formal dissent
-- capture for regulatory compliance.
--
-- TABLES:
-- 1. credit_committee_minutes (AI-generated narrative)
-- 2. credit_committee_dissent (formal dissent opinions)
-- ============================================================

-- ------------------------------------------------------------
-- Committee meeting minutes (auto-generated)
-- ------------------------------------------------------------
create table if not exists public.credit_committee_minutes (
  id uuid primary key default gen_random_uuid(),
  bank_id uuid not null references public.banks(id) on delete cascade,
  deal_id uuid not null references public.deals(id) on delete cascade,
  decision_snapshot_id uuid not null references public.decision_snapshots(id) on delete cascade,
  
  -- Minutes content (AI-generated narrative)
  content text not null,
  
  -- Metadata
  generated_at timestamptz not null default now(),
  generated_by_user_id text null, -- Who triggered generation
  snapshot_hash text not null, -- Integrity check
  
  -- One set of minutes per snapshot
  unique(decision_snapshot_id)
);

create index if not exists committee_minutes_snapshot_idx
  on public.credit_committee_minutes(decision_snapshot_id);

create index if not exists committee_minutes_deal_idx
  on public.credit_committee_minutes(deal_id);

-- ------------------------------------------------------------
-- Dissent opinions (formal disagreement records)
-- ------------------------------------------------------------
create table if not exists public.credit_committee_dissent (
  id uuid primary key default gen_random_uuid(),
  bank_id uuid not null references public.banks(id) on delete cascade,
  deal_id uuid not null references public.deals(id) on delete cascade,
  decision_snapshot_id uuid not null references public.decision_snapshots(id) on delete cascade,
  
  -- Dissenter info
  dissenter_user_id text not null,
  dissenter_name text null,
  
  -- Dissent content
  dissent_reason text not null,
  
  created_at timestamptz not null default now(),
  
  -- One dissent per user per snapshot
  unique(decision_snapshot_id, dissenter_user_id)
);

create index if not exists committee_dissent_snapshot_idx
  on public.credit_committee_dissent(decision_snapshot_id);

create index if not exists committee_dissent_deal_idx
  on public.credit_committee_dissent(deal_id);

-- RLS: Server-side only (deny all for security)
alter table public.credit_committee_minutes enable row level security;
alter table public.credit_committee_dissent enable row level security;

-- Comments
comment on table public.credit_committee_minutes is 
  'Auto-generated credit committee meeting minutes. One set per decision snapshot. AI-generated narrative from votes, attestations, and dissent.';
comment on table public.credit_committee_dissent is 
  'Formal dissent opinions from committee members who disagree with the majority decision. Required for regulatory compliance.';
comment on column public.credit_committee_minutes.content is 
  'AI-generated narrative summary of committee deliberation, votes, and outcome. Regulator-grade professional tone.';
comment on column public.credit_committee_dissent.dissent_reason is 
  'Detailed explanation of why the committee member dissents from the majority decision.';
