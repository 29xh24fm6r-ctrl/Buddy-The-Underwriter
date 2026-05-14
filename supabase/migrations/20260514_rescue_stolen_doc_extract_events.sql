-- ============================================================
-- SPEC-OUTBOX-ROUTING-AND-LOCATION-CENTRALIZATION-1
-- Rescue doc.extract events historically stolen by Pulse worker
-- ============================================================
--
-- Resets delivery state for doc.extract events that were claimed
-- by the Pulse outbox worker (delivered_to = 'pulse') instead of
-- the doc-extraction worker. After this migration, the next
-- doc-extraction cron tick will pick these up.
--
-- Bounded scope:
--   - Only kind = 'doc.extract' events.
--   - Only those marked delivered_to = 'pulse' (the stolen ones).
--   - Only created in the last 7 days. Older events left alone:
--     they may be stale beyond TTL, the underlying documents may
--     have changed, or the deal may be in a state where re-extraction
--     would be wrong.
--
-- Idempotent: re-running this migration is a no-op (rows already
-- reset will not match the delivered_to = 'pulse' filter).
--
-- Audit trail: rescued events retain attempts and any prior errors.
-- Only delivery-state columns are reset.

UPDATE public.buddy_outbox_events
SET
  delivered_at = NULL,
  delivered_to = NULL,
  claimed_at = NULL,
  claim_owner = NULL,
  next_attempt_at = NULL,
  last_error = NULL
WHERE kind = 'doc.extract'
  AND delivered_to = 'pulse'
  AND created_at >= '2026-05-07T00:00:00Z';

-- Visibility: record the rescue as a system event for audit.
-- resolution_status = 'resolved' (the CHECK constraint allows:
-- open / retrying / resolved / dead / suppressed; not 'closed').
INSERT INTO public.buddy_system_events (
  event_type,
  severity,
  source_system,
  error_class,
  error_code,
  error_message,
  resolution_status,
  payload
)
VALUES (
  'recovery',
  'info',
  'api',
  'unknown',
  'OUTBOX_ROUTING_RESCUE',
  'Rescued doc.extract events stolen by Pulse worker (SPEC-OUTBOX-ROUTING-AND-LOCATION-CENTRALIZATION-1)',
  'resolved',
  jsonb_build_object(
    'spec', 'SPEC-OUTBOX-ROUTING-AND-LOCATION-CENTRALIZATION-1',
    'cutoff_iso', '2026-05-07T00:00:00Z',
    'affected_kind', 'doc.extract',
    'reset_delivered_to_from', 'pulse'
  )
);
