-- Phase E3.2: Fix chk_intake_phase to include terminal phases.
--
-- The original constraint only allowed 3 phases:
--   BULK_UPLOADED, CLASSIFIED_PENDING_CONFIRMATION, CONFIRMED_READY_FOR_PROCESSING
--
-- This blocked every terminalization attempt (PROCESSING_COMPLETE,
-- PROCESSING_COMPLETE_WITH_ERRORS) causing deals to get stuck permanently
-- in CONFIRMED_READY_FOR_PROCESSING after processing completed.
--
-- Evidence: outbox row 72999ea3 — last_error = "violates check constraint chk_intake_phase"
-- while delivered_at was set (pre-E3.1 bug).

ALTER TABLE public.deals DROP CONSTRAINT IF EXISTS chk_intake_phase;

ALTER TABLE public.deals ADD CONSTRAINT chk_intake_phase CHECK (
  intake_phase = ANY (ARRAY[
    'BULK_UPLOADED'::text,
    'CLASSIFIED_PENDING_CONFIRMATION'::text,
    'CONFIRMED_READY_FOR_PROCESSING'::text,
    'PROCESSING_COMPLETE'::text,
    'PROCESSING_COMPLETE_WITH_ERRORS'::text
  ])
);
