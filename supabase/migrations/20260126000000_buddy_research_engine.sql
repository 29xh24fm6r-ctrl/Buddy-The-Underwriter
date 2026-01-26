-- ============================================================================
-- Buddy Research Engine (BRE) - Phase 1: Industry + Competitive Landscape
-- ============================================================================
-- This migration creates the foundation for auditable, citation-backed research.
-- Every fact must trace to a source. Every inference must trace to facts.
-- No hallucinations. No uncited claims. Bank-grade auditability.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Research Missions (Intent + Scope)
-- ----------------------------------------------------------------------------
-- A mission represents a specific research task for a deal.
-- Each mission produces sources → facts → inferences → narrative.

create table if not exists buddy_research_missions (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references deals(id) on delete cascade,
  bank_id uuid references banks(id),

  -- Mission definition
  mission_type text not null check (
    mission_type in (
      'industry_landscape',
      'competitive_analysis',
      'market_demand',
      'demographics',
      'regulatory_environment',
      'management_backgrounds'
    )
  ),
  subject jsonb not null default '{}',
  -- subject schema: { naics_code?, sic_code?, geography?, company_name?, keywords? }

  depth text not null default 'overview' check (depth in ('overview', 'committee', 'deep_dive')),

  -- Execution state
  status text not null default 'queued' check (
    status in ('queued', 'running', 'complete', 'failed', 'cancelled')
  ),
  error_message text,

  -- Stats (updated as mission progresses)
  sources_count int not null default 0,
  facts_count int not null default 0,
  inferences_count int not null default 0,

  -- Audit
  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  created_by uuid references auth.users(id),
  correlation_id text
);

-- Index for deal lookups
create index if not exists idx_research_missions_deal_id
  on buddy_research_missions(deal_id, created_at desc);

-- Index for status monitoring
create index if not exists idx_research_missions_status
  on buddy_research_missions(status, created_at desc);

-- ----------------------------------------------------------------------------
-- 2. Research Sources (Raw, Immutable Evidence)
-- ----------------------------------------------------------------------------
-- Every piece of data Buddy uses must be stored here first.
-- raw_content is NEVER mutated. checksum proves integrity.

create table if not exists buddy_research_sources (
  id uuid primary key default gen_random_uuid(),
  mission_id uuid not null references buddy_research_missions(id) on delete cascade,

  -- Source identification
  source_class text not null check (
    source_class in (
      'government',    -- Census, BLS, BEA
      'regulatory',    -- SEC EDGAR, SBA SOP
      'industry',      -- Trade associations
      'company',       -- Official websites
      'geography',     -- Census ACS
      'news'           -- Reuters, AP (contextual)
    )
  ),
  source_name text not null,        -- e.g., "Census NAICS Industry Statistics"
  source_url text not null,         -- Full URL fetched

  -- Raw data (immutable)
  raw_content jsonb not null,       -- Never mutate after insert
  content_type text,                -- e.g., "application/json"
  checksum text not null,           -- sha256(canonical JSON)

  -- Fetch metadata
  retrieved_at timestamptz not null default now(),
  http_status int,
  fetch_duration_ms int,

  -- Error handling
  fetch_error text
);

-- Index for mission lookups
create index if not exists idx_research_sources_mission_id
  on buddy_research_sources(mission_id, retrieved_at desc);

-- Index for deduplication (same URL in same mission)
create unique index if not exists idx_research_sources_mission_url
  on buddy_research_sources(mission_id, source_url);

-- ----------------------------------------------------------------------------
-- 3. Research Facts (Typed, Citable Atoms)
-- ----------------------------------------------------------------------------
-- Facts are atomic pieces of information extracted from sources.
-- Each fact links to exactly ONE source.

create table if not exists buddy_research_facts (
  id uuid primary key default gen_random_uuid(),
  mission_id uuid not null references buddy_research_missions(id) on delete cascade,
  source_id uuid not null references buddy_research_sources(id) on delete cascade,

  -- Fact definition
  fact_type text not null check (
    fact_type in (
      -- Industry facts
      'market_size',
      'market_growth_rate',
      'employment_count',
      'employment_growth',
      'average_wage',
      'establishment_count',

      -- Competitive facts
      'competitor_name',
      'competitor_ticker',
      'competitor_revenue',
      'competitor_employees',
      'market_share_estimate',

      -- Geographic facts
      'population',
      'median_income',
      'business_density',

      -- Regulatory facts
      'regulatory_body',
      'compliance_requirement',
      'recent_enforcement',

      -- General
      'other'
    )
  ),

  -- Fact value (structured)
  value jsonb not null,
  -- value schema varies by fact_type:
  --   market_size: { amount: number, currency: "USD", year: number, scope: "US" }
  --   competitor_name: { name: string, cik?: string, ticker?: string }
  --   employment_count: { count: number, year: number, geography: string }

  -- Extraction metadata
  confidence numeric not null check (confidence between 0 and 1),
  extracted_by text not null check (extracted_by in ('rule', 'model')),
  extraction_path text,  -- JSONPath or selector used to extract

  -- Timestamps
  extracted_at timestamptz not null default now(),
  as_of_date date  -- When the fact was true (e.g., "2023" for 2023 data)
);

-- Index for mission fact lookups
create index if not exists idx_research_facts_mission_id
  on buddy_research_facts(mission_id, fact_type);

-- Index for source fact lookups
create index if not exists idx_research_facts_source_id
  on buddy_research_facts(source_id);

-- ----------------------------------------------------------------------------
-- 4. Research Inferences (Explicit Reasoning)
-- ----------------------------------------------------------------------------
-- Inferences are conclusions derived from one or more facts.
-- input_fact_ids MUST be non-empty (enforced in application layer).

create table if not exists buddy_research_inferences (
  id uuid primary key default gen_random_uuid(),
  mission_id uuid not null references buddy_research_missions(id) on delete cascade,

  -- Inference definition
  inference_type text not null check (
    inference_type in (
      'competitive_intensity',
      'market_attractiveness',
      'growth_trajectory',
      'cyclicality_risk',
      'barrier_to_entry',
      'regulatory_burden',
      'geographic_concentration',
      'tailwind',
      'headwind',
      'other'
    )
  ),

  -- The conclusion
  conclusion text not null,
  -- e.g., "High competitive intensity based on 47 public competitors and declining margins"

  -- Supporting facts (MUST be non-empty)
  input_fact_ids uuid[] not null,
  -- Application layer enforces: array_length(input_fact_ids, 1) > 0

  -- Confidence and reasoning
  confidence numeric not null check (confidence between 0 and 1),
  reasoning text,  -- Optional: explain the inference logic

  -- Timestamps
  created_at timestamptz not null default now()
);

-- Index for mission inference lookups
create index if not exists idx_research_inferences_mission_id
  on buddy_research_inferences(mission_id, inference_type);

-- ----------------------------------------------------------------------------
-- 5. Research Narratives (Compiled Output)
-- ----------------------------------------------------------------------------
-- Optional: store the compiled narrative for caching/audit.
-- Every sentence must have citations (enforced in application layer).

create table if not exists buddy_research_narratives (
  id uuid primary key default gen_random_uuid(),
  mission_id uuid not null references buddy_research_missions(id) on delete cascade,

  -- Narrative content (structured)
  sections jsonb not null,
  -- sections schema:
  -- [
  --   {
  --     title: string,
  --     sentences: [
  --       {
  --         text: string,
  --         citations: [{ type: "fact" | "inference", id: uuid }]
  --       }
  --     ]
  --   }
  -- ]

  -- Metadata
  version int not null default 1,
  compiled_at timestamptz not null default now(),

  -- Unique constraint: one narrative per mission (latest wins)
  unique(mission_id)
);

-- ----------------------------------------------------------------------------
-- 6. Helper Functions
-- ----------------------------------------------------------------------------

-- Function to update mission stats after source/fact/inference inserts
create or replace function update_research_mission_stats()
returns trigger as $$
begin
  if TG_TABLE_NAME = 'buddy_research_sources' then
    update buddy_research_missions
    set sources_count = (
      select count(*) from buddy_research_sources where mission_id = NEW.mission_id
    )
    where id = NEW.mission_id;
  elsif TG_TABLE_NAME = 'buddy_research_facts' then
    update buddy_research_missions
    set facts_count = (
      select count(*) from buddy_research_facts where mission_id = NEW.mission_id
    )
    where id = NEW.mission_id;
  elsif TG_TABLE_NAME = 'buddy_research_inferences' then
    update buddy_research_missions
    set inferences_count = (
      select count(*) from buddy_research_inferences where mission_id = NEW.mission_id
    )
    where id = NEW.mission_id;
  end if;
  return NEW;
end;
$$ language plpgsql;

-- Triggers to auto-update stats
drop trigger if exists trg_update_mission_sources_count on buddy_research_sources;
create trigger trg_update_mission_sources_count
  after insert on buddy_research_sources
  for each row execute function update_research_mission_stats();

drop trigger if exists trg_update_mission_facts_count on buddy_research_facts;
create trigger trg_update_mission_facts_count
  after insert on buddy_research_facts
  for each row execute function update_research_mission_stats();

drop trigger if exists trg_update_mission_inferences_count on buddy_research_inferences;
create trigger trg_update_mission_inferences_count
  after insert on buddy_research_inferences
  for each row execute function update_research_mission_stats();

-- ----------------------------------------------------------------------------
-- 7. RLS Policies (tenant isolation)
-- ----------------------------------------------------------------------------

alter table buddy_research_missions enable row level security;
alter table buddy_research_sources enable row level security;
alter table buddy_research_facts enable row level security;
alter table buddy_research_inferences enable row level security;
alter table buddy_research_narratives enable row level security;

-- Missions: users can read/write missions for their bank's deals
create policy "missions_bank_isolation" on buddy_research_missions
  for all using (
    bank_id = (select bank_id from auth.users where id = auth.uid())
    or bank_id is null
  );

-- Sources: access via mission
create policy "sources_via_mission" on buddy_research_sources
  for all using (
    exists (
      select 1 from buddy_research_missions m
      where m.id = mission_id
      and (m.bank_id = (select bank_id from auth.users where id = auth.uid()) or m.bank_id is null)
    )
  );

-- Facts: access via mission
create policy "facts_via_mission" on buddy_research_facts
  for all using (
    exists (
      select 1 from buddy_research_missions m
      where m.id = mission_id
      and (m.bank_id = (select bank_id from auth.users where id = auth.uid()) or m.bank_id is null)
    )
  );

-- Inferences: access via mission
create policy "inferences_via_mission" on buddy_research_inferences
  for all using (
    exists (
      select 1 from buddy_research_missions m
      where m.id = mission_id
      and (m.bank_id = (select bank_id from auth.users where id = auth.uid()) or m.bank_id is null)
    )
  );

-- Narratives: access via mission
create policy "narratives_via_mission" on buddy_research_narratives
  for all using (
    exists (
      select 1 from buddy_research_missions m
      where m.id = mission_id
      and (m.bank_id = (select bank_id from auth.users where id = auth.uid()) or m.bank_id is null)
    )
  );

-- Service role bypass for all tables
create policy "service_role_missions" on buddy_research_missions
  for all using (auth.role() = 'service_role');
create policy "service_role_sources" on buddy_research_sources
  for all using (auth.role() = 'service_role');
create policy "service_role_facts" on buddy_research_facts
  for all using (auth.role() = 'service_role');
create policy "service_role_inferences" on buddy_research_inferences
  for all using (auth.role() = 'service_role');
create policy "service_role_narratives" on buddy_research_narratives
  for all using (auth.role() = 'service_role');
