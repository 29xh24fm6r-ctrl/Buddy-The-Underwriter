-- Phase 84 T-10 Part B — Test-data flag on deals
--
-- Adds is_test boolean to deals + partial index for non-test filtering +
-- flags the 5 known "ChatGPT Fix %" deals. Prerequisite for T-08 governance
-- smoke test, which needs a reliable way to distinguish real deals from
-- test fixtures when driving fake approvals.
--
-- Spec deviation from v2: original v2 UPDATE included `OR duplicate_of IS NOT NULL`
-- but `duplicate_of` is a T-06 column that does not yet exist. Clause removed
-- here; T-06 is responsible for flagging duplicate deals in its own cleanup
-- step when it adds the `duplicate_of` column.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS, CREATE INDEX IF NOT EXISTS, UPDATE on
-- matched-by-name ChatGPT Fix rows is a no-op if already is_test=true.
--
-- Applied out-of-band via Supabase MCP execute_sql prior to this file
-- landing in the repo; this file exists for dev/staging parity and future
-- reproduction. See docs/archive/phase-84/AAR_PHASE_84_T10B.md.

ALTER TABLE public.deals
  ADD COLUMN IF NOT EXISTS is_test boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_deals_is_test
  ON public.deals (is_test)
  WHERE is_test = false;

UPDATE public.deals
  SET is_test = true
WHERE name ILIKE 'ChatGPT Fix%';

COMMENT ON COLUMN public.deals.is_test IS
  'Test-data flag. Production dashboards and analytics queries should filter WHERE is_test = false. '
  'Set to true for deals created by test fixtures / smoke scripts. '
  'T-06 is responsible for also stamping is_test=true on deals whose duplicate_of is set, '
  'when the duplicate_of column exists.';
