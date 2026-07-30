BEGIN;

-- SPEC-M6 ANTICIPATED-INTERROGATION-1
--
-- Widens brokerage_conversion_events' event_type CHECK constraint (see
-- 20260729000001_beat_metrics.sql) to add 'anticipated_lender_followup' — a
-- distinct event type from the existing 'lender_followup', which is
-- documented (beatMetrics.ts) as counting real, human-logged lender
-- questions. Conflating the two would corrupt that metric's meaning;
-- keeping them separate lets the dashboard compare the AI-predicted count
-- (emitted once per sealed deal, per hostile-interrogation run) against the
-- real manual-entry count trending down as M6 ships.

ALTER TABLE public.brokerage_conversion_events
  DROP CONSTRAINT IF EXISTS brokerage_conversion_events_event_type_check;

ALTER TABLE public.brokerage_conversion_events
  ADD CONSTRAINT brokerage_conversion_events_event_type_check
  CHECK (event_type IN (
    'lead_captured', 'session_started', 'deal_created',
    'concierge_started', 'email_claimed', 'converted',
    'first_interaction', 'readiness_read_rendered', 'formless_start',
    'doc_request_round', 'lender_followup',
    -- SPEC-M6 ANTICIPATED-INTERROGATION-1 addition:
    'anticipated_lender_followup'
  ));

COMMIT;
