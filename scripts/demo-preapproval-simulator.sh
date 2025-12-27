#!/bin/bash

# =========================================================
# Pre-Approval Simulator Demo Script
# =========================================================
# Tests the complete flow: Connect accounts → Run simulator → View results
# Usage: ./scripts/demo-preapproval-simulator.sh <dealId>

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
echo -e "${BLUE}Pre-Approval Simulator Demo${NC}"
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
# Step 1: Start Simulation
# =========================================================
echo -e "${YELLOW}Step 1: Starting simulation...${NC}"

RESPONSE=$(curl -s -X POST "$BASE_URL/api/deals/$DEAL_ID/preapproval/run" \
  -H "Content-Type: application/json" \
  -d '{"mode": "DUAL"}')

echo "Response: $RESPONSE"

# Extract run_id from response
RUN_ID=$(echo "$RESPONSE" | jq -r '.run_id // empty')

if [ -z "$RUN_ID" ]; then
  echo -e "${RED}✗ Failed to start simulation${NC}"
  echo "$RESPONSE" | jq '.'
  exit 1
fi

echo -e "${GREEN}✓${NC} Simulation started: $RUN_ID"
echo ""

# =========================================================
# Step 2: Poll for Status (Every 1 Second)
# =========================================================
echo -e "${YELLOW}Step 2: Polling for status...${NC}"

MAX_RETRIES=30
RETRY_COUNT=0
STATUS="running"

while [ "$STATUS" == "running" ] && [ $RETRY_COUNT -lt $MAX_RETRIES ]; do
  sleep 1
  RETRY_COUNT=$((RETRY_COUNT + 1))
  
  STATUS_RESPONSE=$(curl -s "$BASE_URL/api/deals/$DEAL_ID/preapproval/status?runId=$RUN_ID")
  
  # Extract status, progress, current_stage
  STATUS=$(echo "$STATUS_RESPONSE" | jq -r '.run.status // "unknown"')
  PROGRESS=$(echo "$STATUS_RESPONSE" | jq -r '.run.progress // 0')
  CURRENT_STAGE=$(echo "$STATUS_RESPONSE" | jq -r '.run.current_stage // "unknown"')
  
  echo -e "  ${BLUE}[$RETRY_COUNT/$MAX_RETRIES]${NC} Status: $STATUS | Progress: $PROGRESS% | Stage: $CURRENT_STAGE"
done

echo ""

# =========================================================
# Step 3: Check Final Status
# =========================================================
echo -e "${YELLOW}Step 3: Checking final status...${NC}"

if [ "$STATUS" != "succeeded" ]; then
  echo -e "${RED}✗ Simulation failed or timed out${NC}"
  echo "$STATUS_RESPONSE" | jq '.'
  exit 1
fi

echo -e "${GREEN}✓${NC} Simulation succeeded"
echo ""

# =========================================================
# Step 4: Display Results
# =========================================================
echo -e "${YELLOW}Step 4: Displaying results...${NC}"
echo ""

# Extract SBA outcome
SBA_STATUS=$(echo "$STATUS_RESPONSE" | jq -r '.result.sba_outcome.status // "unknown"')
SBA_REASONS=$(echo "$STATUS_RESPONSE" | jq -r '.result.sba_outcome.reasons | length')

echo -e "${BLUE}SBA Outcome:${NC}"
echo "  Status: $SBA_STATUS"
echo "  Reasons: $SBA_REASONS"
echo ""

# Extract Conventional outcome
CONV_STATUS=$(echo "$STATUS_RESPONSE" | jq -r '.result.conventional_outcome.status // "unknown"')
CONV_REASONS=$(echo "$STATUS_RESPONSE" | jq -r '.result.conventional_outcome.reasons | length')

echo -e "${BLUE}Conventional Outcome:${NC}"
echo "  Status: $CONV_STATUS"
echo "  Reasons: $CONV_REASONS"
echo ""

# Extract offers
NUM_OFFERS=$(echo "$STATUS_RESPONSE" | jq -r '.result.offers | length')

echo -e "${BLUE}Offers:${NC}"
echo "  Count: $NUM_OFFERS"
echo ""

if [ "$NUM_OFFERS" -gt 0 ]; then
  echo "$STATUS_RESPONSE" | jq -r '.result.offers[] | "  • \(.product): $\(.amount_range.min)-$\(.amount_range.max), \(.term_months_range.min)-\(.term_months_range.max) months"'
  echo ""
fi

# Extract punchlist
BORROWER_ACTIONS=$(echo "$STATUS_RESPONSE" | jq -r '.result.punchlist.borrower_actions | length')
BANKER_ACTIONS=$(echo "$STATUS_RESPONSE" | jq -r '.result.punchlist.banker_actions | length')
SYSTEM_REVIEWS=$(echo "$STATUS_RESPONSE" | jq -r '.result.punchlist.system_reviews | length')

echo -e "${BLUE}Punchlist:${NC}"
echo "  Borrower Actions: $BORROWER_ACTIONS"
echo "  Banker Actions: $BANKER_ACTIONS"
echo "  System Reviews: $SYSTEM_REVIEWS"
echo ""

# Extract confidence
CONFIDENCE=$(echo "$STATUS_RESPONSE" | jq -r '.result.confidence // 0')
CONFIDENCE_PERCENT=$(echo "$CONFIDENCE * 100" | bc -l | xargs printf "%.0f")

echo -e "${BLUE}Overall Confidence:${NC}"
echo "  $CONFIDENCE_PERCENT%"
echo ""

# =========================================================
# Step 5: Summary
# =========================================================
echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}Summary${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""

if [ "$SBA_STATUS" == "pass" ]; then
  echo -e "${GREEN}✓ SBA: PASS${NC}"
else
  echo -e "${YELLOW}⚠ SBA: $SBA_STATUS${NC}"
fi

if [ "$CONV_STATUS" == "pass" ]; then
  echo -e "${GREEN}✓ Conventional: PASS${NC}"
else
  echo -e "${YELLOW}⚠ Conventional: $CONV_STATUS${NC}"
fi

echo ""
echo -e "${GREEN}✓ $NUM_OFFERS offers generated${NC}"
echo -e "${GREEN}✓ $((BORROWER_ACTIONS + BANKER_ACTIONS + SYSTEM_REVIEWS)) action items identified${NC}"
echo -e "${GREEN}✓ $CONFIDENCE_PERCENT% confidence${NC}"
echo ""

# =========================================================
# Step 6: Full JSON Output
# =========================================================
echo -e "${YELLOW}Full JSON Response:${NC}"
echo "$STATUS_RESPONSE" | jq '.'
echo ""

echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}Demo Complete! 🎉${NC}"
echo -e "${GREEN}========================================${NC}"
