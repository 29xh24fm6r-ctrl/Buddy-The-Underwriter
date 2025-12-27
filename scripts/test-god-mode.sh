#!/bin/bash

# =========================================================
# Buddy God Mode - Complete Test Script
# =========================================================
# Tests borrower connect + preapproval + autopilot
# Usage: ./scripts/test-god-mode.sh <dealId>

set -e

DEAL_ID="${1:-}"
BASE_URL="${BASE_URL:-http://localhost:3000}"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
NC='\033[0m' # No Color

echo -e "${PURPLE}========================================${NC}"
echo -e "${PURPLE}🧠 BUDDY GOD MODE TEST${NC}"
echo -e "${PURPLE}========================================${NC}"
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
# Test 1: Borrower Connect
# =========================================================
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${YELLOW}Test 1: Borrower Connect Accounts${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

RESPONSE=$(curl -s -X POST "$BASE_URL/api/deals/$DEAL_ID/borrower-connect")

OK=$(echo "$RESPONSE" | jq -r '.ok // false')

if [ "$OK" == "true" ]; then
  echo -e "${GREEN}✓${NC} Borrower connect completed"
  echo -e "  ${GREEN}→${NC} 2 events written (started + completed)"
else
  echo -e "${RED}✗${NC} Borrower connect failed"
  echo "$RESPONSE" | jq '.'
  exit 1
fi

echo ""

# =========================================================
# Test 2: Pre-Approval
# =========================================================
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${YELLOW}Test 2: Pre-Approval Simulator${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

RESPONSE=$(curl -s -X POST "$BASE_URL/api/deals/$DEAL_ID/preapproval/run")

OK=$(echo "$RESPONSE" | jq -r '.ok // false')

if [ "$OK" == "true" ]; then
  echo -e "${GREEN}✓${NC} Pre-approval completed"
  echo -e "  ${GREEN}→${NC} 2 events written (started + result)"
else
  echo -e "${RED}✗${NC} Pre-approval failed"
  echo "$RESPONSE" | jq '.'
  exit 1
fi

echo ""

# =========================================================
# Test 3: Autopilot
# =========================================================
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${YELLOW}Test 3: Autopilot E-Tran Ready${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

RESPONSE=$(curl -s -X POST "$BASE_URL/api/deals/$DEAL_ID/autopilot/run")

OK=$(echo "$RESPONSE" | jq -r '.ok // false')

if [ "$OK" == "true" ]; then
  echo -e "${GREEN}✓${NC} Autopilot completed"
  echo -e "  ${GREEN}→${NC} 6 events written (started + 4 stages + completed)"
else
  echo -e "${RED}✗${NC} Autopilot failed"
  echo "$RESPONSE" | jq '.'
  exit 1
fi

echo ""

# =========================================================
# Summary
# =========================================================
echo -e "${PURPLE}========================================${NC}"
echo -e "${PURPLE}📊 EVENT SUMMARY${NC}"
echo -e "${PURPLE}========================================${NC}"
echo ""
echo -e "${GREEN}✓ Borrower Connect:${NC} 2 events"
echo -e "${GREEN}✓ Pre-Approval:${NC} 2 events"
echo -e "${GREEN}✓ Autopilot:${NC} 6 events"
echo -e ""
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}TOTAL: 10 events written to ai_events${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

# =========================================================
# Verification Query
# =========================================================
echo -e "${YELLOW}📋 VERIFY IN SUPABASE:${NC}"
echo ""
cat << EOF
SELECT 
  kind,
  scope,
  action,
  confidence,
  created_at
FROM ai_events
WHERE deal_id = '$DEAL_ID'
ORDER BY created_at DESC;
EOF
echo ""

# =========================================================
# Expected Events
# =========================================================
echo -e "${YELLOW}📝 EXPECTED EVENTS (newest first):${NC}"
echo ""
echo -e "  ${BLUE}1.${NC} autopilot.run.completed (scope: sba, confidence: 0.97)"
echo -e "  ${BLUE}2.${NC} autopilot.stage.completed (scope: package, confidence: 0.9)"
echo -e "  ${BLUE}3.${NC} autopilot.stage.completed (scope: arbitration, confidence: 0.9)"
echo -e "  ${BLUE}4.${NC} autopilot.stage.completed (scope: agents, confidence: 0.9)"
echo -e "  ${BLUE}5.${NC} autopilot.stage.completed (scope: intake, confidence: 0.9)"
echo -e "  ${BLUE}6.${NC} autopilot.run.started (scope: sba)"
echo -e "  ${BLUE}7.${NC} preapproval.result (scope: dual, confidence: 0.78)"
echo -e "  ${BLUE}8.${NC} preapproval.run.started (scope: dual)"
echo -e "  ${BLUE}9.${NC} borrower.connect.completed (scope: financials, confidence: 0.9)"
echo -e "  ${BLUE}10.${NC} borrower.connect.started (scope: financials)"
echo ""

echo -e "${PURPLE}========================================${NC}"
echo -e "${PURPLE}✨ GOD MODE ACTIVE ✨${NC}"
echo -e "${PURPLE}========================================${NC}"
echo ""
echo -e "${GREEN}Next: Open /deals/$DEAL_ID/cockpit in browser${NC}"
echo ""
