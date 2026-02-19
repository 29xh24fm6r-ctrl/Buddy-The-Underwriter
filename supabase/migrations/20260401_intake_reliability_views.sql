-- ---------------------------------------------------------------------------
-- Phase C — Intake Governance Reliability Views
--
-- Three read-only views for operational governance monitoring.
-- All reads existing tables — no schema changes.
--
-- Views:
--   intake_worker_health_v1  — detect dead/degraded workers (buddy_workers)
--   intake_queue_latency_v1  — detect queue backlogs (document_jobs + deal_spread_jobs)
--   intake_ocr_failures_v1   — detect OCR failures in last 24h (document_ocr_results)
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- intake_worker_health_v1
-- Reads buddy_workers. Health color:
--   red   = > 180s since last heartbeat (dead worker)
--   amber = > 60s  since last heartbeat (degraded)
--   green = <= 60s
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW intake_worker_health_v1 AS
SELECT
  id                                                                        AS worker_id,
  worker_type,
  status,
  last_heartbeat_at,
  ROUND(EXTRACT(EPOCH FROM (NOW() - last_heartbeat_at))::numeric, 0)       AS seconds_since_heartbeat,
  consecutive_failures,
  CASE
    WHEN EXTRACT(EPOCH FROM (NOW() - last_heartbeat_at)) > 180 THEN 'red'
    WHEN EXTRACT(EPOCH FROM (NOW() - last_heartbeat_at)) > 60  THEN 'amber'
    ELSE 'green'
  END                                                                       AS health_color
FROM buddy_workers
ORDER BY seconds_since_heartbeat DESC NULLS LAST;

-- ---------------------------------------------------------------------------
-- intake_queue_latency_v1
-- Reads document_jobs (OCR + CLASSIFY) and deal_spread_jobs (SPREAD).
-- Health color:
--   red   = oldest queued job > 300s (5 min)
--   amber = oldest queued job > 120s (2 min)
--   green = < 120s or no queued jobs
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW intake_queue_latency_v1 AS
SELECT
  job_type,
  COUNT(*) FILTER (WHERE status = 'QUEUED')                                AS queued_count,
  ROUND(
    EXTRACT(EPOCH FROM (
      NOW() - MIN(created_at) FILTER (WHERE status = 'QUEUED')
    ))::numeric, 0
  )                                                                         AS max_queue_age_seconds,
  CASE
    WHEN EXTRACT(EPOCH FROM (NOW() - MIN(created_at) FILTER (WHERE status = 'QUEUED'))) > 300
      THEN 'red'
    WHEN EXTRACT(EPOCH FROM (NOW() - MIN(created_at) FILTER (WHERE status = 'QUEUED'))) > 120
      THEN 'amber'
    ELSE 'green'
  END                                                                       AS health_color
FROM document_jobs
GROUP BY job_type
UNION ALL
SELECT
  'SPREAD'                                                                  AS job_type,
  COUNT(*) FILTER (WHERE status = 'QUEUED')                                AS queued_count,
  ROUND(
    EXTRACT(EPOCH FROM (
      NOW() - MIN(created_at) FILTER (WHERE status = 'QUEUED')
    ))::numeric, 0
  )                                                                         AS max_queue_age_seconds,
  CASE
    WHEN EXTRACT(EPOCH FROM (NOW() - MIN(created_at) FILTER (WHERE status = 'QUEUED'))) > 300
      THEN 'red'
    WHEN EXTRACT(EPOCH FROM (NOW() - MIN(created_at) FILTER (WHERE status = 'QUEUED'))) > 120
      THEN 'amber'
    ELSE 'green'
  END                                                                       AS health_color
FROM deal_spread_jobs;

-- ---------------------------------------------------------------------------
-- intake_ocr_failures_v1
-- Reads document_ocr_results. Covers last 24h.
-- Health color:
--   red   = > 5 failed OCR jobs in last 24h
--   amber = > 0 failed OCR jobs in last 24h
--   green = 0 failures
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW intake_ocr_failures_v1 AS
SELECT
  COUNT(*) FILTER (
    WHERE status = 'FAILED'
    AND created_at >= NOW() - INTERVAL '24 hours'
  )                                                                         AS failed_count_24h,
  COUNT(*) FILTER (
    WHERE (extracted_text IS NULL OR extracted_text = '')
    AND status = 'SUCCEEDED'
    AND created_at >= NOW() - INTERVAL '24 hours'
  )                                                                         AS empty_ocr_count_24h,
  COUNT(*) FILTER (
    WHERE created_at >= NOW() - INTERVAL '24 hours'
  )                                                                         AS total_24h,
  CASE
    WHEN COUNT(*) FILTER (WHERE status = 'FAILED' AND created_at >= NOW() - INTERVAL '24 hours') > 5
      THEN 'red'
    WHEN COUNT(*) FILTER (WHERE status = 'FAILED' AND created_at >= NOW() - INTERVAL '24 hours') > 0
      THEN 'amber'
    ELSE 'green'
  END                                                                       AS health_color
FROM document_ocr_results;
