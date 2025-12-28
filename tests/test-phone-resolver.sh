#!/bin/bash
# Test phone→deal resolution for inbound SMS

set -e

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
NC='\033[0m'

echo -e "${CYAN}╔════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║  PHONE→DEAL RESOLVER TEST                  ║${NC}"
echo -e "${CYAN}╚════════════════════════════════════════════╝${NC}\n"

if [ -z "$DATABASE_URL" ]; then
  echo -e "${RED}ERROR: DATABASE_URL not set${NC}"
  exit 1
fi

echo "Testing phone→deal resolution logic..."
echo ""

# Test 1: Find deals with borrower phone
echo -e "${CYAN}━━━ Test 1: Deals with Borrower Phone ━━━${NC}\n"

psql "$DATABASE_URL" -c "
  SELECT 
    id,
    name,
    borrower_phone,
    status,
    bank_id,
    created_at::timestamp
  FROM deals
  WHERE borrower_phone IS NOT NULL
  ORDER BY created_at DESC
  LIMIT 5;
"

echo -e "\n${GREEN}✓ Found deals with phone numbers${NC}"

# Test 2: Active portal links
echo -e "\n${CYAN}━━━ Test 2: Active Portal Links ━━━${NC}\n"

psql "$DATABASE_URL" -c "
  SELECT 
    bpl.deal_id,
    d.name as deal_name,
    d.borrower_phone,
    bpl.created_at::timestamp,
    bpl.expires_at::timestamp,
    CASE 
      WHEN bpl.used_at IS NOT NULL THEN 'USED'
      WHEN bpl.expires_at < NOW() THEN 'EXPIRED'
      ELSE 'ACTIVE'
    END as link_status
  FROM borrower_portal_links bpl
  JOIN deals d ON d.id = bpl.deal_id
  WHERE d.borrower_phone IS NOT NULL
  ORDER BY bpl.created_at DESC
  LIMIT 10;
"

echo -e "\n${GREEN}✓ Found portal links${NC}"

# Test 3: Simulate inbound SMS resolution
echo -e "\n${CYAN}━━━ Test 3: Resolution Logic ━━━${NC}\n"

SAMPLE_PHONE=$(psql "$DATABASE_URL" -t -c "
  SELECT borrower_phone 
  FROM deals 
  WHERE borrower_phone IS NOT NULL 
  LIMIT 1;
" | xargs)

if [ -n "$SAMPLE_PHONE" ]; then
  echo "Sample phone: $SAMPLE_PHONE"
  echo ""
  echo "Resolution query (same logic as resolveDealByPhone):"
  
  psql "$DATABASE_URL" -c "
    WITH active_links AS (
      SELECT 
        bpl.deal_id,
        d.id,
        d.bank_id,
        d.name,
        d.borrower_phone,
        d.status,
        bpl.created_at,
        'portal_link' as source
      FROM borrower_portal_links bpl
      JOIN deals d ON d.id = bpl.deal_id
      WHERE bpl.used_at IS NULL
        AND bpl.expires_at > NOW()
        AND d.borrower_phone = '$SAMPLE_PHONE'
      ORDER BY bpl.created_at DESC
      LIMIT 1
    ),
    direct_lookup AS (
      SELECT 
        id as deal_id,
        id,
        bank_id,
        name,
        borrower_phone,
        status,
        created_at,
        'direct_lookup' as source
      FROM deals
      WHERE borrower_phone = '$SAMPLE_PHONE'
      ORDER BY 
        CASE status 
          WHEN 'underwriting' THEN 1
          WHEN 'pending' THEN 2
          ELSE 3
        END,
        created_at DESC
      LIMIT 1
    )
    SELECT 
      deal_id,
      name as deal_name,
      bank_id,
      status,
      source,
      'MATCHED' as result
    FROM active_links
    UNION ALL
    SELECT 
      deal_id,
      name as deal_name,
      bank_id,
      status,
      source,
      'MATCHED' as result
    FROM direct_lookup
    WHERE NOT EXISTS (SELECT 1 FROM active_links)
    LIMIT 1;
  "
  
  echo -e "\n${GREEN}✓ Resolution logic executed${NC}"
else
  echo -e "${YELLOW}⚠️  No sample phone found (add deals.borrower_phone to test)${NC}"
fi

# Test 4: Inbound events with deal context
echo -e "\n${CYAN}━━━ Test 4: Recent Inbound Events ━━━${NC}\n"

psql "$DATABASE_URL" -c "
  SELECT 
    created_at::timestamp,
    deal_id,
    metadata->>'from' as from_phone,
    metadata->>'body' as message_body,
    metadata->'resolved_deal'->>'deal_name' as resolved_deal,
    CASE 
      WHEN deal_id IS NOT NULL THEN 'WITH DEAL'
      ELSE 'NO DEAL'
    END as resolution_status
  FROM deal_events
  WHERE kind = 'sms_inbound'
  ORDER BY created_at DESC
  LIMIT 10;
"

echo -e "\n${GREEN}✓ Inbound event history${NC}"

# Summary
echo -e "\n${CYAN}━━━ SUMMARY ━━━${NC}\n"
echo "Resolution Strategy:"
echo "1. ✅ Check active portal links (borrower engaged)"
echo "2. ✅ Direct phone lookup on deals table"
echo "3. ✅ Prefer active deals (underwriting/pending)"
echo "4. ✅ Fall back to most recent deal"
echo ""
echo "Next steps:"
echo ""
echo "1. Add borrower phone to deals:"
echo "   UPDATE deals SET borrower_phone = '+15551234567' WHERE id = 'deal-uuid';"
echo ""
echo "2. Test inbound SMS with ngrok:"
echo "   ngrok http 3000"
echo "   Set Twilio webhook: https://<ngrok-url>/api/webhooks/twilio/inbound"
echo ""
echo "3. Send test SMS to Twilio number:"
echo "   Message will auto-attach to matching deal"
echo ""
echo "4. View timeline in deal command center:"
echo "   SMS activity now shows with full deal context"
echo ""
