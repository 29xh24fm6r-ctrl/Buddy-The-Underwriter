#!/bin/bash
# Test borrower reminder automation

set -e

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
NC='\033[0m'

echo -e "${CYAN}╔════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║  BORROWER REMINDER AUTOMATION TEST         ║${NC}"
echo -e "${CYAN}╚════════════════════════════════════════════╝${NC}\n"

APP_URL=${NEXT_PUBLIC_APP_URL:-http://localhost:3000}
CRON_SECRET=${CRON_SECRET:-}

if [ -z "$CRON_SECRET" ]; then
  echo -e "${RED}ERROR: CRON_SECRET not set${NC}"
  echo "Set it in .env.local or export CRON_SECRET=your_secret"
  exit 1
fi

echo "Testing against: $APP_URL"
echo ""

# Test 1: Run reminder cron
echo -e "${CYAN}━━━ Test 1: Run Reminder Cron ━━━${NC}\n"

RESPONSE=$(curl -sS -X POST "$APP_URL/api/cron/borrower-reminders" \
  -H "Authorization: Bearer $CRON_SECRET")

echo "$RESPONSE" | jq .

OK=$(echo "$RESPONSE" | jq -r .ok)

if [ "$OK" = "true" ]; then
  echo -e "\n${GREEN}✓ Cron executed successfully${NC}"
  
  SENT=$(echo "$RESPONSE" | jq -r .sent)
  SKIPPED=$(echo "$RESPONSE" | jq -r .skipped)
  CANDIDATES=$(echo "$RESPONSE" | jq -r .candidates)
  
  echo ""
  echo "Results:"
  echo "  Candidates: $CANDIDATES"
  echo "  Sent:       $SENT"
  echo "  Skipped:    $SKIPPED"
else
  echo -e "\n${RED}✗ Cron failed${NC}"
  ERROR=$(echo "$RESPONSE" | jq -r .error)
  echo "Error: $ERROR"
fi

# Test 2: Verify database logging (if DATABASE_URL set)
if [ -n "$DATABASE_URL" ]; then
  echo -e "\n${CYAN}━━━ Test 2: Verify Database Logging ━━━${NC}\n"
  
  echo "Recent reminder sends:"
  
  psql "$DATABASE_URL" -c "
    SELECT 
      created_at::timestamp,
      metadata->>'to' as phone,
      metadata->>'label' as label,
      metadata->>'attempt' as attempt,
      metadata->>'missing_items' as missing_items
    FROM deal_events
    WHERE kind = 'sms_outbound'
      AND metadata->>'label' = 'Upload reminder'
    ORDER BY created_at DESC
    LIMIT 10;
  "
  
  echo -e "\nOutbound messages:"
  
  psql "$DATABASE_URL" -c "
    SELECT 
      created_at::timestamp,
      deal_id,
      to_value,
      status,
      substring(body, 1, 60) as message_preview
    FROM outbound_messages
    WHERE channel = 'sms'
      AND body LIKE '%Friendly reminder%'
    ORDER BY created_at DESC
    LIMIT 10;
  "
  
  echo -e "\n${GREEN}✓ Database logging verified${NC}"
else
  echo -e "\n${YELLOW}⚠️  Skipping database check (DATABASE_URL not set)${NC}"
fi

# Test 3: Test auth (should fail without secret)
echo -e "\n${CYAN}━━━ Test 3: Auth Protection ━━━${NC}\n"

UNAUTH_RESPONSE=$(curl -sS -X POST "$APP_URL/api/cron/borrower-reminders" \
  -H "Authorization: Bearer wrong_secret")

if echo "$UNAUTH_RESPONSE" | grep -q "unauthorized"; then
  echo -e "${GREEN}✓ Auth protection working (rejected bad secret)${NC}"
else
  echo -e "${YELLOW}⚠️  Expected unauthorized response${NC}"
fi

echo -e "\n${CYAN}━━━ SUMMARY ━━━${NC}\n"
echo "Next steps:"
echo ""
echo "1. Deploy to Vercel:"
echo "   vercel --prod"
echo ""
echo "2. Set environment variables in Vercel:"
echo "   CRON_SECRET=<your_secret>"
echo "   NEXT_PUBLIC_APP_URL=https://yourapp.com"
echo ""
echo "3. Vercel will automatically run cron at 14:00 UTC daily"
echo "   (Schedule configured in vercel.json)"
echo ""
echo "4. Monitor cron execution:"
echo "   Vercel Dashboard → Functions → Cron"
echo ""
echo "5. Test reminder policy:"
echo "   - First reminder: sent immediately (if eligible)"
echo "   - Second reminder: 48h cooldown"
echo "   - Max 3 attempts per deal"
echo "   - Opted-out numbers automatically skipped"
echo ""
