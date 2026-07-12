-- ARC-00 Phase 6 (SPEC S5) PIV-2 — banks.settings didn't exist (confirmed
-- via information_schema; same finding logged repeatedly since Phase 1 for
-- lender_is_federally_regulated/CAIVRS credentials/4506-C recipient info).
-- Adds it now since S5's own PIV-2 anticipated this exact gap and specifies
-- the fix. approved_appraisers/approved_valuators/etc. keys live under
-- this column per-tenant; SBA E-Tran cert storage uses the dedicated
-- bank_etran_credentials table, NOT this column (per spec B-1).
BEGIN;

ALTER TABLE public.banks
  ADD COLUMN IF NOT EXISTS settings jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMIT;
