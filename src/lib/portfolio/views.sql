-- Portfolio SBA Intelligence Views
-- Run these in Supabase SQL Editor to create analytics views

-- View 1: Issue Frequency Analysis
CREATE OR REPLACE VIEW sba_issue_frequency AS
SELECT 
  issue->>'code' AS code,
  issue->>'message' AS message,
  issue->>'severity' AS severity,
  COUNT(*) AS frequency,
  COUNT(DISTINCT application_id) AS affected_applications,
  ROUND(AVG((issue->>'confidence')::numeric), 2) AS avg_confidence
FROM sba_preflight_results,
  jsonb_array_elements(blocking_issues) AS issue
GROUP BY code, message, severity
ORDER BY frequency DESC;

-- View 2: Readiness Score by Tenant
CREATE OR REPLACE VIEW sba_readiness_by_tenant AS
SELECT 
  a.tenant_id,
  COUNT(DISTINCT a.id) AS total_applications,
  ROUND(AVG(p.score), 1) AS avg_readiness_score,
  COUNT(DISTINCT CASE WHEN p.passed = true THEN a.id END) AS passed_count,
  COUNT(DISTINCT CASE WHEN p.passed = false THEN a.id END) AS failed_count,
  ROUND(
    100.0 * COUNT(DISTINCT CASE WHEN p.passed = true THEN a.id END) / COUNT(DISTINCT a.id),
    1
  ) AS pass_rate_pct
FROM applications a
LEFT JOIN sba_preflight_results p ON p.application_id = a.id
WHERE p.created_at = (
  SELECT MAX(created_at) 
  FROM sba_preflight_results p2 
  WHERE p2.application_id = a.id
)
GROUP BY a.tenant_id
ORDER BY avg_readiness_score DESC;

-- View 3: Time to Ready by Program
CREATE OR REPLACE VIEW sba_time_to_ready AS
SELECT 
  a.id AS application_id,
  a.tenant_id,
  e.result->>'best_program' AS program,
  a.created_at AS started_at,
  p.created_at AS ready_at,
  EXTRACT(EPOCH FROM (p.created_at - a.created_at)) / 86400 AS days_to_ready,
  p.score AS final_score
FROM applications a
JOIN sba_eligibility_results e ON e.application_id = a.id
JOIN sba_preflight_results p ON p.application_id = a.id AND p.passed = true
WHERE p.created_at = (
  SELECT MIN(created_at) 
  FROM sba_preflight_results p2 
  WHERE p2.application_id = a.id AND p2.passed = true
)
ORDER BY p.created_at DESC;

-- View 4: Document Completeness Trends
CREATE OR REPLACE VIEW sba_document_trends AS
SELECT 
  DATE_TRUNC('week', r.created_at) AS week,
  COUNT(DISTINCT r.application_id) AS applications,
  ROUND(AVG(r.result->'summary'->>'required_satisfied')::numeric, 1) AS avg_docs_satisfied,
  ROUND(AVG(r.result->'summary'->>'required_missing')::numeric, 1) AS avg_docs_missing,
  ROUND(
    100.0 * AVG(
      CASE 
        WHEN (r.result->'summary'->>'required_missing')::int = 0 THEN 1 
        ELSE 0 
      END
    ),
    1
  ) AS complete_pct
FROM borrower_requirements_snapshots r
GROUP BY week
ORDER BY week DESC;

-- View 5: Agent Recommendation Patterns
CREATE OR REPLACE VIEW sba_agent_patterns AS
SELECT 
  agent,
  action,
  COUNT(*) AS recommendation_count,
  ROUND(AVG(confidence), 2) AS avg_confidence,
  COUNT(DISTINCT CASE WHEN requires_approval = true THEN event_id END) AS requires_approval_count,
  COUNT(DISTINCT application_id) AS affected_applications
FROM autonomous_events
GROUP BY agent, action
ORDER BY recommendation_count DESC;

-- View 6: E-Tran Submission Pipeline
CREATE OR REPLACE VIEW sba_etran_pipeline AS
SELECT 
  status,
  COUNT(*) AS count,
  ROUND(AVG(EXTRACT(EPOCH FROM (submitted_at - created_at)) / 3600), 1) AS avg_hours_to_submit,
  MAX(created_at) AS most_recent
FROM etran_submissions
GROUP BY status
ORDER BY 
  CASE status
    WHEN 'PENDING_APPROVAL' THEN 1
    WHEN 'SUBMITTED' THEN 2
    WHEN 'APPROVED' THEN 3
    WHEN 'REJECTED' THEN 4
    ELSE 5
  END;

-- View 7: Overall Portfolio Health
CREATE OR REPLACE VIEW sba_portfolio_health AS
SELECT 
  COUNT(DISTINCT a.id) AS total_applications,
  COUNT(DISTINCT CASE WHEN e.result->>'status' = 'ELIGIBLE' THEN a.id END) AS eligible_count,
  COUNT(DISTINCT CASE WHEN p.passed = true THEN a.id END) AS preflight_passed_count,
  COUNT(DISTINCT CASE WHEN f.status = 'READY' THEN a.id END) AS forms_ready_count,
  COUNT(DISTINCT CASE WHEN et.ready = true THEN a.id END) AS etran_ready_count,
  COUNT(DISTINCT CASE WHEN es.status = 'SUBMITTED' THEN a.id END) AS submitted_count,
  ROUND(AVG(p.score), 1) AS avg_readiness_score,
  ROUND(
    100.0 * COUNT(DISTINCT CASE WHEN p.passed = true THEN a.id END) / 
    NULLIF(COUNT(DISTINCT a.id), 0),
    1
  ) AS pass_rate_pct
FROM applications a
LEFT JOIN sba_eligibility_results e ON e.application_id = a.id
LEFT JOIN sba_preflight_results p ON p.application_id = a.id
LEFT JOIN sba_form_payloads f ON f.application_id = a.id
LEFT JOIN etran_readiness et ON et.application_id = a.id
LEFT JOIN etran_submissions es ON es.application_id = a.id;
