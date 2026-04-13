-- Phase 72B: Unified agent workflow runs view
--
-- Operator Console — single surface across all agent workflow run tables.
-- No shadow table, no client joins. Postgres VIEW only.

CREATE OR REPLACE VIEW agent_workflow_runs AS

-- Research missions
SELECT
  id,
  deal_id,
  bank_id,
  'research_bundle_generation'::text AS workflow_code,
  status,
  created_at,
  NULL::numeric AS cost_usd,
  NULL::integer AS input_tokens,
  NULL::integer AS output_tokens,
  NULL::text AS model_used
FROM buddy_research_missions

UNION ALL

-- Document extraction runs
SELECT
  id,
  deal_id,
  NULL::uuid AS bank_id,
  'document_extraction'::text,
  status,
  created_at,
  (metrics->>'cost_estimate_usd')::numeric,
  (metrics->>'tokens_in')::integer,
  (metrics->>'tokens_out')::integer,
  NULL::text
FROM deal_extraction_runs

UNION ALL

-- Reconciliation results
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

-- Canonical action executions
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

-- Borrower request campaigns
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

-- Draft borrower requests
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
  'Unified view across all agent workflow run tables. Phase 72B Operator Console. Single source of truth — no shadow tables.';
