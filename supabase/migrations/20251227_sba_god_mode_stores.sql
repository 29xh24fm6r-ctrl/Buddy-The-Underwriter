-- SBA God Mode: Knowledge Stores + RPC Functions
-- Date: 2024-12-27
-- Purpose: Create SBA SOP chunks table + vector search RPCs for all 3 stores

-- ============================================================================
-- 1) SBA SOP Chunks Table (Store A: SBA official guidance)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.sba_sop_chunks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  program TEXT NOT NULL CHECK (program IN ('7a', '504')),
  sop_version TEXT NOT NULL,
  section TEXT,
  page_num INTEGER,
  chunk_index INTEGER NOT NULL,
  content TEXT NOT NULL,
  embedding vector(1536), -- OpenAI text-embedding-3-small
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for filtering
CREATE INDEX IF NOT EXISTS sba_sop_chunks_program_idx
  ON public.sba_sop_chunks (program);

CREATE INDEX IF NOT EXISTS sba_sop_chunks_sop_version_idx
  ON public.sba_sop_chunks (sop_version);

-- HNSW vector index (better than ivfflat, no dimension limits)
CREATE INDEX IF NOT EXISTS sba_sop_chunks_embedding_hnsw
  ON public.sba_sop_chunks
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

COMMENT ON TABLE public.sba_sop_chunks IS 'SBA Standard Operating Procedure chunks with embeddings for semantic search';

-- ============================================================================
-- 2) RPC: Match Deal Doc Chunks (Store: Deal Documents)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.match_deal_doc_chunks(
  in_deal_id UUID,
  in_query_embedding vector(1536),
  in_match_count INT DEFAULT 10
)
RETURNS TABLE (
  chunk_id UUID,
  deal_id UUID,
  source_label TEXT,
  page_start INT,
  page_end INT,
  content TEXT,
  similarity REAL
)
LANGUAGE sql STABLE
AS $$
  SELECT
    c.id AS chunk_id,
    c.deal_id,
    c.source_label,
    c.page_start,
    c.page_end,
    c.content,
    (1 - (c.embedding <=> in_query_embedding))::REAL AS similarity
  FROM public.deal_doc_chunks c
  WHERE c.deal_id = in_deal_id
    AND c.embedding IS NOT NULL
  ORDER BY c.embedding <=> in_query_embedding
  LIMIT in_match_count;
$$;

COMMENT ON FUNCTION public.match_deal_doc_chunks IS 'Vector similarity search for deal document chunks';

-- ============================================================================
-- 3) RPC: Match SBA SOP Chunks (Store: SBA Official Guidance)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.match_sba_sop_chunks(
  in_program TEXT,
  in_sop_version TEXT DEFAULT NULL,
  in_query_embedding vector(1536),
  in_match_count INT DEFAULT 10
)
RETURNS TABLE (
  chunk_id UUID,
  program TEXT,
  sop_version TEXT,
  section TEXT,
  page_num INT,
  content TEXT,
  similarity REAL
)
LANGUAGE sql STABLE
AS $$
  SELECT
    c.id AS chunk_id,
    c.program,
    c.sop_version,
    c.section,
    c.page_num,
    c.content,
    (1 - (c.embedding <=> in_query_embedding))::REAL AS similarity
  FROM public.sba_sop_chunks c
  WHERE c.program = in_program
    AND (in_sop_version IS NULL OR c.sop_version = in_sop_version)
    AND c.embedding IS NOT NULL
  ORDER BY c.embedding <=> in_query_embedding
  LIMIT in_match_count;
$$;

COMMENT ON FUNCTION public.match_sba_sop_chunks IS 'Vector similarity search for SBA SOP chunks';

-- ============================================================================
-- 4) RPC: Match Bank Policy Chunks (Store: Bank-Specific Policies)
-- Already has embedding column from schema fix migration
-- ============================================================================

CREATE OR REPLACE FUNCTION public.match_bank_policy_chunks(
  in_bank_id UUID,
  in_query_embedding vector(1536),
  in_match_count INT DEFAULT 10
)
RETURNS TABLE (
  chunk_id UUID,
  bank_id UUID,
  asset_id UUID,
  section TEXT,
  page_num INT,
  content TEXT,
  source_label TEXT,
  similarity REAL
)
LANGUAGE sql STABLE
AS $$
  SELECT
    c.id AS chunk_id,
    c.bank_id,
    c.asset_id,
    c.section,
    c.page_num,
    c.content,
    c.source_label,
    (1 - (c.embedding <=> in_query_embedding))::REAL AS similarity
  FROM public.bank_policy_chunks c
  WHERE c.bank_id = in_bank_id
    AND c.embedding IS NOT NULL
  ORDER BY c.embedding <=> in_query_embedding
  LIMIT in_match_count;
$$;

COMMENT ON FUNCTION public.match_bank_policy_chunks IS 'Vector similarity search for bank policy chunks';

-- ============================================================================
-- 5) Enhanced SBA Policy Rules (add remaining helpful columns)
-- Some columns already added in schema fix migration
-- ============================================================================

ALTER TABLE public.sba_policy_rules
  ADD COLUMN IF NOT EXISTS borrower_prompt TEXT;

CREATE INDEX IF NOT EXISTS sba_policy_rules_program_rule_key_idx
  ON public.sba_policy_rules (program, rule_key);

CREATE INDEX IF NOT EXISTS sba_policy_rules_program_severity_idx
  ON public.sba_policy_rules (program, severity);

COMMENT ON COLUMN public.sba_policy_rules.borrower_prompt IS 'User-friendly question to ask borrower to gather this fact';

-- ============================================================================
-- 6) Deal SBA Facts (normalized deal data for rule evaluation)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.deal_sba_facts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id UUID NOT NULL REFERENCES public.deals(id) ON DELETE CASCADE,
  fact_key TEXT NOT NULL,
  fact_value JSONB NOT NULL,
  confidence REAL CHECK (confidence >= 0 AND confidence <= 1),
  source_event_id UUID REFERENCES public.ai_events(id),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(deal_id, fact_key)
);

CREATE INDEX deal_sba_facts_deal_id_idx ON public.deal_sba_facts (deal_id);

COMMENT ON TABLE public.deal_sba_facts IS 'Normalized SBA facts extracted from deal data for rule evaluation';

-- ============================================================================
-- 7) Deal Eligibility Checks (audit trail of rule evaluations)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.deal_eligibility_checks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id UUID NOT NULL REFERENCES public.deals(id) ON DELETE CASCADE,
  program TEXT NOT NULL CHECK (program IN ('7a', '504')),
  rule_key TEXT NOT NULL,
  result TEXT NOT NULL CHECK (result IN ('PASS', 'FAIL', 'UNKNOWN')),
  explanation TEXT,
  missing_facts JSONB,
  citations JSONB,
  checked_at TIMESTAMPTZ DEFAULT NOW(),
  event_id UUID REFERENCES public.ai_events(id)
);

CREATE INDEX deal_eligibility_checks_deal_id_idx ON public.deal_eligibility_checks (deal_id);
CREATE INDEX deal_eligibility_checks_result_idx ON public.deal_eligibility_checks (result);

COMMENT ON TABLE public.deal_eligibility_checks IS 'Audit trail of SBA eligibility rule evaluations per deal';

-- ============================================================================
-- 8) Borrower Concierge Sessions (conversational intake tracking)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.borrower_concierge_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id UUID NOT NULL REFERENCES public.deals(id) ON DELETE CASCADE,
  program TEXT NOT NULL CHECK (program IN ('7a', '504')),
  conversation_history JSONB DEFAULT '[]'::JSONB,
  extracted_facts JSONB DEFAULT '{}'::JSONB,
  missing_facts JSONB DEFAULT '[]'::JSONB,
  progress_pct REAL DEFAULT 0,
  last_question TEXT,
  last_response TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX borrower_concierge_sessions_deal_id_idx ON public.borrower_concierge_sessions (deal_id);

COMMENT ON TABLE public.borrower_concierge_sessions IS 'Borrower conversational intake sessions with progress tracking';

-- ============================================================================
-- END MIGRATION
-- ============================================================================
