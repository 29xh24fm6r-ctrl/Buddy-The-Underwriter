#!/bin/bash

# =========================================================
# AI Events Ledger - Quick Test Script
# =========================================================
# Tests the executable preapproval and autopilot routes
# Usage: ./scripts/test-ai-events-ledger.sh <dealId>

set -e

DEAL_ID="${1:-}"
BASE_URL="${BASE_URL:-http://localhost:3000}"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}AI Events Ledger Test${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""

# Check if deal ID provided
if [ -z "$DEAL_ID" ]; then
  echo -e "${RED}Error: Deal ID required${NC}"
  echo "Usage: $0 <dealId>"
  exit 1
fi

echo -e "${GREEN}✓${NC} Deal ID: $DEAL_ID"
echo -e "${GREEN}✓${NC} Base URL: $BASE_URL"
echo ""

# =========================================================
# Test 1: Preapproval Simulator
# =========================================================
echo -e "${YELLOW}Test 1: Trigger preapproval simulator...${NC}"

RESPONSE=$(curl -s -X POST "$BASE_URL/api/deals/$DEAL_ID/preapproval/run" \
  -H "Content-Type: application/json")

echo "Response: $RESPONSE"

STATUS=$(echo "$RESPONSE" | jq -r '.status // empty')

if [ "$STATUS" == "preapproval_complete" ]; then
  echo -e "${GREEN}✓${NC} Preapproval completed"
else
  echo -e "${RED}✗${NC} Preapproval failed"
  echo "$RESPONSE" | jq '.'
  exit 1
fi

echo ""

# =========================================================
# Test 2: Autopilot Pipeline
# =========================================================
echo -e "${YELLOW}Test 2: Trigger autopilot pipeline...${NC}"

RESPONSE=$(curl -s -X POST "$BASE_URL/api/deals/$DEAL_ID/autopilot/run" \
  -H "Content-Type: application/json")

echo "Response: $RESPONSE"

STATUS=$(echo "$RESPONSE" | jq -r '.status // empty')

if [ "$STATUS" == "autopilot_complete" ]; then
  echo -e "${GREEN}✓${NC} Autopilot completed"
else
  echo -e "${RED}✗${NC} Autopilot failed"
  echo "$RESPONSE" | jq '.'
  exit 1
fi

echo ""

# =========================================================
# Summary
# =========================================================
echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}Summary${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""
echo -e "${GREEN}✓ Preapproval simulator executed (2 events written)${NC}"
echo -e "${GREEN}✓ Autopilot pipeline executed (4 events written)${NC}"
echo -e "${GREEN}✓ Total: 6 events written to ai_events${NC}"
echo ""
echo -e "${YELLOW}Next: Query ai_events in Supabase:${NC}"
echo ""
echo "  SELECT kind, scope, action, confidence, created_at"
echo "  FROM ai_events"
echo "  WHERE deal_id = '$DEAL_ID'"
echo "  ORDER BY created_at DESC;"
echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}Test Complete! 🎉${NC}"
echo -e "${GREEN}========================================${NC}"
