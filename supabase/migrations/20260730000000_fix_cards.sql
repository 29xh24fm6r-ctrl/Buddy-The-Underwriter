BEGIN;

-- ============================================================
-- SPEC-M4 FIX-CARDS-1 — borrower-facing deterministic issue cards.
--
-- Two additive changes:
--   1. quality_flags column on deal_model_snapshots — the data-quality
--      diagnostics already computed by buildFinancialModel() (FinancialPeriod
--      .qualityFlags) were never persisted; only computed_metrics/risk_flags
--      were. Threaded through in persistModelV2SnapshotFromDeal.ts.
--   2. fix_card_copy_cache — "why a lender cares" prose cached per
--      issue_type (not per deal): written once, reused across every deal
--      that hits the same issue. First instance of this cache pattern in
--      the repo.
-- ============================================================

ALTER TABLE public.deal_model_snapshots
  ADD COLUMN IF NOT EXISTS quality_flags JSONB NOT NULL DEFAULT '[]';

COMMENT ON COLUMN public.deal_model_snapshots.quality_flags IS
  'SPEC-M4 FIX-CARDS-1: FinancialPeriod.qualityFlags (buildFinancialModel.ts) from the latest period at snapshot time — data-quality diagnostics (e.g. BALANCE_SHEET_IMBALANCE), distinct from risk_flags (threshold breaches like DSCR-below-minimum).';

CREATE TABLE IF NOT EXISTS public.fix_card_copy_cache (
  issue_type TEXT PRIMARY KEY,
  copy TEXT NOT NULL,
  model TEXT NOT NULL,
  verified BOOLEAN NOT NULL DEFAULT false,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.fix_card_copy_cache IS
  'SPEC-M4 FIX-CARDS-1: "why a lender cares" prose cached per issue_type, not per deal — written once via the AI gateway generator+verifier roles, reused by every deal that surfaces the same issue_type. Written by src/lib/ai/fixCardCopyCache.ts.';

ALTER TABLE public.fix_card_copy_cache ENABLE ROW LEVEL SECURITY;

COMMIT;
