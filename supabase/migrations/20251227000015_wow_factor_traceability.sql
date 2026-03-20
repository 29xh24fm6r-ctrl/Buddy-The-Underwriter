-- =====================================================================================
-- WOW FACTOR: Traceability tables for Ask Buddy, Auto-Memo, and "Why?" features
-- =====================================================================================

-- A) Store every committee/memo/chat run (traceability)
create table if not exists public.ai_run_events (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid null,
  bank_id uuid null,
  run_kind text not null,               -- 'ASK_BUDDY' | 'COMMITTEE' | 'MEMO_SECTION' | 'RERANK' | 'EXPLAIN_RISK'
  model text null,
  input_json jsonb not null default '{}'::jsonb,
  output_json jsonb not null default '{}'::jsonb,
  usage_json jsonb not null default '{}'::jsonb,
  created_at timestamp with time zone not null default now()
);

-- B) First-class citations
create table if not exists public.ai_run_citations (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.ai_run_events(id) on delete cascade,
  source_kind text not null,            -- 'DEAL_DOC' | 'BANK_POLICY'
  source_id uuid not null,              -- upload_id or asset_id
  chunk_id uuid null,                   -- deal_doc_chunks.id or bank_policy_chunks.id
  page_num int null,                    -- for policy (and later OCR)
  page_start int null,                  -- for deal docs
  page_end int null,
  quote text not null,
  created_at timestamp with time zone not null default now()
);

create index if not exists ai_run_events_deal_id_idx on public.ai_run_events(deal_id);
create index if not exists ai_run_events_run_kind_idx on public.ai_run_events(run_kind);
create index if not exists ai_run_citations_run_id_idx on public.ai_run_citations(run_id);
create index if not exists ai_run_citations_source_kind_idx on public.ai_run_citations(source_kind, source_id);
