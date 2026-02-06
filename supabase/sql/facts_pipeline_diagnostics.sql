-- =============================================================================
-- Facts Pipeline Diagnostics
-- Run in Supabase SQL Editor to diagnose facts, artifacts, jobs, and ledger state.
-- These are global (cross-deal) queries — no deal_id filter needed.
-- =============================================================================

-- ─── 1. FACTS: global count ────────────────────────────────────────────────
SELECT count(*) AS facts_count FROM public.deal_financial_facts;

-- ─── 2. FACTS: by deal ─────────────────────────────────────────────────────
SELECT deal_id, count(*) AS facts_count
FROM public.deal_financial_facts
GROUP BY 1
ORDER BY 2 DESC
LIMIT 50;

-- ─── 3. ARTIFACTS: status distribution ──────────────────────────────────────
SELECT status, count(*)
FROM public.document_artifacts
GROUP BY 1
ORDER BY 2 DESC;

-- ─── 4. ARTIFACTS: by doc_type / status ─────────────────────────────────────
SELECT doc_type, status, count(*)
FROM public.document_artifacts
GROUP BY 1, 2
ORDER BY 3 DESC;

-- ─── 5. JOBS: job_type / status distribution ────────────────────────────────
SELECT job_type, status, count(*)
FROM public.document_jobs
GROUP BY 1, 2
ORDER BY 3 DESC;

-- ─── 6. JOBS: recent failures ───────────────────────────────────────────────
SELECT id, deal_id, job_type, status, attempt, error, created_at
FROM public.document_jobs
WHERE status = 'failed'
ORDER BY created_at DESC
LIMIT 50;

-- ─── 7. LEDGER: recent errors / warnings ────────────────────────────────────
SELECT created_at, deal_id, event_key, ui_state, ui_message
FROM public.deal_pipeline_ledger
WHERE ui_state IN ('error', 'warn')
ORDER BY created_at DESC
LIMIT 200;
