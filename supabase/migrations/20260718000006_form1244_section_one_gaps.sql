-- Closes remaining Form 1244 Section One content gaps found against the
-- real current-revision PDF: 3 of its 5 business-level yes/no questions
-- (affiliates, direct/guaranteed government loan history, prior
-- application for this specific project) have no existing column —
-- distinct from has_pending_sba_application (a different question: SBA
-- applications pending right now, not prior applications for this
-- project specifically).
BEGIN;

ALTER TABLE public.borrowers
  ADD COLUMN IF NOT EXISTS has_affiliates boolean,
  ADD COLUMN IF NOT EXISTS obtained_direct_or_guaranteed_government_loan boolean,
  ADD COLUMN IF NOT EXISTS prior_project_application_submitted boolean,
  ADD COLUMN IF NOT EXISTS prior_project_cdc_lender_name_and_program text;

COMMIT;
