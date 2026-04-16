-- Phase 82: Proof of Truth — Memo Evidence Metadata
--
-- Stores per-memo evidence-coverage metrics (support ratio, contradiction
-- strength summary, downgrade reasons) for auditability. This is the
-- measurable proxy for "is this memo actually supported?" that Gate 9 and
-- Gate 10 operate on at generation time.
--
-- Shape:
-- {
--   "evidenceSupportRatio": 0.91,
--   "unsupportedSections": 1,
--   "weakSections": 2,
--   "totalSections": 11,
--   "contradictionStrongRatio": 0.75,
--   "contradictionStrongCount": 6,
--   "contradictionWeakCount": 1,
--   "contradictionNoneCount": 1,
--   "downgradeReasons": ["evidence_coverage_below_threshold (...)"],
--   "evaluatedAt": "2026-04-16T..."
-- }

ALTER TABLE public.canonical_memo_narratives
  ADD COLUMN IF NOT EXISTS metadata_json JSONB DEFAULT NULL;

COMMENT ON COLUMN public.canonical_memo_narratives.metadata_json IS
  'Phase 82: Memo evidence metadata — support ratio, contradiction strength, downgrade reasons. Used for audit CLI and dashboards.';
