-- P0a: separate deal_type from product_type.
--
-- Problem: deals.deal_type defaults to 'SBA', so every new deal is born SBA.
-- Conventional / LOC deals inherit SBA-only checklists and pricing assumptions
-- through the rest of the pipeline. There is also no column to express the
-- *product* (LOC vs term vs SBA 7(a) etc.) independent of the deal program.
--
-- Fix:
--   1. Add deals.product_type (text, NULLABLE).
--   2. Change deals.deal_type default from 'SBA' → 'CONVENTIONAL'.
--      Existing rows are NOT rewritten. Only future inserts use the new default.
--   3. CHECK constraint pins the value sets explicitly so silent typos break.
--
-- Backfill policy: leave product_type NULL on existing rows. The product is a
-- banker decision that depends on collateral + intent; we do not guess. UI is
-- expected to surface "set product type" as a banker action when null.

ALTER TABLE public.deals
  ALTER COLUMN deal_type SET DEFAULT 'CONVENTIONAL';

ALTER TABLE public.deals
  ADD COLUMN IF NOT EXISTS product_type text;

-- Replace the legacy deal_type CHECK constraint.
-- The pre-existing constraint allowed ('SBA','CRE','TERM','LOC','OTHER') which
-- conflated deal-program (SBA vs conventional) with product (CRE/TERM/LOC).
-- New invariant: deal_type carries only the program; product details live in
-- product_type. CRE/TERM/LOC values are treated as bad data going forward.
ALTER TABLE public.deals DROP CONSTRAINT IF EXISTS deals_deal_type_check;
ALTER TABLE public.deals
  ADD CONSTRAINT deals_deal_type_check
  CHECK (deal_type IN ('CONVENTIONAL','SBA'));

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'deals_product_type_check') THEN
    ALTER TABLE public.deals
      ADD CONSTRAINT deals_product_type_check
      CHECK (
        product_type IS NULL OR product_type IN (
          'LINE_OF_CREDIT',
          'TERM_LOAN',
          'CRE',
          'CRE_OWNER_OCCUPIED',
          'CRE_INVESTOR',
          'SBA_7A',
          'SBA_504',
          'SBA_EXPRESS'
        )
      );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_deals_product_type ON public.deals(product_type);

-- Targeted data fix for the deal cited in the P0 spec — conventional LOC deal
-- that was incorrectly stored as SBA.
UPDATE public.deals
   SET deal_type = 'CONVENTIONAL',
       product_type = 'LINE_OF_CREDIT'
 WHERE id = '0d31ebf3-485d-414e-a8ac-9b0e79884944';
