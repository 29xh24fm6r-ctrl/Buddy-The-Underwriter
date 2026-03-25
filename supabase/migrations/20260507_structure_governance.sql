-- Phase 53B — Structure Selection, Governance, and Execution
-- Adds scenario selection, structure freeze, and committee decisions.

-- 1. Scenario selection (decision of record)
create table if not exists deal_structuring_selections (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null,
  scenario_id text not null,
  scenario_snapshot_json jsonb not null default '{}'::jsonb,
  selected_by text,
  selected_at timestamptz not null default now(),
  is_active boolean not null default true
);

create index if not exists idx_deal_structuring_selections_deal on deal_structuring_selections(deal_id);
create index if not exists idx_deal_structuring_selections_active on deal_structuring_selections(deal_id, is_active) where is_active = true;

-- 2. Structure freeze (committee package integrity)
create table if not exists deal_structuring_freeze (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null,
  frozen_selection_id uuid not null,
  frozen_builder_state_json jsonb not null default '{}'::jsonb,
  frozen_policy_exceptions_json jsonb not null default '[]'::jsonb,
  frozen_decisions_json jsonb not null default '[]'::jsonb,
  frozen_memo_snapshot_id uuid,
  frozen_by text,
  frozen_at timestamptz not null default now(),
  is_active boolean not null default true
);

create index if not exists idx_deal_structuring_freeze_deal on deal_structuring_freeze(deal_id);

-- 3. Committee disposition tracking
create table if not exists deal_committee_decisions (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null,
  freeze_id uuid not null,
  decision text not null,
  decision_notes text,
  decided_by text,
  decided_at timestamptz not null default now()
);

create index if not exists idx_deal_committee_decisions_deal on deal_committee_decisions(deal_id);
