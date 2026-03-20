-- =====================================================================================
-- POST-MERGE UPGRADES: Traceability + OCR Spans + Policy Retrieval
-- Run this in Supabase SQL Editor
-- =====================================================================================

-- =====================================================================================
-- 1A) Persist AI runs + citations (traceability)
-- =====================================================================================

create table if not exists public.ai_run_citations (
  id uuid primary key default gen_random_uuid(),
  ai_event_id uuid not null references public.ai_events(id) on delete cascade,
  deal_id uuid null,
  bank_id uuid null,

  -- what chunk this citation came from (deal or policy)
  source_kind text not null check (source_kind in ('deal_doc_chunk','bank_policy_chunk')),
  chunk_id uuid not null,

  -- deal_doc_chunks fields (optional if policy chunk)
  upload_id uuid null,
  chunk_index int null,
  page_start int null,
  page_end int null,

  -- richer citation fields (once OCR spans exist)
  document_id uuid null,
  page_number int null,
  bbox jsonb null,              -- {x,y,w,h} normalized [0..1] or pixel coords
  excerpt text not null,        -- quoted snippet
  similarity numeric null,

  created_at timestamptz not null default now()
);

create index if not exists ai_run_citations_ai_event_id_idx on public.ai_run_citations(ai_event_id);
create index if not exists ai_run_citations_deal_idx on public.ai_run_citations(deal_id);
create index if not exists ai_run_citations_bank_idx on public.ai_run_citations(bank_id);
create index if not exists ai_run_citations_source_kind_chunk_idx on public.ai_run_citations(source_kind, chunk_id);

-- =====================================================================================
-- 2A) OCR spans table (for real doc/page citations)
-- Map deal_doc_chunks -> document/page/bbox spans
-- =====================================================================================

create table if not exists public.deal_doc_chunk_spans (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null,
  chunk_id uuid not null references public.deal_doc_chunks(id) on delete cascade,

  -- what "document" and "page" in your system (tie to deal_documents or borrower_uploads)
  document_id uuid null,
  upload_id uuid null,

  page_number int not null,    -- 1-based page number
  bbox jsonb not null,         -- {x,y,w,h} normalized 0..1 relative to page
  text_excerpt text null,      -- optional excerpt around span

  created_at timestamptz not null default now()
);

create index if not exists deal_doc_chunk_spans_chunk_idx on public.deal_doc_chunk_spans(chunk_id);
create index if not exists deal_doc_chunk_spans_doc_page_idx on public.deal_doc_chunk_spans(document_id, page_number);

-- =====================================================================================
-- 4A) Bank policy chunks: ensure embeddings exist + match RPC
-- If bank_policy_chunks already exists, we only add missing columns/indexes safely.
-- =====================================================================================

alter table public.bank_policy_chunks
  add column if not exists embedding vector(1536);

create index if not exists bank_policy_chunks_embedding_idx
  on public.bank_policy_chunks using ivfflat (embedding vector_cosine_ops)
  with (lists = 100);

-- Match function for bank policies
create or replace function public.match_bank_policy_chunks(
  in_bank_id uuid,
  in_query_embedding vector(1536),
  in_match_count int default 10
)
returns table (
  chunk_id uuid,
  bank_id uuid,
  content text,
  source_label text,
  similarity float
)
language sql stable
as $$
  select
    c.id as chunk_id,
    c.bank_id,
    c.content,
    coalesce(c.source_label, '') as source_label,
    1 - (c.embedding <=> in_query_embedding) as similarity
  from public.bank_policy_chunks c
  where c.bank_id = in_bank_id
    and c.embedding is not null
  order by c.embedding <=> in_query_embedding
  limit in_match_count;
$$;

-- =====================================================================================
-- 3A) Memo section drafts (if you don't already have a table)
-- Prefer existing: deal_message_drafts. If not, create deal_memo_section_drafts.
-- =====================================================================================

create table if not exists public.deal_memo_section_drafts (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null,
  section_key text not null, -- e.g. "risks", "mitigants", "summary", "collateral", "cash_flow"
  prompt text not null,
  content text not null,
  ai_event_id uuid null references public.ai_events(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists deal_memo_section_drafts_deal_section_idx
  on public.deal_memo_section_drafts(deal_id, section_key);

-- updated_at trigger (simple)
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists tr_touch_deal_memo_section_drafts on public.deal_memo_section_drafts;
create trigger tr_touch_deal_memo_section_drafts
before update on public.deal_memo_section_drafts
for each row execute function public.touch_updated_at();
