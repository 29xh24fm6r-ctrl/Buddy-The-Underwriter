-- Phase 53A.5 — Structuring Intelligence
-- Stores recommendation snapshots for reproducibility + audit.

create table if not exists structuring_recommendation_snapshots (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null,
  generated_by text,
  generated_at timestamptz not null default now(),
  input_state_json jsonb not null default '{}'::jsonb,
  scenarios_json jsonb not null default '[]'::jsonb,
  selected_scenario_json jsonb,
  applied_scenario_json jsonb
);

create index if not exists idx_structuring_rec_snapshots_deal on structuring_recommendation_snapshots(deal_id);
