-- =========================================================
-- Lifecycle Bootstrap: auto-create deal_status on deal INSERT
--
-- Problem: deals can be created via multiple paths (POST /api/deals,
-- deal_bootstrap_create RPC, builder mint, sandbox seed) but NONE
-- of them create the deal_status row. The lifecycle engine then
-- returns "Deal not found" because the deal_status FK join fails.
--
-- Solution: A database trigger that atomically creates the deal_status
-- row whenever a deal is inserted. This is the single most robust
-- approach because:
--   - Atomic with deal creation (same transaction)
--   - Works regardless of which client/runtime creates the deal
--   - Impossible to miss (future creation paths automatically covered)
--   - Idempotent (ON CONFLICT DO NOTHING)
--
-- Also backfills deal_status for all existing deals that are missing it.
--
-- This is idempotent and safe to re-run.
-- =========================================================

-- 1. Create the trigger function
CREATE OR REPLACE FUNCTION public.auto_create_deal_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO public.deal_status (deal_id, stage, updated_at)
  VALUES (NEW.id, 'intake', now())
  ON CONFLICT (deal_id) DO NOTHING;
  RETURN NEW;
END;
$$;

-- 2. Create the trigger (idempotent: drop first if exists)
DROP TRIGGER IF EXISTS trg_auto_create_deal_status ON public.deals;

CREATE TRIGGER trg_auto_create_deal_status
  AFTER INSERT ON public.deals
  FOR EACH ROW
  EXECUTE FUNCTION public.auto_create_deal_status();

-- 3. Backfill: create deal_status for any existing deals missing it
INSERT INTO public.deal_status (deal_id, stage, updated_at)
SELECT d.id, 'intake', now()
FROM public.deals d
LEFT JOIN public.deal_status ds ON ds.deal_id = d.id
WHERE ds.deal_id IS NULL
ON CONFLICT (deal_id) DO NOTHING;
