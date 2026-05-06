-- SPEC-11: harden advisor persistence tables.
--
-- Adds:
--   1. RLS + per-bank policies to buddy_advisor_feedback +
--      buddy_blocker_observations using public.get_current_bank_id()
--      (the canonical bank-context helper introduced in
--      20260101999999_fix_checklist_rls_bank_context.sql).
--   2. dismiss_count + last_dismissed_at columns on
--      buddy_advisor_feedback so repeated-dismissal detection happens
--      server-side (replaces SPEC-10's browser-only counter).
--
-- Idempotent — uses `if not exists` and `drop policy if exists` so the
-- migration can be applied multiple times safely.

-- ─── 1) New columns on buddy_advisor_feedback ─────────────────────

alter table buddy_advisor_feedback
  add column if not exists dismiss_count integer not null default 0;

alter table buddy_advisor_feedback
  add column if not exists last_dismissed_at timestamptz;

create index if not exists idx_buddy_advisor_feedback_dismiss_count
  on buddy_advisor_feedback (bank_id, deal_id, user_id)
  where dismiss_count >= 3;

-- ─── 2) RLS for buddy_advisor_feedback ────────────────────────────

alter table buddy_advisor_feedback enable row level security;

drop policy if exists "buddy_advisor_feedback_select" on buddy_advisor_feedback;
drop policy if exists "buddy_advisor_feedback_insert" on buddy_advisor_feedback;
drop policy if exists "buddy_advisor_feedback_update" on buddy_advisor_feedback;
drop policy if exists "buddy_advisor_feedback_delete" on buddy_advisor_feedback;

create policy "buddy_advisor_feedback_select"
  on buddy_advisor_feedback
  for select
  using (bank_id = public.get_current_bank_id());

create policy "buddy_advisor_feedback_insert"
  on buddy_advisor_feedback
  for insert
  with check (bank_id = public.get_current_bank_id());

create policy "buddy_advisor_feedback_update"
  on buddy_advisor_feedback
  for update
  using (bank_id = public.get_current_bank_id())
  with check (bank_id = public.get_current_bank_id());

create policy "buddy_advisor_feedback_delete"
  on buddy_advisor_feedback
  for delete
  using (bank_id = public.get_current_bank_id());

-- ─── 3) RLS for buddy_blocker_observations ────────────────────────

alter table buddy_blocker_observations enable row level security;

drop policy if exists "buddy_blocker_observations_select" on buddy_blocker_observations;
drop policy if exists "buddy_blocker_observations_insert" on buddy_blocker_observations;
drop policy if exists "buddy_blocker_observations_update" on buddy_blocker_observations;
drop policy if exists "buddy_blocker_observations_delete" on buddy_blocker_observations;

create policy "buddy_blocker_observations_select"
  on buddy_blocker_observations
  for select
  using (bank_id = public.get_current_bank_id());

create policy "buddy_blocker_observations_insert"
  on buddy_blocker_observations
  for insert
  with check (bank_id = public.get_current_bank_id());

create policy "buddy_blocker_observations_update"
  on buddy_blocker_observations
  for update
  using (bank_id = public.get_current_bank_id())
  with check (bank_id = public.get_current_bank_id());

create policy "buddy_blocker_observations_delete"
  on buddy_blocker_observations
  for delete
  using (bank_id = public.get_current_bank_id());

comment on column buddy_advisor_feedback.dismiss_count is
  'SPEC-11: incremented on each dismiss. Auto-snoozes when >= 3.';
comment on column buddy_advisor_feedback.last_dismissed_at is
  'SPEC-11: timestamp of the most recent dismissal.';
