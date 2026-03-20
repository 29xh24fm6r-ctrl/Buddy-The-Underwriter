-- 20260203_docai_provider_metrics.sql
-- Smart Router: Add provider_metrics JSONB to deal_pipeline_ledger for cost tracking

-- Add provider_metrics column for tracking extraction costs per provider
ALTER TABLE public.deal_pipeline_ledger
ADD COLUMN IF NOT EXISTS provider_metrics jsonb;

-- Add index for billing/analytics queries by bank and time
CREATE INDEX IF NOT EXISTS idx_deal_pipeline_ledger_bank_created
ON public.deal_pipeline_ledger (bank_id, created_at DESC);

-- GIN index for querying provider_metrics JSON fields
CREATE INDEX IF NOT EXISTS idx_deal_pipeline_ledger_provider_metrics_gin
ON public.deal_pipeline_ledger USING gin (provider_metrics);

-- Partial index for non-null provider_metrics (efficient billing queries)
CREATE INDEX IF NOT EXISTS idx_deal_pipeline_ledger_provider_metrics_notnull
ON public.deal_pipeline_ledger (bank_id, created_at DESC)
WHERE provider_metrics IS NOT NULL;

COMMENT ON COLUMN public.deal_pipeline_ledger.provider_metrics IS
'JSONB tracking extraction provider costs: { provider, processorType, model, pages, unit_count, estimated_cost_usd }';
