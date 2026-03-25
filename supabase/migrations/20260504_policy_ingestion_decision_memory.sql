-- Phase 53A.3 — Policy Ingestion + Banker Decision Memory
-- Adds structured bank credit policy rules and persistent builder decisions.

-- 1. Structured bank credit policy rules
create table if not exists bank_policy_rules (
  id uuid primary key default gen_random_uuid(),
  bank_id uuid not null,
  policy_type text not null, -- 'advance_rate' | 'equity_requirement' | 'ltv_limit'
  collateral_type text,
  product_type text,
  min_value numeric,
  max_value numeric,
  rule_value numeric, -- e.g. 0.80 for 80%
  rule_unit text, -- 'percent' | 'ratio'
  policy_reference text,
  source_document_id uuid,
  confidence numeric,
  created_at timestamptz default now()
);

create index if not exists idx_bank_policy_rules_bank_id on bank_policy_rules(bank_id);
create index if not exists idx_bank_policy_rules_lookup on bank_policy_rules(bank_id, policy_type, collateral_type, product_type);

-- 2. Persistent builder decisions (banker decision memory)
create table if not exists builder_decisions (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null,
  bank_id uuid,
  decision_type text not null,
  entity_type text, -- 'collateral' | 'owner' | 'equity' | 'policy'
  entity_id uuid,
  field_name text,
  previous_value jsonb,
  new_value jsonb,
  decision_reason text,
  decision_source text not null default 'user', -- 'user' | 'system'
  created_by text,
  created_at timestamptz default now()
);

create index if not exists idx_builder_decisions_deal_id on builder_decisions(deal_id);
create index if not exists idx_builder_decisions_lookup on builder_decisions(deal_id, decision_type);
