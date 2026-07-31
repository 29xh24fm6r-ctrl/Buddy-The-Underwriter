BEGIN;

-- Borrower Intake Program audit fix (SPEC-M8 ARTIFACT-PIPELINE-1 follow-up)
--
-- generateProjectionsAssumptionsNarrative (src/lib/methodology/
-- projectionsAssumptionsNarrative.ts) was built as the one net-new
-- narrative in SPEC-M8 (the other three artifacts — credit memo, business
-- plan, feasibility — already had generators before that spec) but was
-- never actually called from sbaPackageOrchestrator.ts's real package
-- assembly, and buddy_sba_packages had no column to hold it. This adds
-- that column, mirroring every other narrative column's plain-text shape
-- (business_overview_narrative, sensitivity_narrative, franchise_section,
-- etc.) — the generator's own {status, narrative, disclaimer} tagged
-- union is resolved to just the narrative text (or null when not
-- "ready") before persisting, same as franchise_section's pattern.

ALTER TABLE public.buddy_sba_packages
  ADD COLUMN IF NOT EXISTS projections_assumptions_narrative text;

COMMIT;
