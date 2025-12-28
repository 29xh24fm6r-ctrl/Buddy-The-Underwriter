#!/bin/bash
# Test Borrower Portal SMS Flow

set -e

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

DEAL_ID=$1
PHONE=$2

if [ -z "$DEAL_ID" ] || [ -z "$PHONE" ]; then
  echo -e "${RED}Usage: $0 <deal_id> <phone>${NC}"
  echo "Example: $0 abc-123 +15551234567"
  exit 1
fi

APP_URL=${NEXT_PUBLIC_APP_URL:-http://localhost:3000}

echo -e "${YELLOW}=== Borrower Portal SMS Test ===${NC}\n"
echo "Deal ID: $DEAL_ID"
echo "Phone:   $PHONE"
echo "App URL: $APP_URL"
echo ""

# Step 1: Create link
echo -e "${YELLOW}Step 1: Creating portal link...${NC}"
CREATE_RESPONSE=$(curl -s -X POST "$APP_URL/api/portal/create-link" \
  -H "Content-Type: application/json" \
  -d "{\"deal_id\":\"$DEAL_ID\"}")

echo "$CREATE_RESPONSE" | jq .

TOKEN=$(echo "$CREATE_RESPONSE" | jq -r .token)
PORTAL_URL=$(echo "$CREATE_RESPONSE" | jq -r .portal_url)

if [ "$TOKEN" = "null" ]; then
  echo -e "${RED}ERROR: Failed to create link${NC}"
  exit 1
fi

echo -e "${GREEN}✓ Link created: $PORTAL_URL${NC}\n"

# Step 2: Send SMS
echo -e "${YELLOW}Step 2: Sending SMS...${NC}"
SEND_RESPONSE=$(curl -s -X POST "$APP_URL/api/portal/send-link" \
  -H "Content-Type: application/json" \
  -d "{\"deal_id\":\"$DEAL_ID\",\"to_phone\":\"$PHONE\"}")

echo "$SEND_RESPONSE" | jq .

OK=$(echo "$SEND_RESPONSE" | jq -r .ok)

if [ "$OK" = "true" ]; then
  echo -e "${GREEN}✓ SMS sent successfully!${NC}\n"
  SID=$(echo "$SEND_RESPONSE" | jq -r .sid)
  echo "Twilio SID: $SID"
else
  echo -e "${RED}✗ SMS failed${NC}"
  ERROR=$(echo "$SEND_RESPONSE" | jq -r .error)
  echo "Error: $ERROR"
  echo ""
  echo "Note: Link was still created at: $PORTAL_URL"
  echo "You can test manually by visiting that URL."
fi

echo ""
echo -e "${YELLOW}=== Test borrower flow ===${NC}"
echo "1. Open: $PORTAL_URL"
echo "2. Upload a document"
echo "3. Confirm extracted fields"
echo "4. Submit"
echo "5. Check banker notifications for underwriting_ready"
echo ""
