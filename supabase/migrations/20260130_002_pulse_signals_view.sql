-- View of active signals stored in the same ledger table
CREATE OR REPLACE VIEW pulse_active_signals AS
SELECT
  id,
  created_at,
  severity,
  event_type AS signal_type,
  payload,
  deal_id,
  bank_id,
  trace_id
FROM buddy_ledger_events
WHERE source = 'pulse'
  AND event_category = 'signal'
ORDER BY created_at DESC;
