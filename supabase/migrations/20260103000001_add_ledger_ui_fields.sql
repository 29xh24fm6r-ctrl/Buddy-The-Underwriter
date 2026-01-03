-- Add UI-friendly fields to pipeline ledger for narrative async UX
-- Part of Tier 1: Production Readiness (Canonical Document Ingestion)

ALTER TABLE public.deal_pipeline_ledger
ADD COLUMN IF NOT EXISTS event_key TEXT,
ADD COLUMN IF NOT EXISTS ui_state TEXT CHECK (ui_state IN ('working', 'done', 'waiting')),
ADD COLUMN IF NOT EXISTS ui_message TEXT,
ADD COLUMN IF NOT EXISTS meta JSONB DEFAULT '{}'::jsonb;

-- Add index for event-based queries
CREATE INDEX IF NOT EXISTS idx_pipeline_ledger_event_key 
  ON public.deal_pipeline_ledger(event_key);

COMMENT ON COLUMN public.deal_pipeline_ledger.event_key IS 'Machine-readable event identifier (upload_received, ocr_completed, etc)';
COMMENT ON COLUMN public.deal_pipeline_ledger.ui_state IS 'UI display state: working (in progress), done (completed), waiting (blocked)';
COMMENT ON COLUMN public.deal_pipeline_ledger.ui_message IS 'Human-readable message for UI display';
COMMENT ON COLUMN public.deal_pipeline_ledger.meta IS 'Event-specific metadata (replaces payload for new events)';
