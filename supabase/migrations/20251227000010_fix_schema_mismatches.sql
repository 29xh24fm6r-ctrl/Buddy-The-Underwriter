-- Fix Schema Mismatches for God-Mode Features
-- Addresses errors from screenshots:
-- A) deal_doc_chunks.source_label does not exist
-- B) ai_events.kind vs ai_run_events.run_kind conflict
-- C) bank_policy_chunks.embedding missing
-- D) sba_policy_rules missing columns

BEGIN;

-- ============================================================
-- 1. FIX: Rename ai_run_events → Use existing ai_events table
-- ============================================================
-- The WOW Factor migration created ai_run_events, but production has ai_events.
-- Solution: Drop ai_run_events tables and use existing ai_events with mapping.

DROP TABLE IF EXISTS public.ai_run_citations CASCADE;
DROP TABLE IF EXISTS public.ai_run_events CASCADE;

-- Extend existing ai_events to support new use cases
ALTER TABLE public.ai_events
  ADD COLUMN IF NOT EXISTS model TEXT,
  ADD COLUMN IF NOT EXISTS usage_json JSONB,
  ADD COLUMN IF NOT EXISTS error_message TEXT;

-- Create index for action filtering (replaces run_kind index)
CREATE INDEX IF NOT EXISTS idx_ai_events_action ON public.ai_events(action);

-- ============================================================
-- 2. FIX: Citations table using existing ai_events
-- ============================================================
CREATE TABLE IF NOT EXISTS public.ai_event_citations (
  citation_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES public.ai_events(id) ON DELETE CASCADE,
  
  source_kind TEXT NOT NULL CHECK (source_kind IN ('DEAL_DOC', 'BANK_POLICY', 'SBA_POLICY')),
  source_id UUID,
  chunk_id UUID,
  
  page_num INT,
  page_start INT,
  page_end INT,
  
  quote TEXT,
  similarity REAL,
  citation_index INT,
  
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_event_citations_event ON public.ai_event_citations(event_id);
CREATE INDEX IF NOT EXISTS idx_ai_event_citations_source ON public.ai_event_citations(source_kind, source_id);

COMMENT ON TABLE public.ai_event_citations IS 'Citations linking AI events to source chunks';

-- ============================================================
-- 3. FIX: bank_policy_chunks.embedding + source_label
-- ============================================================
-- Add embedding column (1536 dims for text-embedding-3-small)
ALTER TABLE public.bank_policy_chunks
  ADD COLUMN IF NOT EXISTS embedding vector(1536);

-- Add source_label for consistency with deal_doc_chunks
ALTER TABLE public.bank_policy_chunks
  ADD COLUMN IF NOT EXISTS source_label TEXT;

-- Create HNSW index (better than ivfflat, no 2000-dim limit)
DROP INDEX IF EXISTS public.bank_policy_chunks_embedding_idx;
DROP INDEX IF EXISTS public.bank_policy_chunks_embedding_ivfflat;

CREATE INDEX IF NOT EXISTS bank_policy_chunks_embedding_hnsw
  ON public.bank_policy_chunks
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

CREATE INDEX IF NOT EXISTS bank_policy_chunks_bank_id_idx
  ON public.bank_policy_chunks (bank_id);

-- ============================================================
-- 4. FIX: deal_doc_chunks.source_label (add if missing)
-- ============================================================
ALTER TABLE public.deal_doc_chunks
  ADD COLUMN IF NOT EXISTS source_label TEXT;

-- Ensure HNSW index exists (not ivfflat)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes 
    WHERE tablename = 'deal_doc_chunks' 
    AND indexname LIKE '%hnsw%'
  ) THEN
    DROP INDEX IF EXISTS public.deal_doc_chunks_embedding_idx;
    
    CREATE INDEX deal_doc_chunks_embedding_hnsw
      ON public.deal_doc_chunks
      USING hnsw (embedding vector_cosine_ops)
      WITH (m = 16, ef_construction = 64);
  END IF;
END $$;

-- ============================================================
-- 5. FIX: sba_policy_rules missing columns
-- ============================================================
ALTER TABLE public.sba_policy_rules
  ADD COLUMN IF NOT EXISTS title TEXT,
  ADD COLUMN IF NOT EXISTS category TEXT,
  ADD COLUMN IF NOT EXISTS borrower_friendly_explanation TEXT,
  ADD COLUMN IF NOT EXISTS fix_suggestions JSONB,
  ADD COLUMN IF NOT EXISTS severity TEXT CHECK (severity IN ('HARD_STOP', 'REQUIRES_MITIGATION', 'ADVISORY')),
  ADD COLUMN IF NOT EXISTS effective_date DATE,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- Add indexes
CREATE INDEX IF NOT EXISTS idx_sba_policy_rules_program ON public.sba_policy_rules(program);
CREATE INDEX IF NOT EXISTS idx_sba_policy_rules_category ON public.sba_policy_rules(category);
CREATE INDEX IF NOT EXISTS idx_sba_policy_rules_severity ON public.sba_policy_rules(severity);

-- ============================================================
-- 6. FIX: Update match_bank_policy_chunks RPC signature
-- ============================================================
CREATE OR REPLACE FUNCTION public.match_bank_policy_chunks(
  p_bank_id UUID,
  query_embedding vector(1536),
  match_count INT DEFAULT 10
)
RETURNS TABLE (
  chunk_id UUID,
  asset_id UUID,
  chunk_text TEXT,
  doc_name TEXT,
  source_label TEXT,
  similarity REAL
)
LANGUAGE SQL
STABLE
AS $$
  SELECT
    c.id AS chunk_id,
    c.asset_id,
    c.chunk_text,
    COALESCE(a.doc_name, '') AS doc_name,
    COALESCE(c.source_label, '') AS source_label,
    1 - (c.embedding <=> query_embedding) AS similarity
  FROM public.bank_policy_chunks c
  LEFT JOIN public.bank_policy_assets a ON c.asset_id = a.asset_id
  WHERE c.bank_id = p_bank_id
    AND c.embedding IS NOT NULL
  ORDER BY c.embedding <=> query_embedding
  LIMIT match_count;
$$;

-- ============================================================
-- 7. CLEANUP: Remove conflicting tables from God-Mode migration
-- ============================================================
-- The sba_god_mode_foundation created committee_personas which conflicts
-- We'll keep the schema but note it should use action-based ai_events

-- Update committee_personas if it exists
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'committee_personas') THEN
    -- No changes needed, it's standalone
    NULL;
  END IF;
END $$;

-- ============================================================
-- GRANT Permissions
-- ============================================================
GRANT ALL ON public.ai_event_citations TO service_role;
GRANT ALL ON public.ai_events TO service_role;
GRANT ALL ON public.bank_policy_chunks TO service_role;
GRANT ALL ON public.deal_doc_chunks TO service_role;
GRANT ALL ON public.sba_policy_rules TO service_role;

-- Enable RLS on new table
ALTER TABLE public.ai_event_citations ENABLE ROW LEVEL SECURITY;

COMMIT;
