-- SPEC S2 A-2 — ownership_entities KYC columns: citizenship status (for the
-- S1 citizenship/lookback rules), DOB, place of birth, and home address
-- (Form 1919 Section II / Form 912 trigger fields).
BEGIN;
ALTER TABLE public.ownership_entities
  ADD COLUMN IF NOT EXISTS citizenship_status text
    CHECK (citizenship_status IS NULL OR citizenship_status IN
      ('us_citizen','us_national','lawful_permanent_resident',
       'visa_holder','asylee','refugee','daca','other_ineligible','unknown')),
  ADD COLUMN IF NOT EXISTS date_of_birth date,
  ADD COLUMN IF NOT EXISTS place_of_birth text,
  ADD COLUMN IF NOT EXISTS home_address_street text,
  ADD COLUMN IF NOT EXISTS home_address_city text,
  ADD COLUMN IF NOT EXISTS home_address_state text,
  ADD COLUMN IF NOT EXISTS home_address_zip text;

CREATE INDEX IF NOT EXISTS idx_ownership_entities_citizenship
  ON public.ownership_entities(deal_id, citizenship_status);
COMMIT;
