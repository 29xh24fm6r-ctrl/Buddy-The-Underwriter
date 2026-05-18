-- SPEC-FACT-DISAMBIGUATION-1: add source_canonical_type column
ALTER TABLE public.deal_financial_facts
ADD COLUMN IF NOT EXISTS source_canonical_type text;

COMMENT ON COLUMN public.deal_financial_facts.source_canonical_type IS
'Denormalized from deal_documents.canonical_type at write time.
Allows single-step filtering by document type (e.g. BUSINESS_TAX_RETURN,
PERSONAL_TAX_RETURN) without a join to deal_documents. NULL for facts
from computed sources (aggregator, GCF engine, spread backfill) that have
no source document.';

-- Backfill existing rows from deal_documents
UPDATE public.deal_financial_facts dff
SET source_canonical_type = dd.canonical_type
FROM public.deal_documents dd
WHERE dd.id = dff.source_document_id
AND dff.source_document_id != '00000000-0000-0000-0000-000000000000'
AND dff.source_canonical_type IS NULL;

-- Index for the most common filter pattern
CREATE INDEX IF NOT EXISTS idx_dff_source_canonical_type
ON public.deal_financial_facts (deal_id, source_canonical_type)
WHERE source_canonical_type IS NOT NULL;
