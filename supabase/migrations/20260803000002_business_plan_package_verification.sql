-- SPEC-M8 ARTIFACT-PIPELINE-1 (audit fix) — the business-plan verifier
-- (src/lib/sba/verifyBusinessPlanPackage.ts) was built and tested in the
-- original M8 spec but never actually wired into the real package-generation
-- flow, so buddy_sba_packages never had columns to persist a result into.
-- This adds them, mirroring buddy_feasibility_studies's
-- narrative_citations/verification_verdict/verification_flagged_claims
-- columns (20260803000001_feasibility_citations_and_verification.sql).
BEGIN;

ALTER TABLE public.buddy_sba_packages
  ADD COLUMN IF NOT EXISTS verification_verdict text,
  ADD COLUMN IF NOT EXISTS verification_flagged_claims jsonb;

COMMIT;
