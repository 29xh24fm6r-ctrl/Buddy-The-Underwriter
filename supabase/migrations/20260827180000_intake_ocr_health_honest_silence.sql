-- Intake OCR health: stop reporting green when nothing is working.
--
-- The previous definition counted only rows in document_ocr_results and fell
-- through to 'green' whenever there were none. Through the 2026-08-20..27
-- intake outage it read green continuously, for two compounding reasons:
--
--   1. OCR never ran, so no row was ever written to document_ocr_results —
--      the failures were recorded as `ocr.skipped` (reason: download_failed)
--      in deal_pipeline_ledger, which this view never looked at.
--   2. Zero activity produced total_24h = 0, and the CASE treated "no signal"
--      as "healthy".
--
-- A monitor that cannot tell silence from success is worse than no monitor:
-- it actively asserts health. This definition:
--   * counts OCR skips from the ledger,
--   * reports 'red' when documents arrived but no OCR ran at all (the exact
--     signature of the outage),
--   * reports 'unknown' when genuinely nothing happened,
--   * keeps the original four columns and their order so existing readers
--     (detectOcrFailures, /api/admin/intake) keep working.

CREATE OR REPLACE VIEW intake_ocr_failures_v1 AS
WITH ocr AS (
  SELECT
    count(*) FILTER (
      WHERE status = 'FAILED' AND created_at >= now() - interval '24 hours'
    ) AS failed_count_24h,
    count(*) FILTER (
      WHERE (extracted_text IS NULL OR extracted_text = '')
        AND status = 'SUCCEEDED'
        AND created_at >= now() - interval '24 hours'
    ) AS empty_ocr_count_24h,
    count(*) FILTER (
      WHERE created_at >= now() - interval '24 hours'
    ) AS total_24h
  FROM document_ocr_results
),
skipped AS (
  SELECT count(*) AS skipped_count_24h
  FROM deal_pipeline_ledger
  WHERE event_key = 'ocr.skipped'
    AND created_at >= now() - interval '24 hours'
),
received AS (
  SELECT count(*) AS documents_received_24h
  FROM deal_documents
  WHERE created_at >= now() - interval '24 hours'
)
SELECT
  ocr.failed_count_24h,
  ocr.empty_ocr_count_24h,
  ocr.total_24h,
  CASE
    -- Documents arrived and not one of them reached OCR: the pipeline is
    -- broken upstream of OCR, which is precisely what went unnoticed.
    WHEN ocr.total_24h = 0 AND received.documents_received_24h > 0 THEN 'red'
    WHEN ocr.failed_count_24h > 5 OR skipped.skipped_count_24h > 5 THEN 'red'
    WHEN ocr.failed_count_24h > 0
      OR skipped.skipped_count_24h > 0
      OR ocr.empty_ocr_count_24h > 0 THEN 'amber'
    -- No documents, no OCR: no signal. Not health.
    WHEN ocr.total_24h = 0 THEN 'unknown'
    ELSE 'green'
  END AS health_color,
  skipped.skipped_count_24h,
  received.documents_received_24h
FROM ocr, skipped, received;

COMMENT ON VIEW intake_ocr_failures_v1 IS
  'Intake OCR health over 24h. health_color: red (failures, or documents received with zero OCR runs), amber (any failure/skip/empty), unknown (no activity — no signal), green. Counts ocr.skipped ledger events, which is how a failed storage read surfaces.';
