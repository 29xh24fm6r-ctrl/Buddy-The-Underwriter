-- ============================================================================
-- Buddy Autonomous Research Planner (ARP)
-- ============================================================================
-- This migration adds the planning layer above the Research Engine.
-- The planner decides WHAT research to run, WHY, and in WHAT ORDER.
-- All decisions are deterministic, auditable, and explainable.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Research Plans (Autonomous Decision Records)
-- ----------------------------------------------------------------------------
-- Each plan represents Buddy's decision about what research to run for a deal.
-- Plans are re-evaluated when documents change or missions complete.

create table if not exists buddy_research_plans (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references deals(id) on delete cascade,
  bank_id uuid references banks(id),

  -- Plan content (array of proposed missions)
  proposed_missions jsonb not null default '[]',
  -- proposed_missions schema:
  -- [
  --   {
  --     mission_type: string,
  --     subject: jsonb,
  --     priority: number (1=highest),
  --     rationale: string,
  --     confidence: number (0-1),
  --     supporting_fact_ids: uuid[],
  --     status: "pending" | "approved" | "rejected" | "completed"
  --   }
  -- ]

  -- Approval state
  approved boolean not null default true,  -- Auto-approve by default
  approved_by text not null default 'system' check (approved_by in ('system', 'banker')),
  approved_at timestamptz,
  approved_by_user_id uuid references auth.users(id),

  -- Trigger context (what caused this plan)
  trigger_event text not null check (
    trigger_event in (
      'document_uploaded',
      'checklist_updated',
      'stance_changed',
      'mission_completed',
      'manual_request',
      'initial_evaluation'
    )
  ),
  trigger_document_id uuid,  -- If triggered by document upload
  trigger_mission_id uuid references buddy_research_missions(id),  -- If triggered by mission completion

  -- Input snapshot (for auditability)
  input_facts_snapshot jsonb not null default '[]',  -- Facts used to derive this plan
  underwriting_stance text,  -- Stance at time of planning

  -- Versioning (plans can be superseded)
  version int not null default 1,
  superseded_by uuid references buddy_research_plans(id),
  is_current boolean not null default true,

  -- Timestamps
  created_at timestamptz not null default now(),
  executed_at timestamptz,  -- When missions started executing

  -- Correlation
  correlation_id text
);

-- Index for deal lookups (current plan)
create index if not exists idx_research_plans_deal_current
  on buddy_research_plans(deal_id, is_current, created_at desc)
  where is_current = true;

-- Index for trigger event analysis
create index if not exists idx_research_plans_trigger
  on buddy_research_plans(trigger_event, created_at desc);

-- ----------------------------------------------------------------------------
-- 2. Research Intent Log (Detailed Decision Audit Trail)
-- ----------------------------------------------------------------------------
-- Every individual decision Buddy makes gets logged here.
-- This enables full replay and explanation of reasoning.

create table if not exists buddy_research_intent_log (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references buddy_research_plans(id) on delete cascade,
  deal_id uuid not null references deals(id) on delete cascade,

  -- The intent
  intent_type text not null check (
    intent_type in (
      'mission_proposed',
      'mission_skipped',
      'mission_deferred',
      'gap_identified',
      'prerequisite_missing'
    )
  ),
  mission_type text,  -- Which mission type this relates to

  -- Reasoning
  rationale text not null,
  confidence numeric not null check (confidence between 0 and 1),

  -- Evidence
  supporting_fact_ids uuid[] not null default '{}',
  supporting_fact_types text[] not null default '{}',  -- For quick filtering

  -- Rule that triggered this
  rule_name text not null,  -- e.g., "naics_triggers_industry_research"
  rule_version int not null default 1,

  -- Timestamps
  created_at timestamptz not null default now()
);

-- Index for plan lookups
create index if not exists idx_intent_log_plan_id
  on buddy_research_intent_log(plan_id, created_at);

-- Index for deal-level audit
create index if not exists idx_intent_log_deal_id
  on buddy_research_intent_log(deal_id, created_at desc);

-- ----------------------------------------------------------------------------
-- 3. Regulated Industries Lookup (For Rule Engine)
-- ----------------------------------------------------------------------------
-- Static reference table for industries requiring regulatory research.

create table if not exists buddy_regulated_industries (
  naics_prefix text primary key,
  industry_name text not null,
  regulatory_bodies text[] not null default '{}',
  requires_state_licensing boolean not null default false,
  notes text
);

-- Seed with common regulated industries
insert into buddy_regulated_industries (naics_prefix, industry_name, regulatory_bodies, requires_state_licensing, notes)
values
  ('621', 'Ambulatory Health Care', '{"State Medical Boards", "CMS", "FDA"}', true, 'Healthcare providers'),
  ('622', 'Hospitals', '{"State Health Departments", "CMS", "Joint Commission"}', true, 'Acute care facilities'),
  ('623', 'Nursing and Residential Care', '{"State Health Departments", "CMS"}', true, 'Long-term care'),
  ('524', 'Insurance Carriers', '{"State Insurance Commissioners", "NAIC"}', true, 'Insurance operations'),
  ('522', 'Credit Intermediation', '{"FDIC", "OCC", "State Banking Regulators"}', true, 'Banking and lending'),
  ('531', 'Real Estate', '{"State Real Estate Commissions"}', true, 'Real estate brokerage'),
  ('722', 'Food Services', '{"FDA", "State Health Departments"}', true, 'Restaurants require health permits'),
  ('445', 'Food and Beverage Stores', '{"FDA", "State Agriculture Departments"}', false, 'Retail food'),
  ('312', 'Beverage Manufacturing', '{"TTB", "State ABC Boards"}', true, 'Alcohol production'),
  ('481', 'Air Transportation', '{"FAA", "TSA", "DOT"}', true, 'Airlines'),
  ('484', 'Truck Transportation', '{"FMCSA", "DOT"}', true, 'Commercial trucking'),
  ('485', 'Transit and Ground Passenger', '{"FTA", "State PUCs"}', true, 'Public transit'),
  ('611', 'Educational Services', '{"State Education Departments", "DOE"}', true, 'Schools and training'),
  ('711', 'Performing Arts and Spectator Sports', '{"State Athletic Commissions"}', false, 'Entertainment venues'),
  ('713', 'Amusement and Recreation', '{"State Gaming Commissions"}', true, 'Casinos, gaming')
on conflict (naics_prefix) do nothing;

-- ----------------------------------------------------------------------------
-- 4. RLS Policies
-- ----------------------------------------------------------------------------

alter table buddy_research_plans enable row level security;
alter table buddy_research_intent_log enable row level security;
alter table buddy_regulated_industries enable row level security;

-- Plans: access via deal's bank
create policy "plans_bank_isolation" on buddy_research_plans
  for all using (
    bank_id = (select bank_id from auth.users where id = auth.uid())
    or bank_id is null
  );

-- Intent log: access via plan
create policy "intent_log_via_plan" on buddy_research_intent_log
  for all using (
    exists (
      select 1 from buddy_research_plans p
      where p.id = plan_id
      and (p.bank_id = (select bank_id from auth.users where id = auth.uid()) or p.bank_id is null)
    )
  );

-- Regulated industries: public read
create policy "regulated_industries_public_read" on buddy_regulated_industries
  for select using (true);

-- Service role bypass
create policy "service_role_plans" on buddy_research_plans
  for all using (auth.role() = 'service_role');
create policy "service_role_intent_log" on buddy_research_intent_log
  for all using (auth.role() = 'service_role');
create policy "service_role_regulated" on buddy_regulated_industries
  for all using (auth.role() = 'service_role');

-- ----------------------------------------------------------------------------
-- 5. Helper Function: Get Current Plan for Deal
-- ----------------------------------------------------------------------------

create or replace function get_current_research_plan(p_deal_id uuid)
returns buddy_research_plans as $$
  select *
  from buddy_research_plans
  where deal_id = p_deal_id
    and is_current = true
  order by created_at desc
  limit 1;
$$ language sql stable;
