-- Follow-up to 20260718000005: operating_company_address was missed
-- from the original Operating Company column set.
BEGIN;

ALTER TABLE public.deals
  ADD COLUMN IF NOT EXISTS operating_company_address text;

COMMIT;
