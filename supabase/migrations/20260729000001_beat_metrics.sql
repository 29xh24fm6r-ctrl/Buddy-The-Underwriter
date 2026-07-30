BEGIN;

-- ============================================================
-- SPEC-M2 BEAT-METRICS-1 — the five program "beat condition" metrics.
--
-- Widens brokerage_conversion_events' event_type CHECK constraint to add
-- five new metric event types, creates borrower_fact_requests (the
-- repeat_ask_count ledger — needs per-fact-key granularity a generic
-- event log doesn't give you), and adds SQL rollup views following the
-- existing v_deal_match_metrics / v_intake_global_metrics convention
-- (20260219000001_intake_metrics_views.sql).
--
-- Additive only — widens an allowed set, adds a new table, adds views.
-- Nothing existing is renamed or dropped.
-- ============================================================

-- Step 1: widen brokerage_conversion_events.event_type
ALTER TABLE public.brokerage_conversion_events
  DROP CONSTRAINT IF EXISTS brokerage_conversion_events_event_type_check;

ALTER TABLE public.brokerage_conversion_events
  ADD CONSTRAINT brokerage_conversion_events_event_type_check
  CHECK (event_type IN (
    'lead_captured', 'session_started', 'deal_created',
    'concierge_started', 'email_claimed', 'converted',
    -- SPEC-M2 BEAT-METRICS-1 additions:
    'first_interaction', 'readiness_read_rendered', 'formless_start',
    'doc_request_round', 'lender_followup'
  ));

-- Step 2: repeat_ask_count ledger — one row per (deal, fact) request.
CREATE TABLE IF NOT EXISTS public.borrower_fact_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id uuid NOT NULL REFERENCES public.deals(id) ON DELETE CASCADE,
  fact_key text NOT NULL,
  source text,
  requested_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.borrower_fact_requests IS
  'SPEC-M2 BEAT-METRICS-1: one row per (deal, fact_key) request. A fact_key requested more than once per deal is a repeat ask — see v_beat_repeat_ask_by_deal. Written by src/lib/brokerage/beatMetrics.ts:recordFactRequest.';

CREATE INDEX IF NOT EXISTS borrower_fact_requests_deal_fact_idx
  ON public.borrower_fact_requests (deal_id, fact_key);

ALTER TABLE public.borrower_fact_requests ENABLE ROW LEVEL SECURITY;

-- Step 3: rollup views (read-only; service-role/admin dashboard consumers).

-- ttfa_minutes per deal — null until both first_interaction and
-- readiness_read_rendered have fired for that deal (honest "no data yet"
-- pre-SPEC-M3, not a zero).
CREATE OR REPLACE VIEW public.v_beat_ttfa_by_deal AS
SELECT
  first_evt.deal_id,
  first_evt.created_at AS first_interaction_at,
  ready_evt.created_at AS readiness_read_rendered_at,
  EXTRACT(EPOCH FROM (ready_evt.created_at - first_evt.created_at)) / 60.0 AS ttfa_minutes
FROM (
  SELECT deal_id, MIN(created_at) AS created_at
  FROM public.brokerage_conversion_events
  WHERE event_type = 'first_interaction' AND deal_id IS NOT NULL
  GROUP BY deal_id
) first_evt
LEFT JOIN (
  SELECT deal_id, MIN(created_at) AS created_at
  FROM public.brokerage_conversion_events
  WHERE event_type = 'readiness_read_rendered' AND deal_id IS NOT NULL
  GROUP BY deal_id
) ready_evt ON ready_evt.deal_id = first_evt.deal_id;

-- formless_start rate per deal (one row per deal; true/false).
CREATE OR REPLACE VIEW public.v_beat_formless_start_by_deal AS
SELECT DISTINCT ON (deal_id)
  deal_id,
  (metadata->>'formless')::boolean AS formless,
  created_at
FROM public.brokerage_conversion_events
WHERE event_type = 'formless_start' AND deal_id IS NOT NULL
ORDER BY deal_id, created_at ASC;

-- repeat_ask_count per deal — count of distinct fact_keys asked more than once.
CREATE OR REPLACE VIEW public.v_beat_repeat_ask_by_deal AS
SELECT
  deal_id,
  fact_key,
  COUNT(*) AS ask_count
FROM public.borrower_fact_requests
GROUP BY deal_id, fact_key
HAVING COUNT(*) > 1;

-- doc_request_rounds per deal — count of distinct request-round events pre-submission.
CREATE OR REPLACE VIEW public.v_beat_doc_request_rounds_by_deal AS
SELECT
  deal_id,
  COUNT(*) AS doc_request_rounds
FROM public.brokerage_conversion_events
WHERE event_type = 'doc_request_round' AND deal_id IS NOT NULL
GROUP BY deal_id;

-- lender_followup_count per deal — count of manually-logged lender follow-ups.
CREATE OR REPLACE VIEW public.v_beat_lender_followup_by_deal AS
SELECT
  deal_id,
  COUNT(*) AS lender_followup_count
FROM public.brokerage_conversion_events
WHERE event_type = 'lender_followup' AND deal_id IS NOT NULL
GROUP BY deal_id;

-- Bank-wide summary — one row, matching the v_intake_global_metrics shape.
CREATE OR REPLACE VIEW public.v_beat_summary AS
SELECT
  (SELECT ROUND(AVG(ttfa_minutes)::numeric, 1) FROM public.v_beat_ttfa_by_deal WHERE ttfa_minutes IS NOT NULL) AS avg_ttfa_minutes,
  (SELECT COUNT(*) FROM public.v_beat_ttfa_by_deal WHERE ttfa_minutes IS NOT NULL) AS ttfa_deal_count,
  (SELECT ROUND(100.0 * COUNT(*) FILTER (WHERE formless) / NULLIF(COUNT(*), 0), 1) FROM public.v_beat_formless_start_by_deal) AS formless_start_rate_pct,
  (SELECT COUNT(*) FROM public.v_beat_formless_start_by_deal) AS formless_start_deal_count,
  (SELECT COUNT(DISTINCT deal_id) FROM public.v_beat_repeat_ask_by_deal) AS deals_with_repeat_asks,
  (SELECT ROUND(AVG(doc_request_rounds)::numeric, 2) FROM public.v_beat_doc_request_rounds_by_deal) AS avg_doc_request_rounds,
  (SELECT ROUND(AVG(lender_followup_count)::numeric, 2) FROM public.v_beat_lender_followup_by_deal) AS avg_lender_followup_count;

COMMIT;
