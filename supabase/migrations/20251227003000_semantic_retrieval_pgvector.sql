-- =========================================
-- Semantic Retrieval w/ pgvector
-- Add embeddings to evidence_chunks + retrieval RPC
-- =========================================

-- 1) Enable pgvector (Supabase supports it natively)
create extension if not exists vector;

-- 2) Add embedding column to evidence_chunks
alter table public.evidence_chunks
  add column if not exists embedding vector(1536);

-- 3) Add deal_id to evidence_chunks for efficient filtering
-- (Backfill will happen separately via join to evidence_documents)
alter table public.evidence_chunks
  add column if not exists deal_id text;

-- 4) Create index on deal_id for fast filtering
create index if not exists evidence_chunks_deal_id_idx
  on public.evidence_chunks (deal_id);

-- 5) Create vector index (IVFFLAT for cosine similarity)
-- NOTE: lists=100 is good for up to ~100K chunks. Adjust if needed.
-- WARNING: This index can only be created AFTER some vectors exist.
-- If you get an error, skip this and create manually after embedding some chunks.
do $$
begin
  -- Check if index exists
  if not exists (
    select 1
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where c.relname = 'evidence_chunks_embedding_ivfflat_idx'
      and n.nspname = 'public'
  ) then
    -- Try to create index (will fail if no vectors exist yet - that's ok)
    begin
      execute 'create index evidence_chunks_embedding_ivfflat_idx on public.evidence_chunks using ivfflat (embedding vector_cosine_ops) with (lists = 100);';
    exception when others then
      raise notice 'Could not create vector index yet (no embeddings exist). Run this after embedding some chunks: CREATE INDEX evidence_chunks_embedding_ivfflat_idx ON public.evidence_chunks USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);';
    end;
  end if;
end $$;

-- 6) Retrieval RPC: cosine similarity search with deal_id filter
create or replace function public.match_evidence_chunks(
  in_deal_id text,
  in_query_embedding vector(1536),
  in_match_count int default 12
)
returns table (
  chunk_id uuid,
  document_id uuid,
  page_start int,
  page_end int,
  content text,
  similarity float
)
language sql
stable
as $$
  select
    c.id as chunk_id,
    c.document_id,
    c.page_start,
    c.page_end,
    c.content,
    1 - (c.embedding <=> in_query_embedding) as similarity
  from public.evidence_chunks c
  where c.embedding is not null
    and c.deal_id = in_deal_id
  order by c.embedding <=> in_query_embedding
  limit in_match_count;
$$;

-- 7) Backfill deal_id from evidence_documents
-- Run this AFTER migration is applied
update public.evidence_chunks c
set deal_id = d.deal_id
from public.evidence_documents d
where c.deal_id is null
  and c.document_id = d.id;

-- 8) RLS note:
-- If you have RLS enabled on evidence_chunks, ensure policies allow:
-- - SELECT for authenticated users with access to the deal
-- - UPDATE for service role (for embedding writes)
-- Example policy (adjust to your auth scheme):
-- create policy "Users can read chunks for their deals"
--   on public.evidence_chunks for select
--   using (deal_id in (select id from deals where user_has_access(auth.uid(), id)));

-- 9) Grant execute on RPC to authenticated users
grant execute on function public.match_evidence_chunks(text, vector, int) to authenticated;
grant execute on function public.match_evidence_chunks(text, vector, int) to service_role;
