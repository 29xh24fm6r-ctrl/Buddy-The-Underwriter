-- SPEC-COMMITTEE-ACTION-CENTER-WORKFLOW-RESOLUTION-1
--
-- In-place blocker resolution adds three banker-attested resolution actions that
-- the existing review actions cannot express:
--   * record_screening_result   — record an adverse / public-records screen result
--                                 (clear / finding / unable_to_verify) on a task
--                                 that has no auto-collectible evidence
--   * submit_analyst_conclusion — the explicit human conclusion that resolves a
--                                 scale-plausibility blocker (auto_clear_forbidden,
--                                 which can never be committee-graded)
--   * banker_override           — an explicit, reasoned banker override
--
-- These resolve via a new review_status `banker_attested`. The conclusion / result
-- / reason text reuses the existing review_note / review_reason columns (no new
-- columns). This is purely the review/attestation layer — it NEVER changes gate
-- scoring, trust grade, committee eligibility, lifecycle, or the blocker engine;
-- the committee-readiness VIEW re-derives "resolved" from this state on read.
--
-- Persistence of these states is impossible under the existing CHECK constraints,
-- so this minimal additive widening is the justified schema change for this spec.

alter table public.buddy_research_committee_task_reviews
  drop constraint if exists buddy_research_committee_task_reviews_action_check;
alter table public.buddy_research_committee_task_reviews
  add constraint buddy_research_committee_task_reviews_action_check
  check (action = any (array[
    'accept', 'reject', 'mark_weak_source', 'mark_wrong_entity',
    'mark_committee_grade', 'request_more_evidence', 'reset_review',
    'record_screening_result', 'submit_analyst_conclusion', 'banker_override'
  ]));

alter table public.buddy_research_committee_tasks
  drop constraint if exists buddy_research_committee_tasks_review_status_check;
alter table public.buddy_research_committee_tasks
  add constraint buddy_research_committee_tasks_review_status_check
  check (review_status = any (array[
    'unreviewed', 'accepted', 'rejected', 'weak_source', 'wrong_entity',
    'committee_grade', 'needs_more_evidence', 'banker_attested'
  ]));
