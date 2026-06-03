-- SPEC-BIE-PRIVATE-COMPANY-RESEARCH-ENGINE-MEGA-1 — Phase 1
--
-- Per-thread BIE diagnostics so a null management/synthesis thread is never
-- opaque. Smallest safe persistence: one jsonb column on the mission row keyed
-- by the canonical thread name (entity_lock/borrower/management/competitive/
-- market/industry/transaction/synthesis), each holding a BIEThreadDiagnostic.
--
-- Nullable-friendly default; no backfill. The flight deck reads this to explain
-- exactly why a thread produced no usable output.

alter table public.buddy_research_missions
  add column if not exists thread_diagnostics jsonb not null default '{}'::jsonb;
