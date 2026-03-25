-- Phase 54 — Externalization + Distribution Layer
-- Stores distribution snapshots and lifecycle actions.

-- 1. Distribution snapshots (reproducible outbound packages)
create table if not exists deal_distribution_snapshots (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null,
  source_freeze_id uuid not null,
  source_committee_decision_id uuid,
  package_type text not null, -- 'borrower' | 'banker' | 'relationship' | 'full'
  package_json jsonb not null default '{}'::jsonb,
  generated_by text,
  generated_at timestamptz not null default now()
);

create index if not exists idx_deal_distribution_snapshots_deal on deal_distribution_snapshots(deal_id);

-- 2. Distribution actions (preview / approve / send / publish lifecycle)
create table if not exists deal_distribution_actions (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null,
  snapshot_id uuid not null,
  action_type text not null, -- 'previewed' | 'approved' | 'sent' | 'published_to_portal' | 'dismissed'
  channel text, -- 'portal' | 'email' | 'sms' | 'rm_internal'
  acted_by text,
  acted_at timestamptz not null default now(),
  notes text
);

create index if not exists idx_deal_distribution_actions_deal on deal_distribution_actions(deal_id);
create index if not exists idx_deal_distribution_actions_snapshot on deal_distribution_actions(snapshot_id);
