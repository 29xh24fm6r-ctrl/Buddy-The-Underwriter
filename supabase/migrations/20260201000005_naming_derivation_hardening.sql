-- ============================================
-- Naming Derivation Hardening (serverless-safe)
-- ============================================

-- 1) Durable throttle marker (per-deal)
ALTER TABLE public.deals
  ADD COLUMN IF NOT EXISTS last_naming_derivation_at TIMESTAMPTZ;

-- 2) Ensure all naming metadata columns exist (idempotent IF NOT EXISTS)
ALTER TABLE public.deals
  ADD COLUMN IF NOT EXISTS naming_method          TEXT,
  ADD COLUMN IF NOT EXISTS naming_source          TEXT,
  ADD COLUMN IF NOT EXISTS naming_fallback_reason TEXT,
  ADD COLUMN IF NOT EXISTS named_at               TIMESTAMPTZ;

ALTER TABLE public.deal_documents
  ADD COLUMN IF NOT EXISTS naming_method          TEXT,
  ADD COLUMN IF NOT EXISTS naming_source          TEXT,
  ADD COLUMN IF NOT EXISTS naming_confidence      NUMERIC,
  ADD COLUMN IF NOT EXISTS naming_fallback_reason TEXT,
  ADD COLUMN IF NOT EXISTS named_at               TIMESTAMPTZ;

-- 3) Backfill conservative defaults where missing
UPDATE public.deals
SET naming_method = COALESCE(naming_method, CASE
      WHEN name_locked = true THEN 'manual'
      ELSE 'fallback'
    END),
    naming_source = COALESCE(naming_source, CASE
      WHEN name_locked = true THEN 'user'
      ELSE 'system'
    END),
    named_at = COALESCE(named_at, now())
WHERE naming_method IS NULL OR naming_source IS NULL OR named_at IS NULL;

UPDATE public.deal_documents
SET naming_method = COALESCE(naming_method, CASE
      WHEN name_locked = true THEN 'manual'
      ELSE 'filename'
    END),
    naming_source = COALESCE(naming_source, CASE
      WHEN name_locked = true THEN 'user'
      ELSE 'system'
    END),
    named_at = COALESCE(named_at, now())
WHERE naming_method IS NULL OR naming_source IS NULL OR named_at IS NULL;

-- 4) Lightweight index for throttle gating
CREATE INDEX IF NOT EXISTS idx_deals_last_naming_derivation_at
  ON public.deals(last_naming_derivation_at);
