-- Fix: confirm route 500s caused by checklist_key constraints mismatching
-- statement_period-aware resolve_checklist_key_sql() behavior + overload ambiguity.
--
-- Root cause: Phase P migration created a 3-param overload of
-- resolve_checklist_key_sql(text, int, text) without dropping the old 2-param
-- version (text, int). Both coexisted, making 2-arg calls in CHECK constraints
-- ambiguous ("function is not unique"), causing ANY deal_documents UPDATE to fail.

----------------------------------------------------------------------
-- Step 1: Drop constraints that depend on the old 2-arg function FIRST
----------------------------------------------------------------------
ALTER TABLE public.deal_documents
  DROP CONSTRAINT IF EXISTS finalized_docs_must_have_checklist_key;

ALTER TABLE public.deal_documents
  DROP CONSTRAINT IF EXISTS required_types_must_have_checklist_key;

----------------------------------------------------------------------
-- Step 2: Remove overload ambiguity (drop legacy 2-arg function)
----------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.resolve_checklist_key_sql(text, int);

----------------------------------------------------------------------
-- Step 3: Re-add constraints using 3-arg, period-aware derivation
----------------------------------------------------------------------
ALTER TABLE public.deal_documents
  ADD CONSTRAINT required_types_must_have_checklist_key
  CHECK (
    public.resolve_checklist_key_sql(canonical_type, doc_year, statement_period) IS NULL
    OR checklist_key IS NOT NULL
  );

ALTER TABLE public.deal_documents
  ADD CONSTRAINT finalized_docs_must_have_checklist_key
  CHECK (
    finalized_at IS NULL
    OR canonical_type IS NULL
    OR public.resolve_checklist_key_sql(canonical_type, doc_year, statement_period) IS NULL
    OR checklist_key IS NOT NULL
  );

----------------------------------------------------------------------
-- Step 4: Make reconcile safe (never null-out required keys)
----------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reconcile_checklist_for_deal_sql(p_deal_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.deal_documents dd
  SET checklist_key = public.resolve_checklist_key_sql(dd.canonical_type, dd.doc_year, dd.statement_period)
  WHERE dd.deal_id = p_deal_id
    AND dd.canonical_type IS NOT NULL
    AND dd.checklist_key IS DISTINCT FROM public.resolve_checklist_key_sql(dd.canonical_type, dd.doc_year, dd.statement_period)
    AND (
      public.resolve_checklist_key_sql(dd.canonical_type, dd.doc_year, dd.statement_period) IS NOT NULL
      OR NOT public.requires_checklist_key(dd.canonical_type)
    );
END;
$$;

----------------------------------------------------------------------
-- Step 5: Backfill statement_period for existing BS/IS docs
----------------------------------------------------------------------
UPDATE public.deal_documents
SET statement_period = CASE
  WHEN checklist_key = 'FIN_STMT_BS_HISTORICAL' THEN 'HISTORICAL'
  ELSE 'CURRENT'
END
WHERE canonical_type = 'BALANCE_SHEET'
  AND statement_period IS NULL;

UPDATE public.deal_documents
SET statement_period = CASE
  WHEN checklist_key = 'FIN_STMT_PL_YTD' THEN 'YTD'
  ELSE 'ANNUAL'
END
WHERE canonical_type = 'INCOME_STATEMENT'
  AND statement_period IS NULL;

----------------------------------------------------------------------
-- Step 6: Fix wrong checklist_key values (e.g. 'BALANCE_SHEET')
----------------------------------------------------------------------
UPDATE public.deal_documents
SET checklist_key = public.resolve_checklist_key_sql(canonical_type, doc_year, statement_period)
WHERE canonical_type IN ('BALANCE_SHEET', 'INCOME_STATEMENT')
  AND statement_period IS NOT NULL
  AND checklist_key IS DISTINCT FROM public.resolve_checklist_key_sql(canonical_type, doc_year, statement_period);
