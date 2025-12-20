-- 20251220_buddy_credit_discovery_ai_everywhere.sql
-- Buddy: Credit Discovery + AI Everywhere v1
begin;

-- -------------------------------------------------------------------
-- 1) AI event audit (everything AI does is recorded)
-- -------------------------------------------------------------------
create table if not exists public.ai_events (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid null,
  actor_user_id uuid null,
  scope text not null,               -- 'credit_discovery','doc_intel','ownership','pricing','uw_copilot','comms'
  action text not null,              -- 'start','answer','summarize','classify','extract','compute','quote','draft'
  input_json jsonb null,
  output_json jsonb null,
  confidence numeric(5,2) null check (confidence >= 0 and confidence <= 100),
  evidence_json jsonb null,          -- links to file_ids, excerpts, message_ids, etc.
  requires_human_review boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists idx_ai_events_deal_id on public.ai_events(deal_id);
create index if not exists idx_ai_events_scope on public.ai_events(scope);
create index if not exists idx_ai_events_created_at on public.ai_events(created_at);

-- -------------------------------------------------------------------
-- 2) Credit Discovery sessions + answers + facts
-- -------------------------------------------------------------------
create table if not exists public.credit_discovery_sessions (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null unique,
  status text not null default 'active',     -- 'active','complete','blocked'
  stage text not null default 'business',    -- 'business','ownership','loan','repayment','risk','wrapup'
  completeness numeric(5,2) not null default 0 check (completeness >= 0 and completeness <= 100),
  missing_domains jsonb not null default '[]'::jsonb,  -- e.g. ["ownership","repayment"]
  summary_json jsonb not null default '{}'::jsonb,     -- structured discovered summary
  last_question_json jsonb null,                      -- {id, text, domain, required_fields}
  last_activity_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_credit_discovery_sessions_deal_id on public.credit_discovery_sessions(deal_id);

create table if not exists public.credit_discovery_answers (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null,
  deal_id uuid not null,
  question_id text not null,
  domain text not null,                  -- 'identity','ownership','management','business_model','financials','loan_request','repayment','risk'
  raw_answer_text text null,
  raw_answer_json jsonb null,            -- if UI uses structured input
  extracted_facts_json jsonb null,       -- AI extracted facts from answer
  confidence numeric(5,2) null check (confidence >= 0 and confidence <= 100),
  evidence_json jsonb null,
  created_at timestamptz not null default now()
);
create index if not exists idx_credit_discovery_answers_session on public.credit_discovery_answers(session_id);
create index if not exists idx_credit_discovery_answers_deal on public.credit_discovery_answers(deal_id);

-- Materialized "facts" store (what we believe to be true right now)
create table if not exists public.credit_discovery_facts (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null,
  domain text not null,
  key text not null,                     -- e.g. 'legal_name','ein','revenue_2024'
  value_json jsonb not null,
  source text not null default 'borrower', -- 'borrower','document','banker','ai_inferred'
  confidence numeric(5,2) not null default 50 check (confidence >= 0 and confidence <= 100),
  evidence_json jsonb null,
  updated_at timestamptz not null default now(),
  unique(deal_id, domain, key)
);
create index if not exists idx_credit_discovery_facts_deal on public.credit_discovery_facts(deal_id);
create index if not exists idx_credit_discovery_facts_domain on public.credit_discovery_facts(domain);

-- -------------------------------------------------------------------
-- 3) Ownership graph (entities + relationships + requirements)
-- -------------------------------------------------------------------
create table if not exists public.ownership_entities (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null,
  entity_type text not null,            -- 'person','company','trust'
  display_name text not null,
  tax_id_last4 text null,
  meta_json jsonb not null default '{}'::jsonb,
  confidence numeric(5,2) not null default 50 check (confidence >= 0 and confidence <= 100),
  evidence_json jsonb null,
  created_at timestamptz not null default now()
);
create index if not exists idx_ownership_entities_deal on public.ownership_entities(deal_id);

create table if not exists public.ownership_edges (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null,
  from_entity_id uuid not null,
  to_entity_id uuid not null,
  relationship text not null,           -- 'owns','controls','manages'
  ownership_pct numeric(7,4) null check (ownership_pct >= 0 and ownership_pct <= 100),
  confidence numeric(5,2) not null default 50 check (confidence >= 0 and confidence <= 100),
  evidence_json jsonb null,
  created_at timestamptz not null default now()
);
create index if not exists idx_ownership_edges_deal on public.ownership_edges(deal_id);
create index if not exists idx_ownership_edges_to on public.ownership_edges(to_entity_id);

-- Requirements derived from ownership rules (ex: >=20% => PFS + 3 yrs personal returns + PG)
create table if not exists public.owner_requirements (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null,
  owner_entity_id uuid not null,
  required_items jsonb not null,        -- ["PFS","PersonalTaxReturns_3Y","PersonalGuaranty"]
  rule_version text not null default 'bank_v1',
  derived_from_json jsonb null,
  status text not null default 'open',  -- 'open','in_progress','complete','waived'
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique(deal_id, owner_entity_id)
);
create index if not exists idx_owner_requirements_deal on public.owner_requirements(deal_id);

-- -------------------------------------------------------------------
-- 4) Document Intelligence results (classify/extract/quality)
-- -------------------------------------------------------------------
create table if not exists public.doc_intel_results (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null,
  file_id uuid not null,                -- reference your uploads table file id
  doc_type text not null,               -- 'BusinessTaxReturn','PFS','BankStatements','OperatingAgreement', etc.
  tax_year int null,
  extracted_json jsonb not null default '{}'::jsonb,
  quality_json jsonb not null default '{}'::jsonb, -- legible/complete/signed/all_pages
  confidence numeric(5,2) not null default 50 check (confidence >= 0 and confidence <= 100),
  evidence_json jsonb null,
  created_at timestamptz not null default now(),
  unique(deal_id, file_id)
);
create index if not exists idx_doc_intel_deal on public.doc_intel_results(deal_id);

-- -------------------------------------------------------------------
-- 5) Pricing quotes (deterministic + AI rationale)
-- -------------------------------------------------------------------
create table if not exists public.pricing_quotes (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null,
  quote_version text not null default 'v1',
  inputs_json jsonb not null,
  outputs_json jsonb not null,          -- rate/spread/fees/terms
  rationale_json jsonb not null,        -- evidence-based explanation
  created_by_user_id uuid null,
  created_at timestamptz not null default now()
);
create index if not exists idx_pricing_quotes_deal on public.pricing_quotes(deal_id);

-- -------------------------------------------------------------------
-- 6) RLS hard lock: service-role only via API routes
-- -------------------------------------------------------------------
alter table public.ai_events enable row level security;
alter table public.credit_discovery_sessions enable row level security;
alter table public.credit_discovery_answers enable row level security;
alter table public.credit_discovery_facts enable row level security;
alter table public.ownership_entities enable row level security;
alter table public.ownership_edges enable row level security;
alter table public.owner_requirements enable row level security;
alter table public.doc_intel_results enable row level security;
alter table public.pricing_quotes enable row level security;

do $$ begin
  -- deny-all policies (service role bypasses RLS)
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='ai_events' and policyname='deny_all_ai_events') then
    create policy deny_all_ai_events on public.ai_events for all using (false) with check (false);
  end if;

  if not exists (select 1 from pg_policies where schemaname='public' and tablename='credit_discovery_sessions' and policyname='deny_all_credit_discovery_sessions') then
    create policy deny_all_credit_discovery_sessions on public.credit_discovery_sessions for all using (false) with check (false);
  end if;

  if not exists (select 1 from pg_policies where schemaname='public' and tablename='credit_discovery_answers' and policyname='deny_all_credit_discovery_answers') then
    create policy deny_all_credit_discovery_answers on public.credit_discovery_answers for all using (false) with check (false);
  end if;

  if not exists (select 1 from pg_policies where schemaname='public' and tablename='credit_discovery_facts' and policyname='deny_all_credit_discovery_facts') then
    create policy deny_all_credit_discovery_facts on public.credit_discovery_facts for all using (false) with check (false);
  end if;

  if not exists (select 1 from pg_policies where schemaname='public' and tablename='ownership_entities' and policyname='deny_all_ownership_entities') then
    create policy deny_all_ownership_entities on public.ownership_entities for all using (false) with check (false);
  end if;

  if not exists (select 1 from pg_policies where schemaname='public' and tablename='ownership_edges' and policyname='deny_all_ownership_edges') then
    create policy deny_all_ownership_edges on public.ownership_edges for all using (false) with check (false);
  end if;

  if not exists (select 1 from pg_policies where schemaname='public' and tablename='owner_requirements' and policyname='deny_all_owner_requirements') then
    create policy deny_all_owner_requirements on public.owner_requirements for all using (false) with check (false);
  end if;

  if not exists (select 1 from pg_policies where schemaname='public' and tablename='doc_intel_results' and policyname='deny_all_doc_intel_results') then
    create policy deny_all_doc_intel_results on public.doc_intel_results for all using (false) with check (false);
  end if;

  if not exists (select 1 from pg_policies where schemaname='public' and tablename='pricing_quotes' and policyname='deny_all_pricing_quotes') then
    create policy deny_all_pricing_quotes on public.pricing_quotes for all using (false) with check (false);
  end if;
end $$;

commit;
