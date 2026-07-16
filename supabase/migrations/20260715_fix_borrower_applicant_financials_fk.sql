-- borrower_applicant_financials.applicant_id was FK'd to borrower_applicants(id)
-- — a legacy magic-link-portal table (docs/migrations/002_borrower_portal_foundation.sql)
-- that Brokerage code never writes to. Every actual writer/reader of this
-- table (src/lib/brokerage/propagateBorrowerFacts.ts,
-- src/lib/sba/forms/form413/inputBuilder.ts) has always used
-- applicant_id = ownership_entities.id instead. Confirmed live: 15
-- ownership_entities rows exist, 0 borrower_applicant_financials rows exist
-- despite the concierge writer being live and called on every Brokerage
-- deal — every insert has been silently failing this FK constraint, with
-- the error swallowed by propagateBorrowerFacts.ts's per-field
-- try/catch-into-errors[] pattern (never surfaced to a human).
--
-- Fixes the FK to point at the table every caller already assumes it does.

BEGIN;

ALTER TABLE public.borrower_applicant_financials
  DROP CONSTRAINT IF EXISTS borrower_applicant_financials_applicant_id_fkey;

ALTER TABLE public.borrower_applicant_financials
  ADD CONSTRAINT borrower_applicant_financials_applicant_id_fkey
  FOREIGN KEY (applicant_id) REFERENCES public.ownership_entities(id) ON DELETE CASCADE;

COMMENT ON CONSTRAINT borrower_applicant_financials_applicant_id_fkey
  ON public.borrower_applicant_financials IS
  'Fixed 2026-07-15 — was pointed at the unrelated legacy borrower_applicants table, silently failing every Brokerage PFS write. applicant_id is always an ownership_entities.id in practice.';

COMMIT;
