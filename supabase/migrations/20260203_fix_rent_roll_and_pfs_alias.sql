-- ─── Fix: RENT_ROLL → GEMINI_STANDARD, PERSONAL_FINANCIAL_STATEMENT → PFS ───
--
-- Corrects two routing issues from the initial backfill:
-- 1. RENT_ROLL was incorrectly assigned GEMINI_PACKET; it should be GEMINI_STANDARD
-- 2. PERSONAL_FINANCIAL_STATEMENT canonical_type should normalize to PFS

-- 1) RENT_ROLL must NOT be GEMINI_PACKET
UPDATE public.deal_documents
SET routing_class = 'GEMINI_STANDARD'
WHERE UPPER(TRIM(COALESCE(canonical_type, ''))) = 'RENT_ROLL'
  AND routing_class = 'GEMINI_PACKET';

-- 2) PERSONAL_FINANCIAL_STATEMENT canonicalizes to PFS
UPDATE public.deal_documents
SET canonical_type = 'PFS',
    routing_class  = 'DOC_AI_ATOMIC'
WHERE UPPER(TRIM(COALESCE(document_type, ''))) = 'PERSONAL_FINANCIAL_STATEMENT'
  AND canonical_type IS DISTINCT FROM 'PFS';
