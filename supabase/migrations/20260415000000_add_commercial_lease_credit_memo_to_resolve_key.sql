-- Phase 80 follow-up: teach resolve_checklist_key_sql about COMMERCIAL_LEASE and CREDIT_MEMO
-- These types were added to the TypeScript resolveChecklistKey() in Phase 80 but the
-- SQL mirror was never updated. This causes invariant violations in reconcileChecklistForDeal
-- when finalized docs with these types have null checklist_key.

-- Step 1: Update the SQL function mirror
CREATE OR REPLACE FUNCTION public.resolve_checklist_key_sql(
  p_canonical_type TEXT,
  p_tax_year INT DEFAULT NULL,
  p_statement_period TEXT DEFAULT NULL
)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  CASE p_canonical_type
    WHEN 'PERSONAL_FINANCIAL_STATEMENT' THEN RETURN 'PFS_CURRENT';
    WHEN 'PERSONAL_TAX_RETURN' THEN
      IF p_tax_year IS NOT NULL THEN RETURN 'IRS_PERSONAL_' || p_tax_year; END IF;
      RETURN NULL;
    WHEN 'BUSINESS_TAX_RETURN' THEN
      IF p_tax_year IS NOT NULL THEN RETURN 'IRS_BUSINESS_' || p_tax_year; END IF;
      RETURN NULL;
    WHEN 'BALANCE_SHEET' THEN
      IF p_statement_period = 'CURRENT' THEN RETURN 'FIN_STMT_BS_CURRENT'; END IF;
      IF p_statement_period = 'HISTORICAL' THEN RETURN 'FIN_STMT_BS_HISTORICAL'; END IF;
      RETURN NULL;
    WHEN 'INCOME_STATEMENT' THEN
      IF p_statement_period = 'YTD' THEN RETURN 'FIN_STMT_PL_YTD'; END IF;
      IF p_statement_period = 'ANNUAL' THEN RETURN 'FIN_STMT_PL_ANNUAL'; END IF;
      RETURN NULL;
    WHEN 'RENT_ROLL' THEN RETURN 'RENT_ROLL';
    WHEN 'BANK_STATEMENT' THEN RETURN 'BANK_STMT_3M';
    WHEN 'COMMERCIAL_LEASE' THEN RETURN 'LEASES_TOP';
    WHEN 'CREDIT_MEMO' THEN RETURN 'CREDIT_MEMO_PRIOR';
    ELSE RETURN NULL;
  END CASE;
END;
$$;

-- Step 2: Backfill any existing finalized docs with null checklist_key for these types
UPDATE public.deal_documents
SET checklist_key = resolve_checklist_key_sql(canonical_type, doc_year, statement_period)
WHERE canonical_type IN ('COMMERCIAL_LEASE', 'CREDIT_MEMO')
  AND checklist_key IS NULL
  AND canonical_type IS NOT NULL;
