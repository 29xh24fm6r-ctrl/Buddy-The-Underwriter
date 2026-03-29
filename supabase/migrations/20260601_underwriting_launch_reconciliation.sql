-- Phase 56R: Reconciliation — add canonical reference fields to launch snapshots

alter table public.underwriting_launch_snapshots
  add column if not exists canonical_loan_request_id uuid null,
  add column if not exists financial_snapshot_id uuid null,
  add column if not exists lifecycle_hash text null,
  add column if not exists documents_readiness_pct numeric null,
  add column if not exists gatekeeper_review_count integer null,
  add column if not exists pricing_inputs_present boolean not null default false;
