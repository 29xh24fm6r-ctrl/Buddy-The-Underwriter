-- Circuit breaker for queued_never_started stuck-recovery (handleStuckRecovery.ts).
--
-- Each reenqueue previously created a fresh outbox row (attempts=0) and reset
-- intake_processing_queued_at, so the staleness check that decides "should we
-- reenqueue again" always measured a freshly-created row/timer — it never
-- accumulated across the deal's whole stuck-recovery lifecycle. If the
-- underlying cause was systemic (worker/cron down, or the same doc/deal
-- deterministically failing every attempt), this could reenqueue indefinitely
-- instead of converging to a terminal, manually-actionable state.
--
-- This column tracks total reenqueue attempts for the deal across that whole
-- lifecycle. handleStuckRecovery.ts resets it to 0 once a run actually starts
-- (intake_processing_started_at gets stamped), and stops reenqueuing once it
-- reaches the same threshold (5) processIntakeOutbox.ts already uses to
-- dead-letter an outbox row (DEAD_LETTER_THRESHOLD), so the whole intake
-- pipeline converges on one shared "give up after 5" convention.

ALTER TABLE public.deals
  ADD COLUMN IF NOT EXISTS intake_stuck_recovery_attempts int NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.deals.intake_stuck_recovery_attempts IS
  'Total queued_never_started stuck-recovery reenqueue attempts for the current intake processing lifecycle. Reset to 0 when a run actually starts; recovery stops and dead-letters (PROCESSING_COMPLETE_WITH_ERRORS) once this reaches the outbox DEAD_LETTER_THRESHOLD (5).';
