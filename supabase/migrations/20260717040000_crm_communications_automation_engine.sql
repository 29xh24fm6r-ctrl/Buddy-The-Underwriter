-- SPEC-BROKERAGE-OPERATING-SYSTEM-V1 PR4 — Communications, Automation, and
-- Engagement Engine.
--
-- Discovery found real, configured send infrastructure already exists
-- (Resend for email via src/lib/email/getProvider.ts, Twilio for SMS via
-- src/lib/sms/send.ts — both honestly fall back to a stub/throw when
-- unconfigured, never simulate a real send) plus a *separate*, more
-- dormant provider-interface stack (src/lib/brokerage/commsAdapters.ts,
-- Telnyx-based, gated by BROKERAGE_COMMS_MODE). This PR wires CRM sends to
-- the first (already-proven, already-honest) stack rather than the second,
-- to avoid adding a third parallel comms implementation on top of the 6+
-- outbox tables discovery already found. No phone/voice/click-to-call
-- infrastructure exists at all — this migration adds no telephony tables;
-- PR4's "phone" support is manual outcome logging only, per the spec's own
-- "build a provider-neutral interface and complete the manual operational
-- workflow" instruction for when no provider is provisioned.
--
-- crm_activities' existing exactly-one-target CHECK (deal/org/person/lead)
-- is left as-is rather than widened to allow multiple simultaneous
-- targets — no precedent for a many-to-many target shape exists anywhere
-- in this codebase (deal_party_roles, brokerage_tasks are all exactly-one
-- too), and loosening it would break every existing single-target reader.
-- Multi-participant activities (a call involving a deal AND several
-- people) are modeled instead via a new junction table,
-- crm_activity_participants, alongside the existing single primary target.

-- ── 1. crm_activities: structured comms fields ──────────────────────────
-- `kind` keeps its existing 7 values for backward compatibility (every
-- existing reader filters on it) plus 'sms' (net-new channel, additive
-- widen — same "widen, don't fork" precedent as PR1/PR2). The new
-- `channel` column is populated going forward for every kind, and
-- backfilled here for existing call/email/meeting rows so both old and
-- new readers see consistent data — this *is* "preserve legacy activity
-- references" (§6.1), not a replacement of the kind column's meaning.

alter table public.crm_activities drop constraint if exists crm_activities_kind_check;
alter table public.crm_activities add constraint crm_activities_kind_check
  check (kind in ('note', 'task', 'call', 'email', 'sms', 'meeting', 'stage_change', 'system'));

alter table public.crm_activities
  add column if not exists direction text check (direction is null or direction in ('inbound', 'outbound')),
  add column if not exists channel text check (channel is null or channel in ('email', 'sms', 'call', 'meeting', 'portal', 'system')),
  add column if not exists outcome text,
  add column if not exists duration_seconds integer,
  add column if not exists follow_up_required boolean not null default false,
  add column if not exists follow_up_due_at timestamptz,
  add column if not exists external_message_id text,
  add column if not exists provider text,
  add column if not exists delivery_state text check (delivery_state is null or delivery_state in ('queued', 'sent', 'delivered', 'failed', 'bounced', 'stub')),
  add column if not exists source text not null default 'manual' check (source in ('manual', 'automated'));

update public.crm_activities set channel = kind where channel is null and kind in ('call', 'email', 'meeting');
update public.crm_activities set channel = 'sms' where channel is null and kind = 'sms';

create index if not exists idx_crm_activities_follow_up_due on public.crm_activities(bank_id, follow_up_due_at)
  where follow_up_required = true and follow_up_due_at is not null;
create index if not exists idx_crm_activities_external_message_id on public.crm_activities(external_message_id)
  where external_message_id is not null;

-- ── 2. Multi-participant support (junction table, not a widened target) ─

create table if not exists public.crm_activity_participants (
  id uuid primary key default gen_random_uuid(),
  bank_id uuid not null references public.banks(id) on delete cascade,
  activity_id uuid not null references public.crm_activities(id) on delete cascade,
  person_id uuid not null references public.crm_people(id) on delete cascade,
  role text,
  created_at timestamptz not null default now(),
  unique (activity_id, person_id)
);

alter table public.crm_activity_participants enable row level security;
create policy service_role_all on public.crm_activity_participants
  for all to service_role using (true) with check (true);

create index idx_crm_activity_participants_activity on public.crm_activity_participants(activity_id);
create index idx_crm_activity_participants_person on public.crm_activity_participants(person_id);
create index idx_crm_activity_participants_bank on public.crm_activity_participants(bank_id);

-- ── 3. Do-not-contact on leads ──────────────────────────────────────────
-- crm_people already has do_not_contact (PR1). brokerage_leads has none —
-- leads are pre-conversion and don't yet FK to crm_people, so this is its
-- own flag rather than trying to unify two entities that aren't linked.

alter table public.brokerage_leads
  add column if not exists do_not_contact boolean not null default false;

-- ── 4. CRM message templates ─────────────────────────────────────────────
-- Distinct catalog from brokerage_borrower_message_templates (BRK-10O) —
-- that table's 10 trigger keys are borrower-lifecycle events (uploads
-- needed, package sealed, funded...), not the CRM-facing lead/referral
-- templates §6.2 asks for (initial lead response, discovery scheduling,
-- lender introduction...). Different vocabulary, different audience — a
-- second table here is a genuinely different catalog, not a duplicate.

create table if not exists public.crm_message_templates (
  id uuid primary key default gen_random_uuid(),
  bank_id uuid not null references public.banks(id) on delete cascade,
  trigger_key text not null,
  channel text not null check (channel in ('email', 'sms')),
  subject text,
  body text not null,
  active boolean not null default true,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (bank_id, trigger_key, channel)
);

alter table public.crm_message_templates enable row level security;
create policy service_role_all on public.crm_message_templates
  for all to service_role using (true) with check (true);

create index idx_crm_message_templates_bank on public.crm_message_templates(bank_id);

-- ── 5. Automation execution audit (idempotency) ─────────────────────────
-- Same execution_status vocabulary as canonical_action_executions.
-- dedupe_key lets a trigger fire more than once over an entity's lifetime
-- (e.g. task_overdue re-fires per distinct task) while still preventing a
-- double-fire for the same underlying event.

create table if not exists public.crm_automation_executions (
  id uuid primary key default gen_random_uuid(),
  bank_id uuid not null references public.banks(id) on delete cascade,
  trigger_key text not null,
  entity_type text not null check (entity_type in ('lead', 'deal', 'task', 'person', 'organization')),
  entity_id uuid not null,
  action_key text not null,
  dedupe_key text not null,
  execution_status text not null check (execution_status in ('created', 'queued', 'already_exists', 'noop', 'failed')),
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (trigger_key, entity_type, entity_id, action_key, dedupe_key)
);

alter table public.crm_automation_executions enable row level security;
create policy service_role_all on public.crm_automation_executions
  for all to service_role using (true) with check (true);

create index idx_crm_automation_executions_bank on public.crm_automation_executions(bank_id);
create index idx_crm_automation_executions_entity on public.crm_automation_executions(entity_type, entity_id);

-- ── 6. Sequence enrollments ──────────────────────────────────────────────
-- Sequence *definitions* are a static, deterministic, in-code catalog
-- (src/lib/sequences/catalog.ts) — same pattern as PR3's STAGE_TASK_PLANS
-- — not a DB-driven rule-authoring system. Only enrollment state (which
-- entity is on which sequence, at which step) needs persistence.

create table if not exists public.crm_sequence_enrollments (
  id uuid primary key default gen_random_uuid(),
  bank_id uuid not null references public.banks(id) on delete cascade,
  sequence_key text not null,
  entity_type text not null check (entity_type in ('lead', 'deal', 'organization')),
  entity_id uuid not null,
  status text not null default 'active' check (status in ('active', 'stopped', 'completed')),
  current_step integer not null default 0,
  stop_reason text,
  enrolled_by_clerk_user_id text,
  enrolled_at timestamptz not null default now(),
  next_step_due_at timestamptz,
  stopped_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.crm_sequence_enrollments enable row level security;
create policy service_role_all on public.crm_sequence_enrollments
  for all to service_role using (true) with check (true);

create index idx_crm_sequence_enrollments_bank on public.crm_sequence_enrollments(bank_id);
create index idx_crm_sequence_enrollments_due on public.crm_sequence_enrollments(next_step_due_at)
  where status = 'active' and next_step_due_at is not null;
-- At most one *active* enrollment per (sequence, entity) — re-enrolling
-- after a stop/complete is fine, concurrent double-enrollment isn't.
create unique index idx_crm_sequence_enrollments_one_active
  on public.crm_sequence_enrollments(sequence_key, entity_type, entity_id)
  where status = 'active';
