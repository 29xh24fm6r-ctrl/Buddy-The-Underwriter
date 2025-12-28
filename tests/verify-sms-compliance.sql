-- ==============================
-- SMS COMPLIANCE VERIFICATION
-- ==============================

-- Check opt-out events
\echo '=== Opt-Out Events (STOP keyword) ==='

SELECT 
  created_at,
  metadata->>'phone' as phone_number,
  metadata->>'from' as from_number,
  metadata->>'reason' as keyword_used
FROM deal_events
WHERE kind = 'sms_opt_out'
ORDER BY created_at DESC
LIMIT 10;

-- Check opt-in events
\echo ''
\echo '=== Opt-In Events (START keyword) ==='

SELECT 
  created_at,
  metadata->>'phone' as phone_number,
  metadata->>'from' as from_number,
  metadata->>'reason' as keyword_used
FROM deal_events
WHERE kind = 'sms_opt_in'
ORDER BY created_at DESC
LIMIT 10;

-- Check HELP requests
\echo ''
\echo '=== Help Requests ==='

SELECT 
  created_at,
  metadata->>'phone' as phone_number,
  metadata->>'from' as from_number
FROM deal_events
WHERE kind = 'sms_help'
ORDER BY created_at DESC
LIMIT 10;

-- Check all inbound messages
\echo ''
\echo '=== All Inbound SMS ==='

SELECT 
  created_at,
  metadata->>'from' as from_number,
  metadata->>'body_norm' as normalized_body,
  substring(metadata->>'body', 1, 50) as message_preview
FROM deal_events
WHERE kind = 'sms_inbound'
ORDER BY created_at DESC
LIMIT 20;

-- Get current consent state for a phone number
\echo ''
\echo '=== Current Consent State for Phone ==='
\echo 'Replace :phone with actual number (e.g., +15551234567)'

WITH latest_consent AS (
  SELECT 
    metadata->>'phone' as phone,
    metadata->>'from' as from_number,
    kind,
    created_at
  FROM deal_events
  WHERE kind IN ('sms_opt_out', 'sms_opt_in')
    AND (metadata->>'phone' = :phone OR metadata->>'from' = :phone)
  ORDER BY created_at DESC
  LIMIT 1
)
SELECT 
  phone,
  kind,
  CASE 
    WHEN kind = 'sms_opt_out' THEN 'BLOCKED'
    WHEN kind = 'sms_opt_in' THEN 'ALLOWED'
    ELSE 'UNKNOWN'
  END as consent_state,
  created_at as last_consent_event
FROM latest_consent;

-- Count consent events by type
\echo ''
\echo '=== Consent Event Counts ==='

SELECT 
  kind,
  COUNT(*) as count,
  COUNT(DISTINCT metadata->>'phone') as unique_phones
FROM deal_events
WHERE kind IN ('sms_opt_out', 'sms_opt_in', 'sms_help', 'sms_inbound')
GROUP BY kind
ORDER BY kind;

-- Check blocked sends (opted out numbers)
\echo ''
\echo '=== Failed Sends Due to Opt-Out ==='

SELECT 
  created_at,
  to_value,
  error
FROM outbound_messages
WHERE channel = 'sms'
  AND status = 'failed'
  AND error LIKE '%opted out%'
ORDER BY created_at DESC
LIMIT 10;

