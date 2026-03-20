-- =========================================================
-- DB trigger guard: non-year checklist items can NEVER store years
--
-- Problem: The checklist engine's year extraction regex can leak
-- spurious years (e.g. "2001" from metadata) into non-year items
-- like PFS_CURRENT, AR_AP_AGING, BANK_STMT_3M, causing phantom
-- "Received" counts in the UI.
--
-- Application-level guards exist (isYearBasedItem in engine.ts),
-- but this trigger is the hard DB guarantee: even if the app
-- layer has a bug, the DB will strip satisfied_years on write.
--
-- Non-year items are satisfied by presence, not years:
--   PFS_CURRENT, BANK_STMT_3M, AR_AP_AGING, INSURANCE_CURRENT,
--   and all SBA_* items.
--
-- Year-based items (IRS_*_nY, FIN_STMT_*_nY) are NOT affected.
--
-- This is idempotent and safe to re-run.
-- =========================================================

-- 1. Create the guard function
CREATE OR REPLACE FUNCTION public.guard_non_year_items_no_years()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- Year-based items have _nY suffix (e.g. IRS_1040_3Y, FIN_STMT_3Y)
  -- Everything else is presence-based and must never have satisfied_years
  IF NEW.checklist_key !~ '_\d+Y$' THEN
    NEW.satisfied_years := NULL;
  END IF;
  RETURN NEW;
END;
$$;

-- 2. Create the trigger (idempotent: drop first)
DROP TRIGGER IF EXISTS trg_guard_non_year_items_no_years ON public.deal_checklist_items;

CREATE TRIGGER trg_guard_non_year_items_no_years
  BEFORE INSERT OR UPDATE ON public.deal_checklist_items
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_non_year_items_no_years();

-- 3. Clean up any existing bad data (belt-and-suspenders on top of
-- the earlier 20260201_repair_non_year_satisfied_years.sql migration)
UPDATE public.deal_checklist_items
SET satisfied_years = NULL
WHERE checklist_key !~ '_\d+Y$'
  AND satisfied_years IS NOT NULL
  AND cardinality(satisfied_years) > 0;
