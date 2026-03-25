-- Phase 53A.4 — Committee-Grade Exception Workflow
-- Adds durable exception records, mitigant capture, and memo snapshots.

-- 1. Durable policy exception records per deal
create table if not exists deal_policy_exceptions (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null,
  exception_key text not null,
  exception_type text not null,
  severity text not null default 'exception',
  title text not null,
  description text not null,
  policy_reference text,
  source_document_id uuid,
  detected_value numeric,
  policy_limit_value numeric,
  context_json jsonb not null default '{}'::jsonb,
  status text not null default 'open',
  first_detected_at timestamptz not null default now(),
  last_detected_at timestamptz not null default now(),
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(deal_id, exception_key)
);

create index if not exists idx_deal_policy_exceptions_deal on deal_policy_exceptions(deal_id);
create index if not exists idx_deal_policy_exceptions_status on deal_policy_exceptions(deal_id, status);

-- 2. Exception actions / mitigants / workflow transitions
create table if not exists deal_policy_exception_actions (
  id uuid primary key default gen_random_uuid(),
  exception_id uuid not null references deal_policy_exceptions(id) on delete cascade,
  action_type text not null,
  previous_status text,
  new_status text,
  mitigant_text text,
  rationale_text text,
  acted_by text,
  acted_at timestamptz not null default now(),
  metadata_json jsonb not null default '{}'::jsonb
);

create index if not exists idx_deal_policy_exception_actions_exc on deal_policy_exception_actions(exception_id);

-- 3. Credit memo snapshots for reproducibility
create table if not exists credit_memo_snapshots (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null,
  generated_by text,
  generated_at timestamptz not null default now(),
  builder_state_json jsonb not null default '{}'::jsonb,
  policy_exceptions_json jsonb not null default '[]'::jsonb,
  builder_decisions_json jsonb not null default '[]'::jsonb,
  memo_output_json jsonb not null default '{}'::jsonb
);

create index if not exists idx_credit_memo_snapshots_deal on credit_memo_snapshots(deal_id);
