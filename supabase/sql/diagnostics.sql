-- =============================================================================
-- Buddy Deal Diagnostics
-- Run in Supabase SQL Editor for any deal_id to diagnose pricing/facts/snapshot state.
-- Replace $DEAL_ID with the actual deal UUID.
-- =============================================================================

-- Usage: SET session variables or find-replace $DEAL_ID
-- Example: Replace $DEAL_ID with '0e9070f3-9fc9-44c9-b673-75a787f74014'

-- ─── 1. Deal overview ────────────────────────────────────────────────────────
SELECT
  d.id AS deal_id,
  d.bank_id,
  d.borrower_name,
  d.status,
  d.stage,
  d.created_at
FROM public.deals d
WHERE d.id = '$DEAL_ID';

-- ─── 2. Financial facts summary ──────────────────────────────────────────────
SELECT
  count(*) AS total_facts,
  count(DISTINCT fact_type) AS distinct_fact_types,
  count(DISTINCT fact_key) AS distinct_fact_keys,
  min(created_at) AS oldest_fact,
  max(created_at) AS newest_fact
FROM public.deal_financial_facts
WHERE deal_id = '$DEAL_ID';

-- ─── 3. Facts by owner_type / owner_entity_id ───────────────────────────────
SELECT
  owner_type,
  owner_entity_id,
  count(*) AS fact_count,
  count(DISTINCT fact_type) AS fact_types,
  count(DISTINCT fact_key) AS fact_keys
FROM public.deal_financial_facts
WHERE deal_id = '$DEAL_ID'
GROUP BY owner_type, owner_entity_id
ORDER BY fact_count DESC;

-- ─── 4. Facts by fact_type / source ─────────────────────────────────────────
SELECT
  fact_type,
  count(*) AS count,
  count(DISTINCT fact_key) AS keys,
  min(created_at) AS oldest,
  max(created_at) AS newest
FROM public.deal_financial_facts
WHERE deal_id = '$DEAL_ID'
GROUP BY fact_type
ORDER BY count DESC;

-- ─── 5. Spreads summary ─────────────────────────────────────────────────────
SELECT
  spread_type,
  status,
  owner_type,
  owner_entity_id,
  updated_at
FROM public.deal_spreads
WHERE deal_id = '$DEAL_ID'
ORDER BY spread_type, owner_type;

-- ─── 6. Spread jobs (latest 5) ──────────────────────────────────────────────
SELECT
  id,
  status,
  requested_spread_types,
  started_at,
  finished_at,
  error,
  created_at
FROM public.deal_spread_jobs
WHERE deal_id = '$DEAL_ID'
ORDER BY created_at DESC
LIMIT 5;

-- ─── 7. Financial snapshots ─────────────────────────────────────────────────
SELECT
  id,
  bank_id,
  created_at,
  as_of_timestamp
FROM public.financial_snapshots
WHERE deal_id = '$DEAL_ID'
ORDER BY created_at DESC
LIMIT 5;

-- ─── 8. Financial snapshot decisions ─────────────────────────────────────────
SELECT
  id,
  snapshot_id,
  bank_id,
  created_at
FROM public.financial_snapshot_decisions
WHERE deal_id = '$DEAL_ID'
ORDER BY created_at DESC
LIMIT 5;

-- ─── 9. Pricing scenarios ───────────────────────────────────────────────────
SELECT
  id,
  scenario_key,
  product_type,
  financial_snapshot_id,
  created_at
FROM public.pricing_scenarios
WHERE deal_id = '$DEAL_ID'
ORDER BY created_at DESC;

-- ─── 10. Pricing decisions ──────────────────────────────────────────────────
SELECT
  id,
  decision,
  rationale,
  pricing_scenario_id,
  decided_by,
  decided_at
FROM public.pricing_decisions
WHERE deal_id = '$DEAL_ID';

-- ─── 11. Legacy pricing quotes ──────────────────────────────────────────────
SELECT
  id,
  status,
  all_in_rate_pct,
  spread_bps,
  locked_at,
  lock_reason,
  created_at
FROM public.deal_pricing_quotes
WHERE deal_id = '$DEAL_ID'
ORDER BY created_at DESC
LIMIT 5;

-- ─── 12. Document count + classified types ──────────────────────────────────
SELECT
  count(*) AS total_docs,
  count(*) FILTER (WHERE canonical_type IS NOT NULL) AS classified,
  count(*) FILTER (WHERE canonical_type IS NULL) AS unclassified
FROM public.deal_documents
WHERE deal_id = '$DEAL_ID';

-- ─── 13. Pipeline ledger (recent events) ────────────────────────────────────
SELECT
  event_key,
  status,
  ui_state,
  ui_message,
  created_at
FROM public.deal_pipeline_ledger
WHERE deal_id = '$DEAL_ID'
ORDER BY created_at DESC
LIMIT 20;

-- ─── 14. Loan requests ─────────────────────────────────────────────────────
SELECT
  id,
  status,
  requested_amount,
  product_type,
  created_at
FROM public.deal_loan_requests
WHERE deal_id = '$DEAL_ID'
ORDER BY created_at DESC
LIMIT 5;
