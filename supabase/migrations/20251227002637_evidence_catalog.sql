-- =========================================
-- Evidence model for AI Catalog Builder
-- =========================================

-- Raw documents attached to a deal
create table if not exists public.evidence_documents (
  id uuid primary key default gen_random_uuid(),
  deal_id text not null,
  created_at timestamptz not null default now(),

  kind text not null default 'pdf', -- pdf|text|table
  label text not null,
  source_id text not null,          -- stable key used in EvidenceRef.sourceId (e.g., storage path or doc id)

  -- storage metadata (optional)
  storage_bucket text,
  storage_path text,
  mime_type text,

  unique (deal_id, source_id)
);

create index if not exists evidence_documents_deal_id_idx
  on public.evidence_documents (deal_id);

-- Page-level extracted text (cheap, fast, and already powers page citations)
create table if not exists public.evidence_pages (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.evidence_documents(id) on delete cascade,
  created_at timestamptz not null default now(),

  page_number int not null,    -- 1-based
  text text not null default '',

  -- optional: OCR/model summary for fast "committee mode"
  page_summary text,

  unique (document_id, page_number)
);

create index if not exists evidence_pages_document_id_idx
  on public.evidence_pages (document_id);

-- Chunks used for semantic retrieval / embeddings
create table if not exists public.evidence_chunks (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.evidence_documents(id) on delete cascade,
  created_at timestamptz not null default now(),

  page_start int not null,
  page_end int not null,
  chunk_index int not null,
  content text not null,

  -- optional "model-friendly" normalization
  normalized jsonb not null default '{}'::jsonb,

  unique (document_id, chunk_index)
);

create index if not exists evidence_chunks_document_id_idx
  on public.evidence_chunks (document_id);

-- Catalog items: underwriting facts/metrics/risks/mitigants extracted by AI
create table if not exists public.evidence_catalog_items (
  id uuid primary key default gen_random_uuid(),
  deal_id text not null,
  created_at timestamptz not null default now(),

  item_type text not null, -- fact|metric|risk|mitigant|pricing_input|covenant_input|other
  title text not null,
  body text not null,      -- concise: 1–3 sentences
  tags text[] not null default '{}',

  -- citations: array of EvidenceRef (at least sourceId + page)
  citations jsonb not null default '[]'::jsonb,

  -- retrieval helpers
  score_hint numeric not null default 0, -- optional pre-score for ranking
  source_chunk_ids uuid[] not null default '{}'
);

create index if not exists evidence_catalog_items_deal_id_idx
  on public.evidence_catalog_items (deal_id);

-- Optional: if you want embeddings later, add pgvector columns in a separate migration.
