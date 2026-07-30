-- SPEC-M8 ARTIFACT-PIPELINE-1 — additive columns for feasibility-study
-- narrative citation attribution + verifier-pass results. Both computed
-- post-hoc (in the generate route, after generateFeasibilityStudy already
-- persisted the row via feasibilityEngine.ts) and written via a single
-- UPDATE — feasibilityEngine.ts itself is untouched.
BEGIN;

ALTER TABLE public.buddy_feasibility_studies
  ADD COLUMN IF NOT EXISTS narrative_citations jsonb,
  ADD COLUMN IF NOT EXISTS verification_verdict text,
  ADD COLUMN IF NOT EXISTS verification_flagged_claims jsonb;

COMMIT;
