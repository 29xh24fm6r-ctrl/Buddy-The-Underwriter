-- ==============================
-- BORROWER REMINDER VERIFICATION
-- ==============================

-- Check reminder policy stats
\echo '=== Reminder Policy Stats ==='

SELECT 
  COUNT(DISTINCT deal_id) as deals_with_reminders,
  COUNT(*) as total_reminders_sent,
  MAX(metadata->>'attempt') as max_attempt,
  MIN(created_at) as first_reminder,
  MAX(created_at) as latest_reminder
FROM deal_events
WHERE kind = 'sms_outbound'
  AND metadata->>'label' = 'Upload reminder';

-- Recent reminders
\echo ''
\echo '=== Recent Reminders ==='

SELECT 
  created_at::timestamp,
  deal_id,
  metadata->>'to' as phone,
  metadata->>'attempt' as attempt,
  metadata->>'missing_items' as missing_items
FROM deal_events
WHERE kind = 'sms_outbound'
  AND metadata->>'label' = 'Upload reminder'
ORDER BY created_at DESC
LIMIT 20;

-- Reminder attempts per deal
\echo ''
\echo '=== Reminder Attempts Per Deal ==='

SELECT 
  deal_id,
  COUNT(*) as attempts,
  MIN(created_at::timestamp) as first_reminder,
  MAX(created_at::timestamp) as last_reminder,
  EXTRACT(EPOCH FROM (MAX(created_at) - MIN(created_at))) / 3600 as hours_between
FROM deal_events
WHERE kind = 'sms_outbound'
  AND metadata->>'label' = 'Upload reminder'
GROUP BY deal_id
ORDER BY attempts DESC, last_reminder DESC;

-- Deals approaching max attempts (2 or 3 reminders)
\echo ''
\echo '=== Deals Approaching Max Attempts ==='

SELECT 
  deal_id,
  COUNT(*) as attempts,
  MAX(created_at::timestamp) as last_reminder,
  CASE 
    WHEN COUNT(*) >= 3 THEN 'MAX REACHED'
    WHEN COUNT(*) = 2 THEN 'ONE MORE ALLOWED'
    ELSE 'OK'
  END as status
FROM deal_events
WHERE kind = 'sms_outbound'
  AND metadata->>'label' = 'Upload reminder'
GROUP BY deal_id
HAVING COUNT(*) >= 2
ORDER BY attempts DESC, last_reminder DESC;

-- Cooldown status for a specific deal
\echo ''
\echo '=== Cooldown Status for Deal ==='
\echo 'Replace :deal_id with actual UUID'

WITH last_reminder AS (
  SELECT 
    deal_id,
    created_at,
    EXTRACT(EPOCH FROM (NOW() - created_at)) / 3600 as hours_ago
  FROM deal_events
  WHERE kind = 'sms_outbound'
    AND metadata->>'label' = 'Upload reminder'
    AND deal_id = :deal_id
  ORDER BY created_at DESC
  LIMIT 1
)
SELECT 
  deal_id,
  created_at::timestamp as last_reminder_at,
  ROUND(hours_ago::numeric, 1) as hours_since_last,
  CASE 
    WHEN hours_ago >= 48 THEN 'READY (cooldown satisfied)'
    ELSE 'COOLING DOWN (need ' || ROUND((48 - hours_ago)::numeric, 1) || ' more hours)'
  END as cooldown_status
FROM last_reminder;

-- Check outbound_messages for reminder sends
\echo ''
\echo '=== Outbound Messages (Reminders) ==='

SELECT 
  created_at::timestamp,
  deal_id,
  to_value,
  status,
  provider_message_id,
  CASE 
    WHEN error IS NOT NULL THEN error
    ELSE 'OK'
  END as status_detail
FROM outbound_messages
WHERE channel = 'sms'
  AND body LIKE '%Friendly reminder%'
ORDER BY created_at DESC
LIMIT 20;

-- Candidates for next reminder run
\echo ''
\echo '=== Eligible for Next Reminder ==='
\echo '(Active links + missing items + not at max attempts + cooldown satisfied)'

WITH reminder_counts AS (
  SELECT 
    deal_id,
    COUNT(*) as attempts,
    MAX(created_at) as last_at
  FROM deal_events
  WHERE kind = 'sms_outbound'
    AND metadata->>'label' = 'Upload reminder'
  GROUP BY deal_id
)
SELECT 
  l.deal_id,
  d.name as deal_name,
  d.borrower_phone,
  COALESCE(r.attempts, 0) as reminder_attempts,
  CASE 
    WHEN r.last_at IS NULL THEN 'Never reminded'
    WHEN EXTRACT(EPOCH FROM (NOW() - r.last_at)) / 3600 >= 48 THEN 'Cooldown OK'
    ELSE 'In cooldown'
  END as cooldown_status,
  COUNT(ci.id) as missing_required_items
FROM borrower_portal_links l
JOIN deals d ON d.id = l.deal_id
LEFT JOIN reminder_counts r ON r.deal_id = l.deal_id
LEFT JOIN deal_checklist_items ci ON ci.deal_id = l.deal_id 
  AND ci.required = true 
  AND ci.received_at IS NULL
WHERE l.used_at IS NULL
  AND l.expires_at > NOW()
  AND d.borrower_phone IS NOT NULL
  AND (r.attempts IS NULL OR r.attempts < 3)
GROUP BY l.deal_id, d.name, d.borrower_phone, r.attempts, r.last_at
HAVING COUNT(ci.id) > 0
ORDER BY COALESCE(r.attempts, 0) ASC, r.last_at ASC NULLS FIRST
LIMIT 20;

