-- SPEC-BIE-SOURCE-SNAPSHOT-TO-LOAN-FILE-ARTIFACT-1
-- Durable loan-file artifact for collected official/public source snapshots. A
-- source snapshot row alone is not committee-grade loan-file evidence; this
-- captures each collected snapshot as a banker-visible, durable evidence
-- receipt (HTML stored inline → retrievable later, independent of the live site).
--
-- Deliberately a RESEARCH-domain table (NOT deal_documents): deal_documents is
-- heavily wired into intake/classification/checklist/readiness with many CHECK
-- constraints + a checklist-key trigger; inserting research artifacts there
-- would risk borrower-document readiness/classification (an explicit non-goal).
-- The artifact is surfaced in the loan-file/evidence UI separately so source
-- provenance is never confused with borrower-uploaded docs. (Follow-up:
-- SPEC-RESEARCH-ARTIFACT-DEAL-DOCUMENTS-INTEGRATION-1 to also mirror into the
-- document model if desired.) Service-role written (RLS off, like the rest of
-- the buddy_research_* family). Never changes committee scoring / gate state.

CREATE TABLE IF NOT EXISTS public.buddy_research_source_artifacts (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id            uuid NOT NULL,
  mission_id         uuid,
  source_snapshot_id uuid NOT NULL REFERENCES public.buddy_research_source_snapshots(id) ON DELETE CASCADE,
  task_id            uuid REFERENCES public.buddy_research_committee_tasks(id) ON DELETE SET NULL,
  artifact_type      text NOT NULL DEFAULT 'RESEARCH_SOURCE_SNAPSHOT'
                       CHECK (artifact_type IN ('RESEARCH_SOURCE_SNAPSHOT','COMMITTEE_EVIDENCE_SOURCE')),
  title              text NOT NULL,
  source_url         text,
  source_type        text,
  source_domain      text,
  connector_kind     text,
  connector_mode     text,
  http_status        integer,
  content_hash       text,
  captured_at        timestamptz NOT NULL DEFAULT now(),
  status             text NOT NULL DEFAULT 'captured'
                       CHECK (status IN ('captured','available','ready')),
  artifact_html      text NOT NULL,                       -- durable evidence receipt
  excerpt            text,
  limitations        jsonb NOT NULL DEFAULT '[]'::jsonb,
  candidate_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  review_status      text,
  created_by         text NOT NULL DEFAULT 'buddy_system',
  created_at         timestamptz NOT NULL DEFAULT now(),
  -- Idempotency: at most one artifact per source snapshot.
  UNIQUE (source_snapshot_id)
);
CREATE INDEX IF NOT EXISTS idx_brsa_deal ON public.buddy_research_source_artifacts (deal_id);
CREATE INDEX IF NOT EXISTS idx_brsa_mission ON public.buddy_research_source_artifacts (mission_id);
CREATE INDEX IF NOT EXISTS idx_brsa_task ON public.buddy_research_source_artifacts (task_id);

-- Back-links (both directions per spec).
ALTER TABLE public.buddy_research_source_snapshots
  ADD COLUMN IF NOT EXISTS artifact_id uuid REFERENCES public.buddy_research_source_artifacts(id) ON DELETE SET NULL;
ALTER TABLE public.buddy_research_committee_tasks
  ADD COLUMN IF NOT EXISTS source_artifact_id uuid REFERENCES public.buddy_research_source_artifacts(id) ON DELETE SET NULL;
