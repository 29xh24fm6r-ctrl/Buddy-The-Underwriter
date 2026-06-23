-- SPEC-BIE-PERSIST-COMMITTEE-EVIDENCE-TASK-STATUS-1
-- Make the #484 derived committee-task intelligence durable. The enrichment in
-- committeeEvidenceLinkage.ts (resolved_status / file-derived status / linked
-- evidence / coverage checklist) was derived-on-read only, so Supabase showed
-- "1 collected / 9 pending" while the UI displayed rich statuses. These columns
-- persist that enrichment so Supabase and the UI agree.
--
-- Collection-only: this NEVER changes the banker workflow `status` column, gate
-- scoring, committee thresholds, or auto-clears a committee blocker. The derived
-- columns are recomputed (idempotent) on the write path and on read.

ALTER TABLE public.buddy_research_committee_tasks
  ADD COLUMN IF NOT EXISTS resolved_status      text,                       -- composed display status (missing/collected/needs_review/accepted/rejected)
  ADD COLUMN IF NOT EXISTS file_status          text,                       -- file-derived status (missing/collected/needs_review)
  ADD COLUMN IF NOT EXISTS linked_evidence      jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS coverage_checklist   jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS collected_items      jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS missing_items        jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS needs_review_items   jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS auto_clear_forbidden boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS last_linked_at       timestamptz;
