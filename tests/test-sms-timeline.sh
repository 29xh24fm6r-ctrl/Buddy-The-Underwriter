#!/bin/bash
# Test SMS Timeline in Deal Command Center

set -e

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

echo -e "${CYAN}╔════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║  SMS TIMELINE TEST                         ║${NC}"
echo -e "${CYAN}╚════════════════════════════════════════════╝${NC}\n"

# Check DATABASE_URL
if [ -z "$DATABASE_URL" ]; then
  echo -e "${YELLOW}⚠️  DATABASE_URL not set${NC}"
  read -p "Paste DATABASE_URL: " DB_URL
  export DATABASE_URL="$DB_URL"
fi

# Step 1: Check if we have any SMS data
echo -e "${CYAN}━━━ Step 1: Check SMS Data ━━━${NC}\n"

OUTBOUND_COUNT=$(psql "$DATABASE_URL" -t -c "
  SELECT COUNT(*) FROM public.outbound_messages WHERE channel = 'sms';
")

echo "Outbound SMS messages: $OUTBOUND_COUNT"

if [ "$OUTBOUND_COUNT" -eq 0 ]; then
  echo -e "\n${YELLOW}⚠️  No SMS messages found!${NC}"
  echo "Action: Send a test SMS first:"
  echo ""
  echo "  ./test-borrower-portal-sms.sh <deal_id> +15551234567"
  echo ""
  exit 1
fi

echo -e "${GREEN}✓ SMS data exists${NC}\n"

# Step 2: Show recent SMS
echo -e "${CYAN}━━━ Step 2: Recent SMS Activity ━━━${NC}\n"

psql "$DATABASE_URL" -c "
  SELECT 
    deal_id,
    to_value,
    status,
    created_at,
    substring(body, 1, 50) || '...' as message_preview
  FROM public.outbound_messages
  WHERE channel = 'sms'
  ORDER BY created_at DESC
  LIMIT 5;
"

# Step 3: Get a deal with SMS
echo -e "\n${CYAN}━━━ Step 3: Find Deal with SMS ━━━${NC}\n"

DEAL_WITH_SMS=$(psql "$DATABASE_URL" -t -A -c "
  SELECT deal_id 
  FROM public.outbound_messages 
  WHERE channel = 'sms'
  ORDER BY created_at DESC 
  LIMIT 1;
")

if [ -z "$DEAL_WITH_SMS" ]; then
  echo -e "${YELLOW}⚠️  No deal found with SMS${NC}"
  exit 1
fi

echo "Deal with SMS activity: $DEAL_WITH_SMS"

# Step 4: Show timeline for this deal
echo -e "\n${CYAN}━━━ Step 4: SMS Timeline for Deal ━━━${NC}\n"

psql "$DATABASE_URL" -c "
  SELECT 
    'outbound' as direction,
    created_at::timestamp,
    to_value as phone,
    status,
    substring(body, 1, 60) as message
  FROM public.outbound_messages
  WHERE deal_id = '$DEAL_WITH_SMS'
    AND channel = 'sms'

  UNION ALL

  SELECT 
    'inbound' as direction,
    created_at::timestamp,
    metadata->>'from' as phone,
    'received' as status,
    substring(metadata->>'body', 1, 60) as message
  FROM public.deal_events
  WHERE deal_id = '$DEAL_WITH_SMS'
    AND kind IN ('sms_inbound', 'sms_reply')

  ORDER BY created_at DESC;
"

# Step 5: Instructions to view in UI
echo -e "\n${CYAN}━━━ Step 5: View in Command Center ━━━${NC}\n"

APP_URL=${NEXT_PUBLIC_APP_URL:-http://localhost:3000}
COMMAND_URL="$APP_URL/deals/$DEAL_WITH_SMS/command"

echo "Next steps:"
echo ""
echo "1. Start the dev server: npm run dev"
echo ""
echo "2. Open: $COMMAND_URL"
echo ""
echo "3. Look for the SMS timeline in the bottom-right corner"
echo ""
echo "4. You should see:"
echo "   - 💬 SMS Activity card"
echo "   - Sent messages (gray/green background)"
echo "   - Replies (blue background)"
echo "   - Delivery status updates"
echo ""

echo -e "${GREEN}✓ SMS timeline test complete!${NC}\n"

# Bonus: Check for inbound events
INBOUND_COUNT=$(psql "$DATABASE_URL" -t -c "
  SELECT COUNT(*) FROM public.deal_events 
  WHERE kind IN ('sms_inbound', 'sms_reply');
")

if [ "$INBOUND_COUNT" -eq 0 ]; then
  echo -e "${YELLOW}Note: No inbound SMS events yet (borrower hasn't replied)${NC}"
  echo "To test inbound:"
  echo "  1. Set up Twilio webhook: /api/webhooks/twilio/inbound"
  echo "  2. Reply to an SMS from your test phone"
  echo ""
fi
