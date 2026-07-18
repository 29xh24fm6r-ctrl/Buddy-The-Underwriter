-- Closes gap #4 (Form 155) from
-- docs/sba-forms/TASK-B-ACROFORM-FIELD-VERIFICATION.md §9. Verified
-- against the real uploaded PDF (docs/sba-forms/155-fields.json,
-- visually confirmed via a rendered fill-test): the real, current
-- (9/98) revision has exactly ONE substantive decision — which of 4
-- numbered payment-deferral arrangements the standby creditor agrees to
-- (a single "Agree" radio group, options 1-4) — not the boolean
-- full_standby_for_loan_term / free-standing subordination-acknowledgment
-- checkbox the old fields.ts modeled; those don't exist as distinct
-- fields on this revision. seller_note_full_standby is left untouched
-- (src/lib/sba/dealDataBuilder.ts depends on it for other underwriting
-- output); note_date and note_interest_rate are also left untouched but
-- reinterpreted correctly in code (note_date -> Agree4Date, the "beginning
-- on ___" blank for option 4; note_interest_rate -> whichever of
-- Agree2/3/4Percent applies).
--
-- New columns for concepts the old model had no home for at all: which
-- numbered option was actually agreed to, and the dollar interest amount
-- (distinct from a rate) owed as of the agreement per the form's own
-- "owes $__ principal and $__ interest" paragraph.
BEGIN;

ALTER TABLE public.deal_loan_requests
  ADD COLUMN IF NOT EXISTS standby_agreement_option text CHECK (standby_agreement_option IN ('1', '2', '3', '4')),
  ADD COLUMN IF NOT EXISTS standby_note_interest_amount numeric;

COMMIT;
