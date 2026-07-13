-- AP-3 schema-first repair: live sba_policy_rules diverges from both the
-- 20251227000012 CREATE TABLE definition and the 20260428 migration's
-- assumptions. Live table is missing category / borrower_friendly_explanation
-- / fix_suggestions / updated_at, and its program CHECK constraint only
-- allows ('7A','504') even though application code (eligibility.ts) and
-- this migration's own rule set use program='BOTH'. Reconcile additively
-- before the data migration runs.

BEGIN;

ALTER TABLE public.sba_policy_rules
  ADD COLUMN IF NOT EXISTS category text,
  ADD COLUMN IF NOT EXISTS borrower_friendly_explanation text,
  ADD COLUMN IF NOT EXISTS fix_suggestions jsonb,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT NOW();

ALTER TABLE public.sba_policy_rules
  DROP CONSTRAINT IF EXISTS sba_policy_rules_program_check;

ALTER TABLE public.sba_policy_rules
  ADD CONSTRAINT sba_policy_rules_program_check
  CHECK (program IN ('7A', '504', 'BOTH'));

COMMIT;
