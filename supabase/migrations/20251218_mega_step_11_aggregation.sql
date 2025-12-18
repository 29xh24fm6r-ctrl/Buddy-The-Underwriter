-- MEGA STEP 11: Multi-Doc Aggregation
-- Upgrade condition_match_rules to support set-based matching
-- (e.g., "2 years of tax returns", "6 months of bank statements")

-- Add performance indexes for evidence queries
CREATE INDEX IF NOT EXISTS idx_conditions_to_close_evidence_gin
  ON public.conditions_to_close USING gin (evidence);

CREATE INDEX IF NOT EXISTS idx_conditions_to_close_deal_condition_type
  ON public.conditions_to_close (deal_id, condition_type);

-- Upgrade canonical rules to aggregation mode
-- Tax Returns: require 2 distinct years
UPDATE public.condition_match_rules
SET matcher = jsonb_set(
  jsonb_set(COALESCE(matcher,'{}'::jsonb), '{required_distinct_count}', '2'::jsonb, true),
  '{distinct_key}', '"tax_year"'::jsonb, true
)
WHERE condition_key IN ('TAX_RETURNS_PERSONAL_2Y','TAX_RETURNS_BUSINESS_2Y')
  AND EXISTS (
    SELECT 1 FROM public.condition_match_rules
    WHERE condition_key IN ('TAX_RETURNS_PERSONAL_2Y','TAX_RETURNS_BUSINESS_2Y')
  );

-- Bank Statements: require 6 distinct months
UPDATE public.condition_match_rules
SET matcher = jsonb_set(
  jsonb_set(COALESCE(matcher,'{}'::jsonb), '{required_distinct_count}', '6'::jsonb, true),
  '{distinct_key}', '"statement_month_iso"'::jsonb, true
)
WHERE condition_key = 'BANK_STATEMENTS_6M'
  AND EXISTS (
    SELECT 1 FROM public.condition_match_rules
    WHERE condition_key = 'BANK_STATEMENTS_6M'
  );

-- Default single-doc rules to required_distinct_count=1, distinct_key="any" if not present
-- This ensures backward compatibility with MEGA STEP 10 single-doc rules
UPDATE public.condition_match_rules
SET matcher = jsonb_set(
  jsonb_set(COALESCE(matcher,'{}'::jsonb), '{required_distinct_count}', '1'::jsonb, true),
  '{distinct_key}', '"any"'::jsonb, true
)
WHERE (matcher ? 'required_distinct_count') IS FALSE
   OR (matcher ? 'distinct_key') IS FALSE;

-- Add helpful comment
COMMENT ON COLUMN public.condition_match_rules.matcher IS 
'Aggregation config (MEGA 11): 
- required_distinct_count (number): how many distinct items needed (e.g., 2 years, 6 months)
- distinct_key (string): "tax_year" | "statement_month_iso" | "any"
- allow_satisfy_without_distinct_key (boolean): fallback to count-based if keys not detected
- min_confidence inherited from top-level column';
