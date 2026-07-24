-- SPEC-BROKERAGE-OPERATING-SYSTEM-V1 PR3 — Deal Execution, Tasks, Stage
-- Gates, and Next Actions.
--
-- Discovery found no single authoritative deal-stage lifecycle: deals.stage
-- (never had a CHECK constraint), deal_status.stage (a separate borrower-
-- facing enum), the computed LifecycleStage in src/buddy/lifecycle/ (what
-- actually drives the cockpit/SLA/force-advance), a phantom
-- deals.lifecycle_stage column whose migration never applied to production,
-- and an unused DealStage type -- none of which model the brokerage-facing
-- pipeline this PR needs (Discovery, Qualification, Lender strategy, Term
-- sheet, etc.).
--
-- This migration adds that pipeline as a new, additive layer -- it does
-- NOT touch deals.stage, deal_status, or any buddy/lifecycle machinery.
-- Gate logic (built in the domain services, not this migration) READS
-- existing readiness signals (deal_underwrite_guard_states,
-- deal_checklist_items, brokerage_closing_conditions) as inputs; it never
-- writes to them. This avoids creating a sixth competing authority for a
-- fact (internal underwriting/document readiness) that's already modeled,
-- while adding the one fact (brokerage relationship/pipeline stage) that
-- isn't modeled anywhere yet.

-- ── 1. Brokerage stage columns on deals ─────────────────────────────────

alter table public.deals
  add column if not exists brokerage_stage text,
  add column if not exists brokerage_stage_entered_at timestamptz,
  add column if not exists brokerage_stage_owner_clerk_user_id text;

alter table public.deals drop constraint if exists deals_brokerage_stage_check;
alter table public.deals add constraint deals_brokerage_stage_check
  check (brokerage_stage is null or brokerage_stage in (
    'intake', 'discovery', 'qualification', 'engagement', 'application',
    'document_collection', 'financial_analysis', 'packaging', 'lender_strategy',
    'submitted', 'lender_review', 'term_sheet', 'underwriting', 'commitment',
    'closing', 'funded', 'post_close', 'on_hold', 'withdrawn', 'declined', 'lost'
  ));

create index if not exists idx_deals_brokerage_stage on public.deals(bank_id, brokerage_stage)
  where brokerage_stage is not null;
create index if not exists idx_deals_brokerage_stage_owner on public.deals(bank_id, brokerage_stage_owner_clerk_user_id)
  where brokerage_stage_owner_clerk_user_id is not null;

-- ── 2. Stage transition audit trail ─────────────────────────────────────

create table if not exists public.deal_brokerage_stage_transitions (
  id uuid primary key default gen_random_uuid(),
  bank_id uuid not null references public.banks(id) on delete cascade,
  deal_id uuid not null references public.deals(id) on delete cascade,
  from_stage text,
  to_stage text not null,
  reason text,
  is_override boolean not null default false,
  missing_requirements jsonb not null default '[]'::jsonb,
  actor_clerk_user_id text,
  created_at timestamptz not null default now()
);

alter table public.deal_brokerage_stage_transitions enable row level security;
create policy service_role_all on public.deal_brokerage_stage_transitions
  for all to service_role using (true) with check (true);

create index idx_deal_brokerage_stage_transitions_deal on public.deal_brokerage_stage_transitions(deal_id, created_at desc);
create index idx_deal_brokerage_stage_transitions_bank on public.deal_brokerage_stage_transitions(bank_id);

-- ── 3. Structured task system ───────────────────────────────────────────
-- Polymorphic target (deal/lead/organization/person), same "target pattern"
-- CHECK PR1 used for crm_activities/deal_party_roles.

create table if not exists public.brokerage_tasks (
  id uuid primary key default gen_random_uuid(),
  bank_id uuid not null references public.banks(id) on delete cascade,
  title text not null,
  description text,
  category text not null check (category in (
    'borrower_follow_up', 'referral_follow_up', 'document_request', 'financial_review',
    'eligibility_review', 'lender_research', 'submission', 'lender_follow_up',
    'underwriting_condition', 'third_party_report', 'commitment', 'closing',
    'post_closing', 'internal_review', 'other'
  )),
  deal_id uuid references public.deals(id) on delete cascade,
  lead_id uuid references public.brokerage_leads(id) on delete cascade,
  organization_id uuid references public.crm_organizations(id) on delete cascade,
  person_id uuid references public.crm_people(id) on delete cascade,
  assigned_to_clerk_user_id text,
  assigned_role text,
  priority text not null default 'medium' check (priority in ('low', 'medium', 'high', 'urgent')),
  status text not null default 'open' check (status in ('open', 'in_progress', 'blocked', 'completed', 'cancelled')),
  due_at timestamptz,
  reminder_at timestamptz,
  recurrence_rule text,
  depends_on_task_id uuid references public.brokerage_tasks(id) on delete set null,
  blocking boolean not null default false,
  automation_source text,
  completion_outcome text,
  completed_by_clerk_user_id text,
  completed_at timestamptz,
  escalation_state text not null default 'none' check (escalation_state in ('none', 'flagged', 'escalated')),
  created_by_clerk_user_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint brokerage_tasks_exactly_one_target check (
    (deal_id is not null)::int
    + (lead_id is not null)::int
    + (organization_id is not null)::int
    + (person_id is not null)::int = 1
  )
);

alter table public.brokerage_tasks enable row level security;
create policy service_role_all on public.brokerage_tasks
  for all to service_role using (true) with check (true);

create index idx_brokerage_tasks_bank_id on public.brokerage_tasks(bank_id);
create index idx_brokerage_tasks_deal on public.brokerage_tasks(deal_id) where deal_id is not null;
create index idx_brokerage_tasks_lead on public.brokerage_tasks(lead_id) where lead_id is not null;
create index idx_brokerage_tasks_organization on public.brokerage_tasks(organization_id) where organization_id is not null;
create index idx_brokerage_tasks_person on public.brokerage_tasks(person_id) where person_id is not null;
create index idx_brokerage_tasks_assignee on public.brokerage_tasks(bank_id, assigned_to_clerk_user_id)
  where assigned_to_clerk_user_id is not null;
create index idx_brokerage_tasks_due on public.brokerage_tasks(bank_id, due_at)
  where due_at is not null and status not in ('completed', 'cancelled');

-- Idempotent stage-generated task plans: at most one still-open task per
-- (deal, automation_source). Completing or cancelling a task frees its
-- automation_source for a future regeneration cycle.
create unique index idx_brokerage_tasks_automation_dedup
  on public.brokerage_tasks(deal_id, automation_source)
  where automation_source is not null and status not in ('completed', 'cancelled');
