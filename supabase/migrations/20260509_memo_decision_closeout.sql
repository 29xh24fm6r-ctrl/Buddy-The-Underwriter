-- Phase 54 — Credit Memo Completion + Loan Decision Closeout
-- Adds memo status, formal loan decisions, and finalization.

-- 1. Memo lifecycle status (one per deal)
create table if not exists deal_credit_memo_status (
  deal_id uuid primary key,
  current_status text not null default 'not_started',
  -- 'not_started' | 'drafting' | 'needs_input' | 'ready_for_committee' | 'decision_recorded' | 'finalized'
  active_memo_snapshot_id uuid,
  active_freeze_id uuid,
  active_selection_id uuid,
  updated_at timestamptz not null default now(),
  updated_by text
);

-- 2. Formal loan decision record (system of record)
create table if not exists deal_loan_decisions (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null,
  committee_decision_id uuid not null,
  freeze_id uuid not null,
  memo_snapshot_id uuid not null,
  decision_result text not null,
  -- 'approved' | 'approved_with_exceptions' | 'approved_with_changes' | 'declined'
  decision_summary text,
  approved_amount numeric,
  approved_structure_json jsonb not null default '{}'::jsonb,
  approved_exception_count integer not null default 0,
  recorded_by text,
  recorded_at timestamptz not null default now()
);

create index if not exists idx_deal_loan_decisions_deal on deal_loan_decisions(deal_id);

-- 3. Decision finalization (immutable final package)
create table if not exists deal_decision_finalization (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null,
  loan_decision_id uuid not null,
  final_package_json jsonb not null default '{}'::jsonb,
  finalized_by text,
  finalized_at timestamptz not null default now()
);

create index if not exists idx_deal_decision_finalization_deal on deal_decision_finalization(deal_id);
