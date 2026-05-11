-- SPEC-FOUNDATION-V1-PR5F — Fix unique_fact_identity partial unique index
--
-- The previous definition enforced hash uniqueness GLOBALLY across all deals:
--   CREATE UNIQUE INDEX unique_fact_identity ON deal_financial_facts (fact_identity_hash)
--   WHERE fact_identity_hash IS NOT NULL;
--
-- But fact_identity_hash is computed from (sourceDocumentId, factType, factKey,
-- factPeriodStart, factPeriodEnd, ownerEntityId) — without deal_id or bank_id.
-- Result: the FIRST deal to write a sentinel-keyed fact globally locked every
-- other deal from writing the same fact_key via backfill (100% failure rate
-- observed for 6+ weeks across all production deals).
--
-- This migration recreates the index with (deal_id, bank_id) included, so
-- uniqueness is enforced WITHIN A DEAL (the correct invariant) instead of
-- globally.
--
-- PR5e's instrumentation confirmed the root cause:
--   "fact_upsert_failed:duplicate key value violates unique constraint unique_fact_identity"
--   appearing on every backfill write attempt across multiple deals.
--
-- No code changes needed. The upsert callers already work correctly with
-- the natural-key constraint (deal_financial_facts_natural_uq). The hash
-- index is supplementary — this migration fixes its scope without changing
-- application behavior.

BEGIN;

DROP INDEX IF EXISTS public.unique_fact_identity;

CREATE UNIQUE INDEX unique_fact_identity
ON public.deal_financial_facts (deal_id, bank_id, fact_identity_hash)
WHERE fact_identity_hash IS NOT NULL;

COMMIT;
