-- =========================================================
-- BUDDY MULTI-ENTITY FOUNDATION — Mega Sprint A/B/C
-- Step 1: Database Schema
-- 
-- Run in Supabase SQL Editor (Role: postgres)
-- Compatible with file-based OCR system + future DB migration
-- =========================================================

create extension if not exists pgcrypto;

-- =========================================================
-- 1) ENTITIES TABLE
-- Represents OpCos, PropCos, HoldCos, Persons, and Group
-- =========================================================

create table if not exists public.deal_entities (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null,
  user_id uuid not null,

  name text not null,
  entity_kind text not null default 'OPCO', 
  -- OPCO | PROPCO | HOLDCO | PERSON | GROUP
  
  legal_name text,
  ein text,
  ownership_percent numeric,
  notes text,

  -- Metadata
  meta jsonb default '{}'::jsonb, -- for future: detected_eins, detected_names, etc.

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Constraints
  constraint deal_entities_kind_check 
    check (entity_kind in ('OPCO', 'PROPCO', 'HOLDCO', 'PERSON', 'GROUP'))
);

create index if not exists deal_entities_deal_id_idx on public.deal_entities(deal_id);
create index if not exists deal_entities_user_id_idx on public.deal_entities(user_id);
create index if not exists deal_entities_ein_idx on public.deal_entities(ein);
create index if not exists deal_entities_kind_idx on public.deal_entities(entity_kind);

comment on table public.deal_entities is 'Business entities within a deal: OpCos, PropCos, HoldCos, Persons, or Group';
comment on column public.deal_entities.entity_kind is 'Type: OPCO|PROPCO|HOLDCO|PERSON|GROUP';
comment on column public.deal_entities.meta is 'JSON: detected_eins[], detected_names[], auto_assign hints';

-- =========================================================
-- 2) PACKS TABLE (if not exists)
-- Stores document packs (bulk uploads)
-- =========================================================

create table if not exists public.deal_packs (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null,
  user_id uuid not null,

  pack_id text not null, -- UUID from bulk upload
  name text,
  uploaded_at timestamptz not null default now(),
  
  -- NEW: Entity ownership
  entity_id uuid references public.deal_entities(id) on delete set null,

  meta jsonb default '{}'::jsonb,
  
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists deal_packs_pack_id_unique on public.deal_packs(pack_id);
create index if not exists deal_packs_deal_id_idx on public.deal_packs(deal_id);
create index if not exists deal_packs_entity_id_idx on public.deal_packs(entity_id);
create index if not exists deal_packs_user_id_idx on public.deal_packs(user_id);

comment on table public.deal_packs is 'Document packs from bulk uploads';
comment on column public.deal_packs.entity_id is 'Which entity owns this pack (nullable)';

-- =========================================================
-- 3) PACK ITEMS TABLE (if not exists)
-- Individual documents within a pack
-- =========================================================

create table if not exists public.deal_pack_items (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null,
  user_id uuid not null,
  pack_id uuid references public.deal_packs(id) on delete cascade,

  -- File references (matches your current job system)
  job_id text not null, -- UUID from OCR job
  stored_name text not null,
  original_name text,

  -- OCR + Classification results
  status text not null default 'pending', -- pending|processing|complete|failed
  ocr_result jsonb, -- Full OCR response from Azure
  classification jsonb, -- Doc type classification
  
  -- NEW: Entity assignment
  entity_id uuid references public.deal_entities(id) on delete set null,
  
  -- Auto-suggestion hints
  suggested_entity_id uuid references public.deal_entities(id) on delete set null,
  suggestion_confidence numeric,
  suggestion_reasons text[],

  meta jsonb default '{}'::jsonb, -- detected_eins, detected_names for matching

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint deal_pack_items_status_check 
    check (status in ('pending', 'processing', 'complete', 'failed'))
);

create unique index if not exists deal_pack_items_job_id_unique on public.deal_pack_items(job_id);
create index if not exists deal_pack_items_deal_id_idx on public.deal_pack_items(deal_id);
create index if not exists deal_pack_items_pack_id_idx on public.deal_pack_items(pack_id);
create index if not exists deal_pack_items_entity_id_idx on public.deal_pack_items(entity_id);
create index if not exists deal_pack_items_user_id_idx on public.deal_pack_items(user_id);
create index if not exists deal_pack_items_status_idx on public.deal_pack_items(status);

comment on table public.deal_pack_items is 'Individual documents in packs with OCR results and entity assignment';
comment on column public.deal_pack_items.entity_id is 'Assigned entity (user-confirmed)';
comment on column public.deal_pack_items.suggested_entity_id is 'Auto-suggested entity (before user confirms)';
comment on column public.deal_pack_items.meta is 'JSON: detected_eins[], detected_names[] for entity matching';

-- =========================================================
-- 4) ENTITY FINANCIAL PERIODS
-- Normalized financial statements per entity per period
-- =========================================================

create table if not exists public.entity_financial_periods (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null,
  user_id uuid not null,
  entity_id uuid not null references public.deal_entities(id) on delete cascade,

  -- Source tracking
  source text not null default 'OCR', -- OCR | MANUAL | IMPORT
  source_item_ids uuid[], -- Links to deal_pack_items that contributed
  
  -- Period definition
  period_type text not null default 'ANNUAL', -- ANNUAL | INTERIM | TTM
  fiscal_year integer,
  fiscal_year_end text, -- MM-DD format (e.g., "12-31")
  period_start date,
  period_end date,

  -- Statement data
  currency text not null default 'USD',
  statement jsonb not null default '{}'::jsonb, 
  -- { pnl: {...}, balanceSheet: {...}, cashFlow: {...} }
  
  -- Metadata
  completeness_score numeric, -- 0-100
  warnings text[],
  meta jsonb default '{}'::jsonb,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint entity_financial_periods_period_type_check 
    check (period_type in ('ANNUAL', 'INTERIM', 'TTM')),
  constraint entity_financial_periods_source_check 
    check (source in ('OCR', 'MANUAL', 'IMPORT'))
);

create index if not exists entity_financial_periods_entity_idx on public.entity_financial_periods(entity_id);
create index if not exists entity_financial_periods_deal_idx on public.entity_financial_periods(deal_id);
create index if not exists entity_financial_periods_year_idx on public.entity_financial_periods(fiscal_year);
create index if not exists entity_financial_periods_period_idx on public.entity_financial_periods(period_type, fiscal_year);

comment on table public.entity_financial_periods is 'Normalized financial statements for each entity by period';
comment on column public.entity_financial_periods.statement is 'Normalized JSON: {pnl, balanceSheet, cashFlow}';
comment on column public.entity_financial_periods.source_item_ids is 'Pack item IDs that generated this statement';

-- =========================================================
-- 5) COMBINED SPREADS
-- Aggregated multi-entity financials
-- =========================================================

create table if not exists public.deal_combined_spreads (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null,
  user_id uuid not null,

  -- Scope
  scope text not null default 'GROUP', -- GROUP | SELECTED | CUSTOM
  entity_ids uuid[] not null default '{}'::uuid[],
  
  -- Period
  period_type text not null default 'ANNUAL',
  fiscal_year integer,
  period_end date,

  -- Combined statement
  currency text not null default 'USD',
  combined_statement jsonb not null default '{}'::jsonb,
  
  -- Flags and warnings
  flags jsonb not null default '{}'::jsonb, 
  -- { intercompany_present: bool, missing_entities: [], mismatched_periods: [] }
  
  warnings text[],
  
  -- Metadata
  source_period_ids uuid[], -- References to entity_financial_periods used
  meta jsonb default '{}'::jsonb,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint deal_combined_spreads_scope_check 
    check (scope in ('GROUP', 'SELECTED', 'CUSTOM')),
  constraint deal_combined_spreads_period_type_check 
    check (period_type in ('ANNUAL', 'INTERIM', 'TTM'))
);

create index if not exists deal_combined_spreads_deal_idx on public.deal_combined_spreads(deal_id);
create index if not exists deal_combined_spreads_year_idx on public.deal_combined_spreads(fiscal_year);
create index if not exists deal_combined_spreads_scope_idx on public.deal_combined_spreads(scope);

comment on table public.deal_combined_spreads is 'Aggregated financials across multiple entities';
comment on column public.deal_combined_spreads.flags is 'JSON: intercompany detection, missing data warnings';

-- =========================================================
-- 6) UPDATED_AT TRIGGERS
-- =========================================================

do $$
begin
  if not exists (select 1 from pg_proc where proname = 'set_updated_at') then
    create or replace function public.set_updated_at()
    returns trigger language plpgsql as $fn$
    begin
      new.updated_at = now();
      return new;
    end;
    $fn$;
  end if;
end$$;

drop trigger if exists trg_deal_entities_updated_at on public.deal_entities;
create trigger trg_deal_entities_updated_at
before update on public.deal_entities
for each row execute function public.set_updated_at();

drop trigger if exists trg_deal_packs_updated_at on public.deal_packs;
create trigger trg_deal_packs_updated_at
before update on public.deal_packs
for each row execute function public.set_updated_at();

drop trigger if exists trg_deal_pack_items_updated_at on public.deal_pack_items;
create trigger trg_deal_pack_items_updated_at
before update on public.deal_pack_items
for each row execute function public.set_updated_at();

drop trigger if exists trg_entity_financial_periods_updated_at on public.entity_financial_periods;
create trigger trg_entity_financial_periods_updated_at
before update on public.entity_financial_periods
for each row execute function public.set_updated_at();

drop trigger if exists trg_deal_combined_spreads_updated_at on public.deal_combined_spreads;
create trigger trg_deal_combined_spreads_updated_at
before update on public.deal_combined_spreads
for each row execute function public.set_updated_at();

-- =========================================================
-- 7) ROW LEVEL SECURITY
-- Users can only access their own data
-- =========================================================

alter table public.deal_entities enable row level security;
alter table public.deal_packs enable row level security;
alter table public.deal_pack_items enable row level security;
alter table public.entity_financial_periods enable row level security;
alter table public.deal_combined_spreads enable row level security;

-- Deal Entities
drop policy if exists deal_entities_select_own on public.deal_entities;
create policy deal_entities_select_own on public.deal_entities
for select using (user_id = auth.uid());

drop policy if exists deal_entities_insert_own on public.deal_entities;
create policy deal_entities_insert_own on public.deal_entities
for insert with check (user_id = auth.uid());

drop policy if exists deal_entities_update_own on public.deal_entities;
create policy deal_entities_update_own on public.deal_entities
for update using (user_id = auth.uid());

drop policy if exists deal_entities_delete_own on public.deal_entities;
create policy deal_entities_delete_own on public.deal_entities
for delete using (user_id = auth.uid());

-- Deal Packs
drop policy if exists deal_packs_select_own on public.deal_packs;
create policy deal_packs_select_own on public.deal_packs
for select using (user_id = auth.uid());

drop policy if exists deal_packs_insert_own on public.deal_packs;
create policy deal_packs_insert_own on public.deal_packs
for insert with check (user_id = auth.uid());

drop policy if exists deal_packs_update_own on public.deal_packs;
create policy deal_packs_update_own on public.deal_packs
for update using (user_id = auth.uid());

-- Deal Pack Items
drop policy if exists deal_pack_items_select_own on public.deal_pack_items;
create policy deal_pack_items_select_own on public.deal_pack_items
for select using (user_id = auth.uid());

drop policy if exists deal_pack_items_insert_own on public.deal_pack_items;
create policy deal_pack_items_insert_own on public.deal_pack_items
for insert with check (user_id = auth.uid());

drop policy if exists deal_pack_items_update_own on public.deal_pack_items;
create policy deal_pack_items_update_own on public.deal_pack_items
for update using (user_id = auth.uid());

-- Entity Financial Periods
drop policy if exists entity_financial_periods_select_own on public.entity_financial_periods;
create policy entity_financial_periods_select_own on public.entity_financial_periods
for select using (user_id = auth.uid());

drop policy if exists entity_financial_periods_insert_own on public.entity_financial_periods;
create policy entity_financial_periods_insert_own on public.entity_financial_periods
for insert with check (user_id = auth.uid());

drop policy if exists entity_financial_periods_update_own on public.entity_financial_periods;
create policy entity_financial_periods_update_own on public.entity_financial_periods
for update using (user_id = auth.uid());

-- Combined Spreads
drop policy if exists deal_combined_spreads_select_own on public.deal_combined_spreads;
create policy deal_combined_spreads_select_own on public.deal_combined_spreads
for select using (user_id = auth.uid());

drop policy if exists deal_combined_spreads_insert_own on public.deal_combined_spreads;
create policy deal_combined_spreads_insert_own on public.deal_combined_spreads
for insert with check (user_id = auth.uid());

drop policy if exists deal_combined_spreads_update_own on public.deal_combined_spreads;
create policy deal_combined_spreads_update_own on public.deal_combined_spreads
for update using (user_id = auth.uid());

-- =========================================================
-- 8) HELPER FUNCTION: Ensure GROUP entity exists
-- =========================================================

create or replace function public.ensure_group_entity(p_deal_id uuid, p_user_id uuid)
returns uuid
language plpgsql
as $$
declare
  v_group_id uuid;
begin
  -- Check if GROUP entity already exists for this deal
  select id into v_group_id
  from public.deal_entities
  where deal_id = p_deal_id 
    and entity_kind = 'GROUP'
    and user_id = p_user_id
  limit 1;

  -- If not found, create it
  if v_group_id is null then
    insert into public.deal_entities (
      deal_id, 
      user_id, 
      name, 
      entity_kind,
      legal_name,
      notes
    ) values (
      p_deal_id,
      p_user_id,
      'Group (Combined)',
      'GROUP',
      'Combined Group Entity',
      'Auto-created group entity for combined view'
    )
    returning id into v_group_id;
  end if;

  return v_group_id;
end;
$$;

comment on function public.ensure_group_entity is 'Creates GROUP entity for deal if it does not exist';

-- =========================================================
-- MIGRATION COMPLETE
-- =========================================================
-- 
-- Next steps:
-- 1. Run this migration in Supabase SQL Editor
-- 2. Install API routes from Step 2
-- 3. Update UI components from Step 3
--
-- =========================================================
