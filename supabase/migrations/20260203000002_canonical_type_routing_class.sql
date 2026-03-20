-- ─── Canonical Type + Routing Class ──────────────────────────────────────────
-- Adds two derived columns to deal_documents:
--   canonical_type  – normalized document type (more granular than document_type)
--   routing_class   – extraction engine routing: DOC_AI_ATOMIC | GEMINI_PACKET | GEMINI_STANDARD
--
-- These columns are stamped by the classify processor and consumed by the
-- Smart Router to determine which extraction engine to use.

ALTER TABLE public.deal_documents
  ADD COLUMN IF NOT EXISTS canonical_type  TEXT,
  ADD COLUMN IF NOT EXISTS routing_class   TEXT;

-- Constrain routing_class to the three valid values (NULL allowed for legacy rows).
ALTER TABLE public.deal_documents
  DROP CONSTRAINT IF EXISTS deal_documents_routing_class_check;

ALTER TABLE public.deal_documents
  ADD CONSTRAINT deal_documents_routing_class_check
  CHECK (routing_class IS NULL OR routing_class IN ('DOC_AI_ATOMIC', 'GEMINI_PACKET', 'GEMINI_STANDARD'));

-- Index for the Smart Router: look up routing_class quickly.
CREATE INDEX IF NOT EXISTS idx_deal_documents_routing_class
  ON public.deal_documents (routing_class)
  WHERE routing_class IS NOT NULL;

-- Index for analytics: canonical_type per deal.
CREATE INDEX IF NOT EXISTS idx_deal_documents_canonical_type
  ON public.deal_documents (deal_id, canonical_type)
  WHERE canonical_type IS NOT NULL;

-- ─── Backfill existing rows ─────────────────────────────────────────────────
-- Map document_type values that already exist in the table to canonical_type + routing_class.
-- This handles the common cases; rows with exotic/null types get routing_class = 'GEMINI_STANDARD'.

UPDATE public.deal_documents
SET
  canonical_type = CASE UPPER(TRIM(COALESCE(document_type, '')))
    -- Tax returns
    WHEN 'BUSINESS_TAX_RETURN' THEN 'BUSINESS_TAX_RETURN'
    WHEN 'IRS_BUSINESS'        THEN 'BUSINESS_TAX_RETURN'
    WHEN 'IRS_1120'            THEN 'BUSINESS_TAX_RETURN'
    WHEN 'IRS_1120S'           THEN 'BUSINESS_TAX_RETURN'
    WHEN 'IRS_1065'            THEN 'BUSINESS_TAX_RETURN'
    WHEN 'PERSONAL_TAX_RETURN' THEN 'PERSONAL_TAX_RETURN'
    WHEN 'IRS_PERSONAL'        THEN 'PERSONAL_TAX_RETURN'
    WHEN 'IRS_1040'            THEN 'PERSONAL_TAX_RETURN'
    WHEN 'K1'                  THEN 'PERSONAL_TAX_RETURN'
    -- Financial sub-types
    WHEN 'INCOME_STATEMENT'    THEN 'INCOME_STATEMENT'
    WHEN 'BALANCE_SHEET'       THEN 'BALANCE_SHEET'
    WHEN 'PFS'                 THEN 'PFS'
    WHEN 'PERSONAL_FINANCIAL_STATEMENT' THEN 'PFS'
    -- Generic financial (includes T12)
    WHEN 'FINANCIAL_STATEMENT' THEN 'FINANCIAL_STATEMENT'
    WHEN 'T12'                 THEN 'FINANCIAL_STATEMENT'
    WHEN 'INTERIM_FINANCIALS'  THEN 'FINANCIAL_STATEMENT'
    -- Standard types
    WHEN 'BANK_STATEMENT'      THEN 'BANK_STATEMENT'
    WHEN 'RENT_ROLL'           THEN 'RENT_ROLL'
    WHEN 'LEASE'               THEN 'LEASE'
    WHEN 'INSURANCE'           THEN 'INSURANCE'
    WHEN 'APPRAISAL'           THEN 'APPRAISAL'
    WHEN 'ENTITY_DOCS'         THEN 'ENTITY_DOCS'
    ELSE 'OTHER'
  END,
  routing_class = CASE UPPER(TRIM(COALESCE(document_type, '')))
    -- DOC_AI_ATOMIC: underwriting-critical structured docs
    WHEN 'BUSINESS_TAX_RETURN' THEN 'DOC_AI_ATOMIC'
    WHEN 'IRS_BUSINESS'        THEN 'DOC_AI_ATOMIC'
    WHEN 'IRS_1120'            THEN 'DOC_AI_ATOMIC'
    WHEN 'IRS_1120S'           THEN 'DOC_AI_ATOMIC'
    WHEN 'IRS_1065'            THEN 'DOC_AI_ATOMIC'
    WHEN 'PERSONAL_TAX_RETURN' THEN 'DOC_AI_ATOMIC'
    WHEN 'IRS_PERSONAL'        THEN 'DOC_AI_ATOMIC'
    WHEN 'IRS_1040'            THEN 'DOC_AI_ATOMIC'
    WHEN 'K1'                  THEN 'DOC_AI_ATOMIC'
    WHEN 'INCOME_STATEMENT'    THEN 'DOC_AI_ATOMIC'
    WHEN 'BALANCE_SHEET'       THEN 'DOC_AI_ATOMIC'
    WHEN 'PFS'                 THEN 'DOC_AI_ATOMIC'
    WHEN 'PERSONAL_FINANCIAL_STATEMENT' THEN 'DOC_AI_ATOMIC'
    -- GEMINI_PACKET: tabular multi-page docs handled well by Gemini
    WHEN 'FINANCIAL_STATEMENT' THEN 'GEMINI_PACKET'
    WHEN 'T12'                 THEN 'GEMINI_PACKET'
    WHEN 'INTERIM_FINANCIALS'  THEN 'GEMINI_PACKET'
    -- GEMINI_STANDARD: everything else (including RENT_ROLL)
    ELSE 'GEMINI_STANDARD'
  END
WHERE canonical_type IS NULL;
