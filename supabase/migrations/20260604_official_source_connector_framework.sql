-- SPEC-BIE-OFFICIAL-SOURCE-CONNECTOR-FRAMEWORK-1
-- Extends the source snapshot ledger with connector metadata so Buddy-native
-- official/free source connectors (manual URL, SOS/registry, adverse screen,
-- gov-data candidate planner, competitor) can link snapshots to committee tasks,
-- carry limitations + candidate metadata, and record an advisory entity-match
-- score. Collection-only: NEVER sets committee_grade_accepted, never changes the
-- gate, never auto-clears a committee blocker. Existing website snapshots keep
-- working (all new columns are nullable / defaulted).

ALTER TABLE public.buddy_research_source_snapshots
  ADD COLUMN IF NOT EXISTS task_id            uuid REFERENCES public.buddy_research_committee_tasks(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS connector_kind     text,
  ADD COLUMN IF NOT EXISTS connector_mode     text,
  ADD COLUMN IF NOT EXISTS source_domain      text,
  ADD COLUMN IF NOT EXISTS source_title       text,
  ADD COLUMN IF NOT EXISTS entity_match_score numeric,
  ADD COLUMN IF NOT EXISTS credibility_rating text,
  ADD COLUMN IF NOT EXISTS limitations        jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS candidate_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS reviewed_status    text,
  ADD COLUMN IF NOT EXISTS reviewed_at        timestamptz,
  ADD COLUMN IF NOT EXISTS reviewed_by        text;

CREATE INDEX IF NOT EXISTS idx_brss_task ON public.buddy_research_source_snapshots (task_id);

-- Widen the status CHECK so connectors can record candidate / manual_attestation
-- snapshots in addition to the existing pending / collected / failed.
ALTER TABLE public.buddy_research_source_snapshots
  DROP CONSTRAINT IF EXISTS buddy_research_source_snapshots_status_check;
ALTER TABLE public.buddy_research_source_snapshots
  ADD CONSTRAINT buddy_research_source_snapshots_status_check
  CHECK (status IN ('pending','collected','failed','candidate','manual_attestation'));
