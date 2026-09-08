-- verification_input_hash: content fingerprint for artifact review reuse
-- -----------------------------------------------------------------------------
-- Allows a re-commission on byte-identical content to skip the review gate
-- rather than re-rolling a ~39% pass rate against unchanged evidence.
--
-- SHA-256 of (artifactType, facts, sections) is stored alongside each verdict.
-- A subsequent run that assembles identical content reads the prior pass instead
-- of spending another Gemini review cycle.
--
-- Ref: frontierArtifactFactory.ts reviewContentHash(), enrichBusinessPlanPackage,
--      enrichFeasibilityStudy.
-- -----------------------------------------------------------------------------

ALTER TABLE buddy_sba_packages
  ADD COLUMN IF NOT EXISTS verification_input_hash text;

ALTER TABLE buddy_feasibility_studies
  ADD COLUMN IF NOT EXISTS verification_input_hash text;

CREATE INDEX IF NOT EXISTS idx_buddy_sba_packages_verification_input_hash
  ON buddy_sba_packages (verification_input_hash)
  WHERE verification_input_hash IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_buddy_feasibility_studies_verification_input_hash
  ON buddy_feasibility_studies (verification_input_hash)
  WHERE verification_input_hash IS NOT NULL;

COMMENT ON COLUMN buddy_sba_packages.verification_input_hash IS
  'SHA-256 of (artifactType, facts, sections) at review time. '
  'Identical hash = identical content = prior pass verdict is reusable.';

COMMENT ON COLUMN buddy_feasibility_studies.verification_input_hash IS
  'SHA-256 of (artifactType, facts, sections) at review time. '
  'Identical hash = identical content = prior pass verdict is reusable.';
