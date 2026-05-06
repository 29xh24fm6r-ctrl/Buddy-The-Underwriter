-- Memo Input Completeness Layer
--
-- Adds the structural surface required to prove a credit memo is complete
-- BEFORE banker submission: borrower story, management profiles, normalized
-- collateral items (with valuation evidence), fact conflicts (status
-- expansion), and a per-deal readiness ledger.
--
-- Invariant: no banker_submitted memo unless:
--   1. required borrower story exists
--   2. required financial facts exist
--   3. required collateral facts exist
--   4. required management facts exist
--   5. required research exists
--   6. conflicting facts are resolved or acknowledged
--
-- Additive only. Existing rows in deal_collateral_items / deal_fact_conflicts
-- continue to work; new columns are nullable / defaulted.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. deal_borrower_story
-- One row per deal. Banker-certified narrative that anchors the memo.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.deal_borrower_story (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references public.deals(id) on delete cascade,
  bank_id uuid not null,

  business_description     text,
  revenue_model            text,
  products_services        text,
  customers                text,
  customer_concentration   text,
  competitive_position     text,
  growth_strategy          text,
  seasonality              text,
  key_risks                text,
  banker_notes             text,

  source     text not null default 'banker'
    check (source in ('banker', 'borrower', 'buddy', 'research')),
  confidence numeric,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (deal_id)
);

alter table public.deal_borrower_story enable row level security;

drop policy if exists bank_scoped_borrower_story on public.deal_borrower_story;
create policy bank_scoped_borrower_story
  on public.deal_borrower_story
  using (
    deal_id in (
      select id from public.deals
      where bank_id = (
        select bank_id from public.bank_users
        where user_id = auth.uid()
        limit 1
      )
    )
  );

create index if not exists idx_deal_borrower_story_deal
  on public.deal_borrower_story (deal_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. deal_management_profiles
-- N rows per deal. One per principal/officer relevant to credit.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.deal_management_profiles (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references public.deals(id) on delete cascade,
  bank_id uuid not null,

  person_name              text not null,
  title                    text,
  ownership_pct            numeric,
  years_experience         numeric,
  industry_experience      text,
  prior_business_experience text,
  resume_summary           text,
  credit_relevance         text,

  source     text not null default 'banker'
    check (source in ('banker', 'borrower', 'buddy', 'resume', 'sba_form', 'pfs')),
  confidence numeric,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.deal_management_profiles enable row level security;

drop policy if exists bank_scoped_management_profiles on public.deal_management_profiles;
create policy bank_scoped_management_profiles
  on public.deal_management_profiles
  using (
    deal_id in (
      select id from public.deals
      where bank_id = (
        select bank_id from public.bank_users
        where user_id = auth.uid()
        limit 1
      )
    )
  );

create index if not exists idx_deal_management_profiles_deal
  on public.deal_management_profiles (deal_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. deal_collateral_items — augment existing table with normalization columns
-- The pre-existing builder schema covers (item_type, description, estimated_value,
-- lien_position, appraisal_date, address). The memo input layer needs
-- valuation evidence, advance_rate, owner attribution, source document, and a
-- review flag. All additions are nullable so legacy rows backfill cleanly.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.deal_collateral_items
  add column if not exists bank_id            uuid,
  add column if not exists collateral_type    text,
  add column if not exists owner_name         text,
  add column if not exists market_value       numeric,
  add column if not exists appraised_value    numeric,
  add column if not exists discounted_value   numeric,
  add column if not exists advance_rate       numeric,
  add column if not exists valuation_date     date,
  add column if not exists valuation_source   text,
  add column if not exists source_document_id uuid references public.deal_documents(id),
  add column if not exists confidence         numeric,
  add column if not exists requires_review    boolean not null default false;

create index if not exists idx_deal_collateral_items_bank
  on public.deal_collateral_items (deal_id, bank_id);

create index if not exists idx_deal_collateral_items_review
  on public.deal_collateral_items (deal_id) where requires_review = true;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. deal_fact_conflicts — augment existing table for memo input gating
-- Existing schema:
--   (id, deal_id, bank_id, fact_type, fact_key, conflicting_values jsonb[],
--    conflicting_fact_ids uuid[], owner_entity_id, status('open'/'resolved'),
--    resolved_fact_id, resolved_by(text), resolved_at, created_at, updated_at)
-- We add: conflict_type, source_a, source_b, resolution, resolved_value
-- and expand status to (open, acknowledged, resolved, ignored).
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.deal_fact_conflicts
  add column if not exists conflict_type   text,
  add column if not exists source_a        jsonb,
  add column if not exists source_b        jsonb,
  add column if not exists resolution      text,
  add column if not exists resolved_value  jsonb;

-- Expand status check to allow 'acknowledged' and 'ignored'.
alter table public.deal_fact_conflicts
  drop constraint if exists deal_fact_conflicts_status_check;

alter table public.deal_fact_conflicts
  add constraint deal_fact_conflicts_status_check
  check (status in ('open', 'acknowledged', 'resolved', 'ignored'));

-- A "blocking" conflict is one that gates submission.
-- Status 'acknowledged', 'resolved', and 'ignored' do not block.
create index if not exists idx_deal_fact_conflicts_open
  on public.deal_fact_conflicts (deal_id, bank_id) where status = 'open';

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. deal_memo_input_readiness — per-deal readiness ledger
-- One row per deal. Mirrors evaluateMemoInputReadiness() output. Cached for
-- the Memo Inputs UI; recomputed on every evaluator invocation.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.deal_memo_input_readiness (
  deal_id uuid primary key references public.deals(id) on delete cascade,
  bank_id uuid not null,

  borrower_story_complete boolean not null default false,
  management_complete     boolean not null default false,
  collateral_complete     boolean not null default false,
  financials_complete     boolean not null default false,
  research_complete       boolean not null default false,
  conflicts_resolved      boolean not null default false,

  readiness_score numeric not null default 0
    check (readiness_score >= 0 and readiness_score <= 100),
  blockers jsonb not null default '[]'::jsonb,
  warnings jsonb not null default '[]'::jsonb,

  evaluated_at timestamptz not null default now()
);

alter table public.deal_memo_input_readiness enable row level security;

drop policy if exists bank_scoped_memo_input_readiness on public.deal_memo_input_readiness;
create policy bank_scoped_memo_input_readiness
  on public.deal_memo_input_readiness
  using (
    deal_id in (
      select id from public.deals
      where bank_id = (
        select bank_id from public.bank_users
        where user_id = auth.uid()
        limit 1
      )
    )
  );

create index if not exists idx_deal_memo_input_readiness_bank
  on public.deal_memo_input_readiness (bank_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Comments — establish authority boundaries for the memo input layer.
-- ─────────────────────────────────────────────────────────────────────────────

comment on table public.deal_borrower_story is
  'Banker-certified borrower narrative. Memo Input Completeness Layer. A non-empty business_description is required for memo submission.';
comment on table public.deal_management_profiles is
  'Banker-certified principal/officer profiles. At least one profile is required for memo submission.';
comment on table public.deal_memo_input_readiness is
  'Cached evaluator output for Memo Input Completeness Layer. Authoritative gate is evaluateMemoInputReadiness() at submission time.';
comment on column public.deal_fact_conflicts.status is
  'open | acknowledged | resolved | ignored. Only "open" blocks memo submission.';
