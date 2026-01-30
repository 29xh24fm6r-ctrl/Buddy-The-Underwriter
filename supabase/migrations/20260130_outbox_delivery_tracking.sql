-- Outbox delivery tracking: add columns required by Phase A/B event bridging spec.
-- Enables: source tracking, delivery target, scheduled retry, dead-lettering.
-- Compatible with existing buddy-core-worker (existing columns untouched).

ALTER TABLE public.buddy_outbox_events
  ADD COLUMN IF NOT EXISTS source          TEXT NOT NULL DEFAULT 'buddy',
  ADD COLUMN IF NOT EXISTS delivered_to    TEXT NULL,
  ADD COLUMN IF NOT EXISTS next_attempt_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS dead_lettered_at TIMESTAMPTZ NULL;

-- Index for worker query: undelivered, not dead-lettered, next_attempt_at <= now()
CREATE INDEX IF NOT EXISTS buddy_outbox_events_worker_idx
  ON public.buddy_outbox_events (delivered_at, dead_lettered_at, next_attempt_at, created_at)
  WHERE delivered_at IS NULL AND dead_lettered_at IS NULL;
