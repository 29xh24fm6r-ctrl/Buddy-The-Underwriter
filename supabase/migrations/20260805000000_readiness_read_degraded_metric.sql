BEGIN;

-- Borrower Intake Program audit fix (SPEC-M3 GLASS-BOX-1 follow-up)
--
-- Widens brokerage_conversion_events' event_type CHECK constraint (see
-- 20260729000001_beat_metrics.sql, 20260801000001_anticipated_lender_followup_metric.sql)
-- to add 'readiness_read_degraded'.
--
-- Audit finding: buildGlassBoxReadinessRead.ts only ever calls
-- emitReadinessReadRendered on its "ready" branch. Since all three AI
-- vendors are still PENDING approval (vendorApproval.ts), the translator/
-- verifier calls this feature depends on are refused by the gateway's NPI
-- gate on every single invocation today, so the "ready" branch — and thus
-- emitReadinessReadRendered — never actually fires in production. The only
-- signal was a console.error with no aggregate visibility, so nobody could
-- see that this borrower-facing feature has a 100% degraded rate. This
-- metric gives ops a real, queryable signal distinct from the generic log
-- line, the same way 'anticipated_lender_followup' was split out from
-- 'lender_followup' rather than overloading an existing event type.

ALTER TABLE public.brokerage_conversion_events
  DROP CONSTRAINT IF EXISTS brokerage_conversion_events_event_type_check;

ALTER TABLE public.brokerage_conversion_events
  ADD CONSTRAINT brokerage_conversion_events_event_type_check
  CHECK (event_type IN (
    'lead_captured', 'session_started', 'deal_created',
    'concierge_started', 'email_claimed', 'converted',
    'first_interaction', 'readiness_read_rendered', 'formless_start',
    'doc_request_round', 'lender_followup',
    'anticipated_lender_followup',
    -- Borrower Intake Program audit fix addition:
    'readiness_read_degraded'
  ));

COMMIT;
