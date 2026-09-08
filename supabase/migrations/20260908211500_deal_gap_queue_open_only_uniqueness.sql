-- deal_gap_queue uniqueness applies to OPEN rows only (migration
-- 20260502_financial_review_resolution.sql: deal_gap_queue_upsert_key WHERE
-- status = 'open'). Production additionally carried a full UNIQUE constraint
-- over (deal_id, fact_type, fact_key, gap_type, status), so once one
-- resolved row existed for a key, no later row for that key could ever be
-- resolved (23505), and every gap-queue sync since 2026-09-03 failed. Resolved
-- rows are history and may repeat.
ALTER TABLE public.deal_gap_queue
  DROP CONSTRAINT IF EXISTS deal_gap_queue_deal_id_fact_type_fact_key_gap_type_status_key;

CREATE UNIQUE INDEX IF NOT EXISTS deal_gap_queue_upsert_key
  ON public.deal_gap_queue (deal_id, fact_type, fact_key, gap_type, status)
  WHERE status = 'open';
