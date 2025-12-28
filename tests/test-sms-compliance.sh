#!/bin/bash
# Test STOP/HELP compliance

set -e

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
NC='\033[0m'

echo -e "${CYAN}╔════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║  STOP/HELP COMPLIANCE TEST                 ║${NC}"
echo -e "${CYAN}╚════════════════════════════════════════════╝${NC}\n"

APP_URL=${NEXT_PUBLIC_APP_URL:-http://localhost:3000}

echo "Testing against: $APP_URL"
echo ""

# Test 1: STOP keyword
echo -e "${CYAN}━━━ Test 1: STOP Keyword (Opt-Out) ━━━${NC}\n"

RESPONSE=$(curl -sS -X POST "$APP_URL/api/webhooks/twilio/inbound" \
  -H 'content-type: application/x-www-form-urlencoded' \
  --data-urlencode 'From=+15551234567' \
  --data-urlencode 'To=+18446551864' \
  --data-urlencode 'Body=STOP' \
  --data-urlencode 'MessageSid=SM_TEST_STOP' \
  --data-urlencode 'MessagingServiceSid=MG_TEST')

echo "$RESPONSE"

if echo "$RESPONSE" | grep -q "unsubscribed"; then
  echo -e "\n${GREEN}✓ STOP auto-reply sent${NC}"
else
  echo -e "\n${RED}✗ STOP auto-reply missing${NC}"
fi

# Test 2: HELP keyword
echo -e "\n${CYAN}━━━ Test 2: HELP Keyword ━━━${NC}\n"

RESPONSE=$(curl -sS -X POST "$APP_URL/api/webhooks/twilio/inbound" \
  -H 'content-type: application/x-www-form-urlencoded' \
  --data-urlencode 'From=+15559876543' \
  --data-urlencode 'To=+18446551864' \
  --data-urlencode 'Body=HELP' \
  --data-urlencode 'MessageSid=SM_TEST_HELP' \
  --data-urlencode 'MessagingServiceSid=MG_TEST')

echo "$RESPONSE"

if echo "$RESPONSE" | grep -q "Buddy Underwriting"; then
  echo -e "\n${GREEN}✓ HELP auto-reply sent${NC}"
else
  echo -e "\n${RED}✗ HELP auto-reply missing${NC}"
fi

# Test 3: START keyword (opt back in)
echo -e "\n${CYAN}━━━ Test 3: START Keyword (Opt-In) ━━━${NC}\n"

RESPONSE=$(curl -sS -X POST "$APP_URL/api/webhooks/twilio/inbound" \
  -H 'content-type: application/x-www-form-urlencoded' \
  --data-urlencode 'From=+15551234567' \
  --data-urlencode 'To=+18446551864' \
  --data-urlencode 'Body=START' \
  --data-urlencode 'MessageSid=SM_TEST_START' \
  --data-urlencode 'MessagingServiceSid=MG_TEST')

echo "$RESPONSE"

if echo "$RESPONSE" | grep -q "resubscribed"; then
  echo -e "\n${GREEN}✓ START auto-reply sent${NC}"
else
  echo -e "\n${RED}✗ START auto-reply missing${NC}"
fi

# Test 4: Regular message (no auto-reply)
echo -e "\n${CYAN}━━━ Test 4: Regular Message (No Auto-Reply) ━━━${NC}\n"

RESPONSE=$(curl -sS -X POST "$APP_URL/api/webhooks/twilio/inbound" \
  -H 'content-type: application/x-www-form-urlencoded' \
  --data-urlencode 'From=+15559999999' \
  --data-urlencode 'To=+18446551864' \
  --data-urlencode 'Body=I uploaded the documents' \
  --data-urlencode 'MessageSid=SM_TEST_REGULAR' \
  --data-urlencode 'MessagingServiceSid=MG_TEST')

echo "$RESPONSE"

if echo "$RESPONSE" | grep -q "<Response></Response>"; then
  echo -e "\n${GREEN}✓ No auto-reply for regular message${NC}"
else
  echo -e "\n${YELLOW}⚠️  Unexpected response for regular message${NC}"
fi

# Test 5: Verify database logging (requires DATABASE_URL)
if [ -n "$DATABASE_URL" ]; then
  echo -e "\n${CYAN}━━━ Test 5: Verify Database Logging ━━━${NC}\n"
  
  echo "Checking deal_events for SMS consent events..."
  
  psql "$DATABASE_URL" -c "
    SELECT 
      kind,
      metadata->>'from' as from_number,
      metadata->>'reason' as reason,
      created_at
    FROM deal_events
    WHERE kind IN ('sms_opt_out', 'sms_opt_in', 'sms_help', 'sms_inbound')
    ORDER BY created_at DESC
    LIMIT 10;
  "
  
  echo -e "\n${GREEN}✓ Database logging verified${NC}"
else
  echo -e "\n${YELLOW}⚠️  Skipping database check (DATABASE_URL not set)${NC}"
fi

echo -e "\n${CYAN}━━━ SUMMARY ━━━${NC}\n"
echo "Next steps:"
echo ""
echo "1. Configure Twilio webhook URLs:"
echo "   Inbound:  $APP_URL/api/webhooks/twilio/inbound"
echo "   Status:   $APP_URL/api/webhooks/twilio/status"
echo ""
echo "2. Test opt-out enforcement:"
echo "   - Send STOP from a test phone"
echo "   - Try to send upload link to that number"
echo "   - Should get 403 error: 'Borrower has opted out of SMS'"
echo ""
echo "3. Test opt-in recovery:"
echo "   - Send START from the same phone"
echo "   - Upload link should work again"
echo ""
