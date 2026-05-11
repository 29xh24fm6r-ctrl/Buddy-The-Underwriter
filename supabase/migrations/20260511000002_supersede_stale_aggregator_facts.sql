-- SPEC-FOUNDATION-V1-PR5H — Supersede stale aggregator fact rows
--
-- The runCashFlowAggregator module previously used today's run date as
-- fact_period_end, creating a new row on every run (because fact_period_end
-- is part of the natural-uniqueness constraint). PR5h changed the aggregator
-- to use SENTINEL_DATE (1900-01-01) like all other canonical writers.
--
-- This migration marks the stale run-date rows as superseded so they don't
-- appear in downstream queries that filter on is_superseded = false.
-- Only affects rows with:
--   - fact_type = 'FINANCIAL_ANALYSIS'
--   - fact_period_start = '1900-01-01' (sentinel start)
--   - fact_period_end != '1900-01-01' (non-sentinel end = run-date rows)
--   - provenance->>'extractor' = 'classicSpread:debtService:v1' (the aggregator)
--   - is_superseded = false (not already superseded)

UPDATE deal_financial_facts
SET is_superseded = true
WHERE fact_type = 'FINANCIAL_ANALYSIS'
  AND fact_period_start = '1900-01-01'
  AND fact_period_end != '1900-01-01'
  AND provenance->>'extractor' = 'classicSpread:debtService:v1'
  AND is_superseded = false;
