-- Phase 84 T-06 — Idempotency guard schema (mirror of out-of-band application)
--
-- This migration mirrors DDL that was applied directly to production via
-- `execute_sql` (not `apply_migration`) during T-06 pre-work on 2026-04-20.
-- It is idempotent so it can safely run against dev/staging databases that
-- do not yet have these columns, and it is a no-op on production.
--
-- Changes:
--   1. `deals.created_by_user_id` (text, nullable) — creator tracking
--   2. `deals.duplicate_of` (uuid, nullable, FK deals.id) — soft duplicate pointer
--   3. Backfill `created_by_user_id` from deal_upload_sessions (earliest session wins)
--   4. `idx_deals_dedup_lookup` — partial index supporting RPC/app-layer dedup
--   5. Flag the 3 later Ellmann duplicates (2026-04-15 banker re-submit cluster)
--      Canonical = 7d76458d (oldest). is_test=true for all 4 (T-10B coordination).
--
-- Part 2 of T-06 (RPC body replacement for deal_bootstrap_create) ships in a
-- separate migration so the RPC change is atomic and reviewable on its own.

BEGIN;

-- 1 + 2. Columns
ALTER TABLE public.deals
  ADD COLUMN IF NOT EXISTS created_by_user_id text,
  ADD COLUMN IF NOT EXISTS duplicate_of uuid REFERENCES public.deals(id);

-- 3. Backfill created_by_user_id from the earliest upload session per deal
UPDATE public.deals d
SET created_by_user_id = dus.created_by_user_id
FROM (
  SELECT DISTINCT ON (deal_id) deal_id, created_by_user_id
  FROM public.deal_upload_sessions
  WHERE created_by_user_id IS NOT NULL
  ORDER BY deal_id, created_at ASC
) dus
WHERE d.id = dus.deal_id
  AND d.created_by_user_id IS NULL;

-- 4. Dedup lookup index (partial — ignores already-flagged duplicates)
CREATE INDEX IF NOT EXISTS idx_deals_dedup_lookup
  ON public.deals (bank_id, created_by_user_id, lower(trim(name)), created_at DESC)
  WHERE duplicate_of IS NULL;

-- 5. Flag the Ellmann duplicate cluster (deferred from T-10B)
--    Canonical = 7d76458d-812e-425d-8fce-1cbe966968a6 (oldest, 2026-04-15 20:50:08)
--    Fact re-parenting (540 facts, 1213 events, 8 tables, 1883 rows total) is
--    deferred to Phase 84.1 — out of scope for the idempotency guard ticket.
UPDATE public.deals
SET duplicate_of = '7d76458d-812e-425d-8fce-1cbe966968a6',
    is_test = true
WHERE id IN (
  'a95c03db-2dcf-49b7-89fe-03cc0e09da71',  -- 21:25:21, 0 facts
  '7df74c12-62cb-478d-bf5b-3169b85c12f1',  -- 21:41:11, 266 facts
  'df0c0867-989b-4897-a22c-2d29a0c9584c'   -- 22:09:56, 274 facts
)
AND duplicate_of IS NULL;  -- idempotent: skip if already flagged

-- Also flag the canonical as test data (empty shell from T-02 classifier bug era)
UPDATE public.deals
SET is_test = true
WHERE id = '7d76458d-812e-425d-8fce-1cbe966968a6'
  AND is_test = false;  -- idempotent

-- Column documentation
COMMENT ON COLUMN public.deals.created_by_user_id IS
  'Clerk user id of the banker/operator who created the deal. Added Phase 84 T-06 for dedup scoping. Backfilled from deal_upload_sessions.created_by_user_id (earliest session wins). New deals populate this via deal_bootstrap_create RPC and direct .insert() paths.';

COMMENT ON COLUMN public.deals.duplicate_of IS
  'Soft duplicate pointer. If non-null, this deal is a duplicate of the referenced canonical deal. Set by the T-06 idempotency guard (RPC-level + app-layer helper). Readers should filter WHERE duplicate_of IS NULL for canonical results. Fact re-parenting (moving financial facts, documents, events from duplicate to canonical) is a separate concern tracked in Phase 84.1.';

COMMIT;
