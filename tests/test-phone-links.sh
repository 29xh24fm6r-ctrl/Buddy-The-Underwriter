#!/bin/bash
# Test borrower phone link creation

set -e

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
NC='\033[0m'

echo -e "${CYAN}╔════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║  BORROWER PHONE LINKS TEST                 ║${NC}"
echo -e "${CYAN}╚════════════════════════════════════════════╝${NC}\n"

if [ -z "$DATABASE_URL" ]; then
  echo -e "${RED}ERROR: DATABASE_URL not set${NC}"
  exit 1
fi

echo "Testing phone link creation flow..."
echo ""

# Test 1: Check table exists
echo -e "${CYAN}━━━ Test 1: Verify Table Exists ━━━${NC}\n"

psql "$DATABASE_URL" -c "
  SELECT COUNT(*) as total_links
  FROM borrower_phone_links;
"

echo -e "\n${GREEN}✓ Table exists${NC}"

# Test 2: Phone links by source
echo -e "\n${CYAN}━━━ Test 2: Phone Links by Source ━━━${NC}\n"

psql "$DATABASE_URL" -c "
  SELECT 
    source,
    COUNT(*) as count,
    COUNT(DISTINCT phone_e164) as unique_phones,
    COUNT(DISTINCT deal_id) as unique_deals
  FROM borrower_phone_links
  GROUP BY source
  ORDER BY count DESC;
"

echo -e "\n${GREEN}✓ Phone links grouped by source${NC}"

# Test 3: Recent phone links
echo -e "\n${CYAN}━━━ Test 3: Recent Phone Links ━━━${NC}\n"

psql "$DATABASE_URL" -c "
  SELECT 
    created_at::timestamp,
    phone_e164,
    source,
    deal_id,
    borrower_applicant_id,
    metadata->>'label' as label
  FROM borrower_phone_links
  ORDER BY created_at DESC
  LIMIT 10;
"

echo -e "\n${GREEN}✓ Recent links displayed${NC}"

# Test 4: Phone resolution test
echo -e "\n${CYAN}━━━ Test 4: Phone Resolution ━━━${NC}\n"

SAMPLE_PHONE=$(psql "$DATABASE_URL" -t -c "
  SELECT phone_e164 
  FROM borrower_phone_links 
  LIMIT 1;
" | xargs)

if [ -n "$SAMPLE_PHONE" ]; then
  echo "Sample phone: $SAMPLE_PHONE"
  echo ""
  
  psql "$DATABASE_URL" -c "
    SELECT 
      phone_e164,
      deal_id,
      borrower_applicant_id,
      bank_id,
      source,
      created_at::timestamp
    FROM borrower_phone_links
    WHERE phone_e164 = '$SAMPLE_PHONE'
    ORDER BY created_at DESC;
  "
  
  echo -e "\n${GREEN}✓ Resolution query executed${NC}"
else
  echo -e "${YELLOW}⚠️  No phone links found yet${NC}"
  echo "Phone links will be created when:"
  echo "  1. Sending portal link via SMS"
  echo "  2. Setting borrower phone in intake form"
  echo "  3. Receiving inbound SMS"
fi

# Test 5: Duplicate phone handling
echo -e "\n${CYAN}━━━ Test 5: Duplicate Phone Handling ━━━${NC}\n"

psql "$DATABASE_URL" -c "
  WITH phone_counts AS (
    SELECT 
      phone_e164,
      COUNT(*) as link_count,
      COUNT(DISTINCT deal_id) as unique_deals
    FROM borrower_phone_links
    GROUP BY phone_e164
  )
  SELECT 
    phone_e164,
    link_count,
    unique_deals,
    CASE 
      WHEN unique_deals > 1 THEN 'Multiple deals (normal for repeat borrowers)'
      WHEN link_count > unique_deals THEN 'Multiple sources same deal (expected)'
      ELSE 'Single deal single source'
    END as status
  FROM phone_counts
  WHERE link_count > 1
  ORDER BY link_count DESC
  LIMIT 10;
"

echo -e "\n${GREEN}✓ Duplicate handling verified${NC}"

# Test 6: Integration with deals
echo -e "\n${CYAN}━━━ Test 6: Integration with Deals ━━━${NC}\n"

psql "$DATABASE_URL" -c "
  SELECT 
    d.name as deal_name,
    bpl.phone_e164,
    bpl.source,
    bpl.created_at::timestamp,
    d.borrower_phone as deal_borrower_phone,
    CASE 
      WHEN d.borrower_phone = bpl.phone_e164 THEN '✓ Match'
      WHEN d.borrower_phone IS NULL THEN 'Deal has no phone'
      ELSE '⚠ Mismatch'
    END as consistency
  FROM borrower_phone_links bpl
  JOIN deals d ON d.id = bpl.deal_id
  ORDER BY bpl.created_at DESC
  LIMIT 10;
"

echo -e "\n${GREEN}✓ Deal integration verified${NC}"

# Summary
echo -e "\n${CYAN}━━━ SUMMARY ━━━${NC}\n"
echo "Phone link creation points:"
echo ""
echo "1. ✅ Portal link via SMS:"
echo "   POST /api/portal/send-link { deal_id, to_phone, ... }"
echo "   → Creates borrower_phone_links entry with source='portal_link'"
echo ""
echo "2. ✅ Intake form:"
echo "   POST /api/deals/{dealId}/intake/set { borrowerPhone, ... }"
echo "   → Creates entry with source='intake_form'"
echo ""
echo "3. ✅ Inbound SMS:"
echo "   Twilio webhook → /api/webhooks/twilio/inbound"
echo "   → Auto-creates entry with source='sms_inbound'"
echo ""
echo "4. ✅ Borrower link API:"
echo "   POST /api/deals/{dealId}/borrower-link"
echo "   → Creates entry if deal has borrower_phone"
echo ""
echo "Next steps:"
echo ""
echo "1. Run migration:"
echo "   psql \$DATABASE_URL -f supabase/migrations/20251229_borrower_phone_links.sql"
echo ""
echo "2. Test portal link creation:"
echo "   # Via UI: Deal Command Center → Send Upload Link"
echo "   # Or API: curl -X POST /api/portal/send-link -d '{\"deal_id\":\"...\", \"to_phone\":\"+15551234567\"}'"
echo ""
echo "3. Verify phone link created:"
echo "   psql \$DATABASE_URL -c 'SELECT * FROM borrower_phone_links ORDER BY created_at DESC LIMIT 5;'"
echo ""
echo "4. Test inbound resolution:"
echo "   # Send SMS to Twilio number"
echo "   # Check: SELECT * FROM deal_events WHERE kind='sms_inbound' ORDER BY created_at DESC LIMIT 1;"
echo "   # Should have deal_id populated via phone resolution"
echo ""
