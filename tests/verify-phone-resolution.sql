-- ==============================
-- PHONE→DEAL RESOLUTION VERIFICATION
-- ==============================

-- Check deals with phone numbers
\echo '=== Deals with Phone Numbers ==='

SELECT 
  COUNT(*) as total_deals_with_phone,
  COUNT(DISTINCT borrower_phone) as unique_phones,
  COUNT(DISTINCT bank_id) as banks
FROM deals
WHERE borrower_phone IS NOT NULL;

-- Recent deals with phones
\echo ''
\echo '=== Recent Deals with Phones ==='

SELECT 
  id,
  name,
  borrower_phone,
  status,
  created_at::timestamp
FROM deals
WHERE borrower_phone IS NOT NULL
ORDER BY created_at DESC
LIMIT 10;

-- Active portal links with phone context
\echo ''
\echo '=== Active Portal Links ==='

SELECT 
  bpl.deal_id,
  d.name as deal_name,
  d.borrower_phone,
  bpl.expires_at::timestamp,
  CASE 
    WHEN bpl.used_at IS NOT NULL THEN 'USED'
    WHEN bpl.expires_at < NOW() THEN 'EXPIRED'
    ELSE 'ACTIVE'
  END as status
FROM borrower_portal_links bpl
JOIN deals d ON d.id = bpl.deal_id
WHERE d.borrower_phone IS NOT NULL
ORDER BY bpl.created_at DESC
LIMIT 10;

-- Inbound SMS with resolution status
\echo ''
\echo '=== Inbound SMS Resolution Status ==='

SELECT 
  created_at::timestamp,
  CASE 
    WHEN deal_id IS NOT NULL THEN 'RESOLVED'
    ELSE 'UNRESOLVED'
  END as status,
  COUNT(*) as count
FROM deal_events
WHERE kind = 'sms_inbound'
GROUP BY 
  CASE 
    WHEN deal_id IS NOT NULL THEN 'RESOLVED'
    ELSE 'UNRESOLVED'
  END,
  DATE(created_at)
ORDER BY created_at DESC
LIMIT 20;

-- Recent inbound messages with deal context
\echo ''
\echo '=== Recent Inbound Messages ==='

SELECT 
  de.created_at::timestamp,
  de.deal_id,
  d.name as deal_name,
  de.metadata->>'from' as from_phone,
  de.metadata->>'body' as message,
  de.metadata->'resolved_deal'->>'deal_name' as resolved_deal_name
FROM deal_events de
LEFT JOIN deals d ON d.id = de.deal_id
WHERE de.kind = 'sms_inbound'
ORDER BY de.created_at DESC
LIMIT 20;

-- Test resolution query for specific phone
\echo ''
\echo '=== Test Resolution (replace phone) ==='
\echo 'Usage: \set phone ''+15551234567'''

WITH sample_phone AS (
  SELECT '+15551234567' as phone_e164
),
active_links AS (
  SELECT 
    bpl.deal_id,
    d.id,
    d.bank_id,
    d.name,
    d.status,
    'portal_link' as source,
    1 as priority
  FROM borrower_portal_links bpl
  JOIN deals d ON d.id = bpl.deal_id
  JOIN sample_phone sp ON d.borrower_phone = sp.phone_e164
  WHERE bpl.used_at IS NULL
    AND bpl.expires_at > NOW()
  ORDER BY bpl.created_at DESC
  LIMIT 1
),
direct_lookup AS (
  SELECT 
    d.id as deal_id,
    d.id,
    d.bank_id,
    d.name,
    d.status,
    'direct_lookup' as source,
    CASE d.status 
      WHEN 'underwriting' THEN 2
      WHEN 'pending' THEN 3
      ELSE 4
    END as priority
  FROM deals d
  JOIN sample_phone sp ON d.borrower_phone = sp.phone_e164
  ORDER BY 
    CASE d.status 
      WHEN 'underwriting' THEN 1
      WHEN 'pending' THEN 2
      ELSE 3
    END,
    d.created_at DESC
  LIMIT 1
)
SELECT 
  COALESCE(al.deal_id, dl.deal_id) as resolved_deal_id,
  COALESCE(al.name, dl.name) as deal_name,
  COALESCE(al.bank_id, dl.bank_id) as bank_id,
  COALESCE(al.status, dl.status) as deal_status,
  COALESCE(al.source, dl.source) as resolution_source,
  CASE 
    WHEN al.deal_id IS NOT NULL THEN 'Active portal link (highest priority)'
    WHEN dl.status IN ('underwriting', 'pending') THEN 'Active deal (preferred)'
    WHEN dl.deal_id IS NOT NULL THEN 'Recent deal (fallback)'
    ELSE 'No match'
  END as explanation
FROM sample_phone sp
LEFT JOIN active_links al ON true
LEFT JOIN direct_lookup dl ON al.deal_id IS NULL;

-- Consent state per phone
\echo ''
\echo '=== Consent State by Phone ==='

WITH latest_consent AS (
  SELECT DISTINCT ON (metadata->>'phone')
    metadata->>'phone' as phone_e164,
    kind,
    created_at
  FROM deal_events
  WHERE kind IN ('sms_opt_out', 'sms_opt_in')
  ORDER BY metadata->>'phone', created_at DESC
)
SELECT 
  phone_e164,
  kind,
  created_at::timestamp as last_consent_event,
  CASE kind
    WHEN 'sms_opt_out' THEN 'BLOCKED'
    WHEN 'sms_opt_in' THEN 'ALLOWED'
    ELSE 'UNKNOWN'
  END as consent_state
FROM latest_consent
ORDER BY created_at DESC;

-- Deals ready for testing (have phone + active link)
\echo ''
\echo '=== Test-Ready Deals ==='

SELECT 
  d.id as deal_id,
  d.name,
  d.borrower_phone,
  d.status,
  COUNT(bpl.id) as active_portal_links
FROM deals d
LEFT JOIN borrower_portal_links bpl ON bpl.deal_id = d.id
  AND bpl.used_at IS NULL
  AND bpl.expires_at > NOW()
WHERE d.borrower_phone IS NOT NULL
GROUP BY d.id, d.name, d.borrower_phone, d.status
ORDER BY active_portal_links DESC, d.created_at DESC
LIMIT 10;
