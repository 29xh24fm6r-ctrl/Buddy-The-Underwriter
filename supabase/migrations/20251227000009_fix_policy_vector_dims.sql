-- =====================================================================================
-- FIX: Ensure bank_policy_chunks uses vector(1536) for ivfflat compatibility
-- Run this if you encounter "ivfflat index only supports vectors with <= 2000 dimensions"
-- =====================================================================================

-- Drop existing embedding column if it's the wrong size
alter table public.bank_policy_chunks
  drop column if exists embedding;

-- Recreate at 1536 dims (compatible with ivfflat and text-embedding-3-small)
alter table public.bank_policy_chunks
  add column if not exists embedding vector(1536);

alter table public.bank_policy_chunks
  add column if not exists embedded_at timestamp with time zone;

-- Drop and recreate ivfflat index
drop index if exists bank_policy_chunks_embedding_idx;
drop index if exists bank_policy_chunks_embedding_ivfflat;

create index if not exists bank_policy_chunks_embedding_ivfflat
  on public.bank_policy_chunks using ivfflat (embedding vector_cosine_ops)
  with (lists = 100);

-- Ensure bank_id index exists
create index if not exists bank_policy_chunks_bank_id_idx
  on public.bank_policy_chunks (bank_id);

-- Recreate RPC with correct vector(1536) signature
drop function if exists public.match_bank_policy_chunks(uuid, vector, int);

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

-- Verify
select 
  column_name, 
  udt_name, 
  character_maximum_length
from information_schema.columns 
where table_name = 'bank_policy_chunks' 
  and column_name = 'embedding';

-- Should show: embedding | vector | (null or blank)
-- Run: SELECT pg_typeof(embedding) FROM bank_policy_chunks LIMIT 1;
-- Should show: vector(1536)
