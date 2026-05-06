-- SPEC-10: persistent advisor signal feedback.
--
-- Stores acknowledge / dismiss / snooze state per (deal, user, signalKey).
-- Mutations also emit advisor_signal_* events to buddy_signal_ledger;
-- this table holds the *current* state for fast read.
--
-- The feedback API degrades gracefully when this table is missing, so the
-- migration can be applied independently of the application deploy.

create table if not exists buddy_advisor_feedback (
  id uuid primary key default gen_random_uuid(),
  bank_id uuid not null,
  deal_id uuid not null,
  user_id uuid,
  signal_key text not null,
  signal_kind text not null,
  signal_source text not null,
  state text not null check (state in ('acknowledged', 'dismissed', 'snoozed')),
  snoozed_until timestamptz,
  reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (bank_id, deal_id, user_id, signal_key)
);

create index if not exists idx_buddy_advisor_feedback_deal
  on buddy_advisor_feedback (bank_id, deal_id);

create index if not exists idx_buddy_advisor_feedback_user
  on buddy_advisor_feedback (bank_id, deal_id, user_id);

create index if not exists idx_buddy_advisor_feedback_snoozed_until
  on buddy_advisor_feedback (snoozed_until)
  where state = 'snoozed';

comment on table buddy_advisor_feedback is
  'SPEC-10: per-banker advisor signal feedback (acknowledge/dismiss/snooze).';
