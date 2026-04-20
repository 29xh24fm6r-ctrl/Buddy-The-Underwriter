-- Phase 84 T-02b — add PERSONAL_FINANCIAL_STATEMENT to gatekeeper_doc_type CHECK
--
-- GatekeeperDocType enum in src/lib/gatekeeper/types.ts includes
-- PERSONAL_FINANCIAL_STATEMENT; the DB CHECK constraint was never migrated
-- to match. Code drift caused silent write failures discovered during Phase 84
-- T-02 batch reclassify (9 docs classified as PFS were silently discarded
-- because stampDocument did not check Supabase's in-band error response).
-- See docs/archive/phase-84/AAR_PHASE_84_T02.md.

ALTER TABLE public.deal_documents
  DROP CONSTRAINT IF EXISTS deal_documents_gatekeeper_doc_type_check;

ALTER TABLE public.deal_documents
  ADD CONSTRAINT deal_documents_gatekeeper_doc_type_check
  CHECK (
    gatekeeper_doc_type IS NULL
    OR gatekeeper_doc_type = ANY (ARRAY[
      'BUSINESS_TAX_RETURN'::text,
      'PERSONAL_TAX_RETURN'::text,
      'W2'::text,
      'FORM_1099'::text,
      'K1'::text,
      'BANK_STATEMENT'::text,
      'FINANCIAL_STATEMENT'::text,
      'PERSONAL_FINANCIAL_STATEMENT'::text,
      'DRIVERS_LICENSE'::text,
      'VOIDED_CHECK'::text,
      'OTHER'::text,
      'UNKNOWN'::text
    ])
  );
