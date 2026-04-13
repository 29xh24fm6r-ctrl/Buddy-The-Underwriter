-- Phase 72C: Promote cost metrics from JSONB to top-level columns
--
-- Rule: tokens = source of truth (durable), USD = audit snapshot (point-in-time)
--
-- After this migration, the agent_workflow_runs VIEW is updated to prefer
-- promoted columns over JSONB extraction.

-- ── buddy_research_missions ─────────────────────────────────────────

ALTER TABLE buddy_research_missions
  ADD COLUMN IF NOT EXISTS cost_usd NUMERIC(10,6),
  ADD COLUMN IF NOT EXISTS input_tokens INTEGER,
  ADD COLUMN IF NOT EXISTS output_tokens INTEGER,
  ADD COLUMN IF NOT EXISTS model_used TEXT;

-- ── deal_extraction_runs ────────────────────────────────────────────

ALTER TABLE deal_extraction_runs
  ADD COLUMN IF NOT EXISTS cost_usd NUMERIC(10,6),
  ADD COLUMN IF NOT EXISTS input_tokens INTEGER,
  ADD COLUMN IF NOT EXISTS output_tokens INTEGER;

-- Backfill extraction runs from existing metrics JSONB
UPDATE deal_extraction_runs
SET
  cost_usd = (metrics->>'cost_estimate_usd')::numeric,
  input_tokens = (metrics->>'tokens_in')::integer,
  output_tokens = (metrics->>'tokens_out')::integer
WHERE metrics IS NOT NULL
  AND cost_usd IS NULL;

-- ── Update VIEW to prefer promoted columns ──────────────────────────

CREATE OR REPLACE VIEW agent_workflow_runs AS

-- Research missions (now with promoted columns)
SELECT
  id,
  deal_id,
  bank_id,
  'research_bundle_generation'::text AS workflow_code,
  status,
  created_at,
  cost_usd,
  input_tokens,
  output_tokens,
  model_used
FROM buddy_research_missions

UNION ALL

-- Document extraction runs (prefer promoted, fallback to JSONB)
SELECT
  id,
  deal_id,
  NULL::uuid AS bank_id,
  'document_extraction'::text,
  status,
  created_at,
  COALESCE(cost_usd, (metrics->>'cost_estimate_usd')::numeric),
  COALESCE(input_tokens, (metrics->>'tokens_in')::integer),
  COALESCE(output_tokens, (metrics->>'tokens_out')::integer),
  NULL::text
FROM deal_extraction_runs

UNION ALL

-- Reconciliation results (no cost data)
SELECT
  id,
  deal_id,
  NULL::uuid AS bank_id,
  'cross_doc_reconciliation'::text,
  overall_status,
  created_at,
  NULL::numeric,
  NULL::integer,
  NULL::integer,
  NULL::text
FROM deal_reconciliation_results

UNION ALL

-- Canonical action executions (no cost data)
SELECT
  id,
  deal_id,
  bank_id,
  action_code,
  execution_status,
  created_at,
  NULL::numeric,
  NULL::integer,
  NULL::integer,
  NULL::text
FROM canonical_action_executions

UNION ALL

-- Borrower request campaigns (no cost data)
SELECT
  id,
  deal_id,
  bank_id,
  'borrower_request_campaign'::text,
  status,
  created_at,
  NULL::numeric,
  NULL::integer,
  NULL::integer,
  NULL::text
FROM borrower_request_campaigns

UNION ALL

-- Draft borrower requests (no cost data)
SELECT
  id,
  deal_id,
  NULL::uuid AS bank_id,
  'borrower_draft_request'::text,
  status,
  created_at,
  NULL::numeric,
  NULL::integer,
  NULL::integer,
  NULL::text
FROM draft_borrower_requests;

COMMENT ON VIEW agent_workflow_runs IS
  'Unified view across all agent workflow run tables. Phase 72C: promoted cost columns with JSONB fallback.';
