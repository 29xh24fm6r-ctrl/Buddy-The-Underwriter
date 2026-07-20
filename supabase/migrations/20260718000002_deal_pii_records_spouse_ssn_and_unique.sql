-- Closes the "spouse SSN" gap flagged in
-- docs/sba-forms/TASK-B-ACROFORM-FIELD-VERIFICATION.md §9: Form 413 has a
-- second, independent full-SSN field for a joint/spouse signer
-- ("Social Security No_2" on the real PDF, already mapped in
-- form413/pdfFieldMap.ts) with nowhere to store the value. Reuses the
-- existing deal_pii_records vault rather than a new table — the spouse's
-- SSN is keyed off the SAME ownership_entity_id as the primary signer
-- (their own row already carries has_spouse/spouse_full_name), just a
-- different pii_type, exactly like full_ssn vs full_tin today.
--
-- Also fixes a latent bug found while doing this: storeSecurePii()
-- (src/lib/builder/secure/securePiiIntake.ts) upserts with
-- onConflict: "deal_id,ownership_entity_id,pii_type", but no unique
-- constraint on those columns ever existed — Postgres requires one for
-- ON CONFLICT to work, so every upsert would have thrown at runtime.
BEGIN;

ALTER TABLE public.deal_pii_records
  DROP CONSTRAINT IF EXISTS deal_pii_records_pii_type_check;

ALTER TABLE public.deal_pii_records
  ADD CONSTRAINT deal_pii_records_pii_type_check
  CHECK (pii_type IN ('full_ssn', 'full_tin', 'spouse_full_ssn', 'dob_verified', 'identity_ref'));

ALTER TABLE public.deal_pii_records
  ADD CONSTRAINT deal_pii_records_deal_entity_type_uniq
  UNIQUE (deal_id, ownership_entity_id, pii_type);

COMMIT;
