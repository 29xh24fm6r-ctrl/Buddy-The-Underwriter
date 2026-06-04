-- SPEC-BIE-COMMITTEE-EVIDENCE-REVIEW-ACTIONS-1
-- Controlled banker/analyst review actions for committee evidence tasks. Adds
-- durable review state on buddy_research_committee_tasks plus an append-only
-- audit trail. Collection/review-only: NEVER changes trust_grade, gate_passed,
-- preliminary_eligible, committee_eligible, and NEVER auto-clears a committee
-- blocker. Service-role written (RLS off, like the rest of the research tables).

-- ── Review state on the task ─────────────────────────────────────────────────
ALTER TABLE public.buddy_research_committee_tasks
  ADD COLUMN IF NOT EXISTS review_status text NOT NULL DEFAULT 'unreviewed'
    CHECK (review_status IN (
      'unreviewed','accepted','rejected','weak_source',
      'wrong_entity','committee_grade','needs_more_evidence'
    )),
  ADD COLUMN IF NOT EXISTS reviewed_by              text,
  ADD COLUMN IF NOT EXISTS reviewed_at              timestamptz,
  ADD COLUMN IF NOT EXISTS review_note              text,
  ADD COLUMN IF NOT EXISTS review_reason            text,
  ADD COLUMN IF NOT EXISTS committee_grade_accepted boolean NOT NULL DEFAULT false;

-- ── Append-only review audit trail ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.buddy_research_committee_task_reviews (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id                uuid NOT NULL REFERENCES public.buddy_research_committee_tasks(id) ON DELETE CASCADE,
  mission_id             uuid NOT NULL,
  deal_id                uuid NOT NULL,
  action                 text NOT NULL
                           CHECK (action IN (
                             'accept','reject','mark_weak_source','mark_wrong_entity',
                             'mark_committee_grade','request_more_evidence','reset_review'
                           )),
  previous_review_status text,
  new_review_status      text NOT NULL,
  note                   text,
  reason                 text,
  actor_id               text,
  created_at             timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_brctr_task ON public.buddy_research_committee_task_reviews (task_id);
CREATE INDEX IF NOT EXISTS idx_brctr_deal ON public.buddy_research_committee_task_reviews (deal_id);
CREATE INDEX IF NOT EXISTS idx_brctr_mission ON public.buddy_research_committee_task_reviews (mission_id);
