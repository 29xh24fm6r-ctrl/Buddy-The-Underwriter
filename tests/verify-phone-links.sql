-- ==============================
-- BORROWER PHONE LINKS VERIFICATION
-- ==============================

-- Table stats
\echo '=== Phone Links Overview ==='

SELECT 
  COUNT(*) as total_links,
  COUNT(DISTINCT phone_e164) as unique_phones,
  COUNT(DISTINCT deal_id) as unique_deals,
  COUNT(DISTINCT borrower_applicant_id) as unique_borrowers,
  COUNT(DISTINCT bank_id) as unique_banks
FROM borrower_phone_links;

-- Links by source
\echo ''
\echo '=== Links by Source ==='

SELECT 
  source,
  COUNT(*) as count,
  COUNT(DISTINCT phone_e164) as unique_phones,
  MIN(created_at)::timestamp as first_created,
  MAX(created_at)::timestamp as last_created
FROM borrower_phone_links
GROUP BY source
ORDER BY count DESC;

-- Recent phone links
\echo ''
\echo '=== Recent Phone Links ==='

SELECT 
  created_at::timestamp,
  phone_e164,
  source,
  deal_id,
  borrower_applicant_id,
  metadata->>'label' as label,
  metadata->>'token' as portal_token
FROM borrower_phone_links
ORDER BY created_at DESC
LIMIT 20;

-- Phone resolution test (most recent link per phone)
\echo ''
\echo '=== Phone Resolution (Latest Link Per Phone) ==='

SELECT DISTINCT ON (phone_e164)
  phone_e164,
  deal_id,
  borrower_applicant_id,
  bank_id,
  source,
  created_at::timestamp
FROM borrower_phone_links
ORDER BY phone_e164, created_at DESC
LIMIT 20;

-- Phones with multiple deals (repeat borrowers)
\echo ''
\echo '=== Phones with Multiple Deals ==='

SELECT 
  phone_e164,
  COUNT(DISTINCT deal_id) as deal_count,
  ARRAY_AGG(DISTINCT source) as sources,
  MIN(created_at)::timestamp as first_link,
  MAX(created_at)::timestamp as latest_link
FROM borrower_phone_links
GROUP BY phone_e164
HAVING COUNT(DISTINCT deal_id) > 1
ORDER BY deal_count DESC, latest_link DESC
LIMIT 10;

-- Integration with deals table
\echo ''
\echo '=== Deal Integration Check ==='

SELECT 
  d.name as deal_name,
  d.borrower_phone as deal_phone,
  bpl.phone_e164 as linked_phone,
  bpl.source,
  bpl.created_at::timestamp,
  CASE 
    WHEN d.borrower_phone = bpl.phone_e164 THEN '✓ Consistent'
    WHEN d.borrower_phone IS NULL THEN 'Deal missing phone'
    ELSE '⚠ Mismatch'
  END as consistency
FROM borrower_phone_links bpl
LEFT JOIN deals d ON d.id = bpl.deal_id
ORDER BY bpl.created_at DESC
LIMIT 20;

-- Deals with phone but no phone link
\echo ''
\echo '=== Deals with Phone but No Link ==='

SELECT 
  d.id,
  d.name,
  d.borrower_phone,
  d.created_at::timestamp
FROM deals d
WHERE d.borrower_phone IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM borrower_phone_links bpl
    WHERE bpl.deal_id = d.id
  )
ORDER BY d.created_at DESC
LIMIT 10;

-- Phone links without matching deal phone
\echo ''
\echo '=== Phone Links Without Matching Deal Phone ==='

SELECT 
  bpl.phone_e164,
  bpl.deal_id,
  d.borrower_phone as deal_phone,
  bpl.source,
  bpl.created_at::timestamp
FROM borrower_phone_links bpl
LEFT JOIN deals d ON d.id = bpl.deal_id
WHERE bpl.deal_id IS NOT NULL
  AND (d.borrower_phone IS NULL OR d.borrower_phone != bpl.phone_e164)
ORDER BY bpl.created_at DESC
LIMIT 10;

-- Inbound SMS resolution success rate
\echo ''
\echo '=== Inbound SMS Resolution Rate ==='

WITH inbound_events AS (
  SELECT 
    metadata->>'from' as from_phone,
    deal_id IS NOT NULL as resolved
  FROM deal_events
  WHERE kind = 'sms_inbound'
    AND created_at > NOW() - INTERVAL '7 days'
)
SELECT 
  COUNT(*) as total_inbound,
  COUNT(*) FILTER (WHERE resolved) as resolved_count,
  COUNT(*) FILTER (WHERE NOT resolved) as unresolved_count,
  ROUND(100.0 * COUNT(*) FILTER (WHERE resolved) / NULLIF(COUNT(*), 0), 1) as resolution_pct
FROM inbound_events;

-- Test specific phone resolution
\echo ''
\echo '=== Test Phone Resolution (replace phone) ==='
\echo 'Usage: \set test_phone ''+15551234567'''

-- Example query (replace phone value)
WITH test_phone AS (
  SELECT '+15551234567' as phone
)
SELECT 
  bpl.phone_e164,
  bpl.deal_id,
  bpl.borrower_applicant_id,
  bpl.bank_id,
  bpl.source,
  bpl.created_at::timestamp,
  d.name as deal_name,
  d.status as deal_status
FROM borrower_phone_links bpl
LEFT JOIN deals d ON d.id = bpl.deal_id
CROSS JOIN test_phone tp
WHERE bpl.phone_e164 = tp.phone
ORDER BY bpl.created_at DESC;
