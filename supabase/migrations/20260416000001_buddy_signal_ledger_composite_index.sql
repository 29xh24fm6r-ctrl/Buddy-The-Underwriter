-- Add composite index for the degraded-state query pattern.
-- The route filters on bank_id + deal_id + type + created_at but only
-- (bank_id, created_at) and (deal_id, created_at) indexes exist — no
-- single index covers all four predicates efficiently.

CREATE INDEX IF NOT EXISTS buddy_signal_ledger_deal_type_created_idx
  ON public.buddy_signal_ledger (bank_id, deal_id, type, created_at DESC)
  WHERE type = 'api.degraded';
