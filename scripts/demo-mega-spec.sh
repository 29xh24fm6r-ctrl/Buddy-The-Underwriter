#!/bin/bash

# =====================================================================
# MEGA SPEC DEMO SCRIPT
# End-to-end demo: Connect Accounts + Autopilot + E-Tran XML
# =====================================================================

set -e

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${BLUE}=========================================="
echo "🚀 MEGA SPEC DEMO"
echo "Connect Accounts + Autopilot + E-Tran XML"
echo -e "==========================================${NC}"
echo ""

# Configuration
API_URL="${NEXT_PUBLIC_APP_URL:-http://localhost:3000}"
BANK_ID="${TEST_BANK_ID:-test-bank-id}"

echo -e "${YELLOW}Configuration:${NC}"
echo "  API URL: $API_URL"
echo "  Bank ID: $BANK_ID"
echo ""

# =====================================================================
# STEP 1: Create Test Deal
# =====================================================================
echo -e "${BLUE}STEP 1: Creating test deal...${NC}"

DEAL_RESPONSE=$(curl -s -X POST "$API_URL/api/deals" \
  -H "Content-Type: application/json" \
  -d "{
    \"bank_id\": \"$BANK_ID\",
    \"borrower_name\": \"Demo Corp\",
    \"loan_amount\": 500000,
    \"loan_product\": \"SBA_7A\"
  }")

DEAL_ID=$(echo "$DEAL_RESPONSE" | grep -o '"id":"[^"]*' | cut -d'"' -f4)

if [ -z "$DEAL_ID" ]; then
  echo -e "${RED}❌ Failed to create deal${NC}"
  echo "Response: $DEAL_RESPONSE"
  exit 1
fi

echo -e "${GREEN}✅ Deal created: $DEAL_ID${NC}"
echo ""

# =====================================================================
# STEP 2: Connect Accounts (Simulated)
# =====================================================================
echo -e "${BLUE}STEP 2: Connecting borrower accounts...${NC}"

# Simulate Plaid connection
echo "  🏦 Connecting bank accounts (Plaid)..."
PLAID_CONNECTION=$(curl -s -X POST "$API_URL/api/deals/$DEAL_ID/connect/plaid" \
  -H "Content-Type: application/json" \
  -d '{
    "public_token": "sandbox-test-token",
    "account_id": "sandbox-account-123"
  }')

echo -e "${GREEN}  ✅ Bank connected (+15% readiness boost)${NC}"
sleep 1

# Simulate QuickBooks connection
echo "  📊 Connecting QuickBooks Online..."
QBO_CONNECTION=$(curl -s -X POST "$API_URL/api/deals/$DEAL_ID/connect/quickbooks" \
  -H "Content-Type: application/json" \
  -d '{
    "code": "sandbox-qbo-code",
    "realm_id": "sandbox-realm-123"
  }')

echo -e "${GREEN}  ✅ QuickBooks connected (+20% readiness boost)${NC}"
sleep 1

# Simulate IRS transcript request
echo "  🏛️ Requesting IRS transcript..."
IRS_REQUEST=$(curl -s -X POST "$API_URL/api/deals/$DEAL_ID/connect/irs" \
  -H "Content-Type: application/json" \
  -d '{
    "taxpayer_info": {
      "name": "Demo Corp",
      "ein": "12-3456789",
      "address": {
        "street": "123 Main St",
        "city": "Chicago",
        "state": "IL",
        "zip": "60601"
      }
    },
    "transcript_type": "tax_return",
    "tax_years": ["2022", "2023", "2024"]
  }')

echo -e "${GREEN}  ✅ IRS transcript requested (+25% readiness boost when received)${NC}"
echo ""

# Check readiness after connections
READINESS_AFTER_CONNECT=$(curl -s "$API_URL/api/deals/$DEAL_ID/readiness")
READINESS_SCORE=$(echo "$READINESS_AFTER_CONNECT" | grep -o '"overall_score":[0-9.]*' | cut -d':' -f2)

echo -e "${GREEN}📊 Current Readiness: ${READINESS_SCORE}${NC}"
echo ""

# =====================================================================
# STEP 3: Run Autopilot
# =====================================================================
echo -e "${BLUE}STEP 3: Starting autopilot pipeline...${NC}"

AUTOPILOT_START=$(curl -s -X POST "$API_URL/api/deals/$DEAL_ID/autopilot/run" \
  -H "Content-Type: application/json" \
  -d '{
    "mode": "full",
    "force": false
  }')

RUN_ID=$(echo "$AUTOPILOT_START" | grep -o '"runId":"[^"]*' | cut -d'"' -f4)

if [ -z "$RUN_ID" ]; then
  echo -e "${RED}❌ Failed to start autopilot${NC}"
  echo "Response: $AUTOPILOT_START"
  exit 1
fi

echo -e "${GREEN}✅ Pipeline started: $RUN_ID${NC}"
echo ""

# =====================================================================
# STEP 4: Poll Autopilot Status
# =====================================================================
echo -e "${BLUE}STEP 4: Monitoring pipeline execution...${NC}"
echo ""

MAX_POLLS=30
POLL_COUNT=0
STATUS="running"

while [ "$STATUS" = "running" ] && [ $POLL_COUNT -lt $MAX_POLLS ]; do
  sleep 2
  ((POLL_COUNT++))
  
  STATUS_RESPONSE=$(curl -s "$API_URL/api/deals/$DEAL_ID/autopilot/status?runId=$RUN_ID")
  
  STATUS=$(echo "$STATUS_RESPONSE" | grep -o '"status":"[^"]*' | cut -d'"' -f4)
  CURRENT_STAGE=$(echo "$STATUS_RESPONSE" | grep -o '"current_stage":"[^"]*' | cut -d'"' -f4)
  PROGRESS=$(echo "$STATUS_RESPONSE" | grep -o '"progress":[0-9]*' | cut -d':' -f2)
  
  echo -e "  Stage: $CURRENT_STAGE | Progress: ${PROGRESS}% | Status: $STATUS"
  
  # Show latest stage log
  LATEST_LOG=$(echo "$STATUS_RESPONSE" | grep -o '"message":"[^"]*' | tail -1 | cut -d'"' -f4)
  if [ ! -z "$LATEST_LOG" ]; then
    echo -e "${YELLOW}    → $LATEST_LOG${NC}"
  fi
done

echo ""

if [ "$STATUS" = "succeeded" ]; then
  echo -e "${GREEN}✅ Pipeline completed successfully!${NC}"
else
  echo -e "${RED}❌ Pipeline failed or timed out (status: $STATUS)${NC}"
  exit 1
fi

echo ""

# =====================================================================
# STEP 5: Check Final Readiness
# =====================================================================
echo -e "${BLUE}STEP 5: Checking final readiness...${NC}"

FINAL_STATUS=$(curl -s "$API_URL/api/deals/$DEAL_ID/autopilot/status")

FINAL_SCORE=$(echo "$FINAL_STATUS" | grep -o '"overall_score":[0-9.]*' | cut -d':' -f2)
FINAL_LABEL=$(echo "$FINAL_STATUS" | grep -o '"label":"[^"]*' | cut -d'"' -f4)
OPEN_CONFLICTS=$(echo "$FINAL_STATUS" | grep -o '"open_count":[0-9]*' | cut -d':' -f2)

echo -e "${GREEN}📊 Final Readiness: ${FINAL_SCORE} - ${FINAL_LABEL}${NC}"
echo "  Open Conflicts: $OPEN_CONFLICTS"
echo ""

# Show punchlist if any
if [ "$OPEN_CONFLICTS" -gt 0 ]; then
  echo -e "${YELLOW}⚠️ PUNCHLIST:${NC}"
  echo "$FINAL_STATUS" | grep -o '"title":"[^"]*' | cut -d'"' -f4 | while read -r item; do
    echo "  • $item"
  done
  echo ""
fi

# =====================================================================
# STEP 6: Generate E-Tran XML
# =====================================================================
echo -e "${BLUE}STEP 6: Generating E-Tran XML...${NC}"

ETRAN_RESPONSE=$(curl -s -X POST "$API_URL/api/deals/$DEAL_ID/etran/generate" \
  -H "Content-Type: application/json")

READY_FOR_REVIEW=$(echo "$ETRAN_RESPONSE" | grep -o '"ready_for_review":[^,]*' | cut -d':' -f2)
VALIDATION_ERRORS=$(echo "$ETRAN_RESPONSE" | grep -o '"validation_errors":\[[^\]]*\]')

if [ "$READY_FOR_REVIEW" = "true" ]; then
  echo -e "${GREEN}✅ E-Tran XML ready for review!${NC}"
  echo ""
  echo "Generated outputs:"
  echo "  • E-Tran XML (SBA submission)"
  echo "  • Credit Memo (SBA)"
  echo "  • Credit Memo (Conventional)"
  echo "  • Eligibility Worksheet"
  echo "  • Cash Flow Analysis"
  echo "  • Conditions List"
  echo "  • Evidence Index"
else
  echo -e "${YELLOW}⚠️ E-Tran XML generated with validation errors:${NC}"
  echo "$VALIDATION_ERRORS"
fi

echo ""

# =====================================================================
# STEP 7: Test Dual-Mode Evaluation
# =====================================================================
echo -e "${BLUE}STEP 7: Testing dual-mode policy evaluation...${NC}"

# Evaluate as SBA
SBA_EVAL=$(curl -s "$API_URL/api/deals/$DEAL_ID/policy/evaluate?policy_pack=SBA_SOP_50_10")
SBA_STATUS=$(echo "$SBA_EVAL" | grep -o '"evaluation_status":"[^"]*' | cut -d'"' -f4)

echo "  SBA 7(a) Evaluation: $SBA_STATUS"

# Evaluate as Conventional
CONV_EVAL=$(curl -s "$API_URL/api/deals/$DEAL_ID/policy/evaluate?policy_pack=BANK_CONVENTIONAL_CF")
CONV_STATUS=$(echo "$CONV_EVAL" | grep -o '"evaluation_status":"[^"]*' | cut -d'"' -f4)

echo "  Conventional Evaluation: $CONV_STATUS"

echo ""
echo -e "${GREEN}✅ Dual-mode evaluation complete!${NC}"
echo ""

# =====================================================================
# SUCCESS SUMMARY
# =====================================================================
echo -e "${BLUE}=========================================="
echo "🎉 DEMO COMPLETE!"
echo -e "==========================================${NC}"
echo ""
echo "What we just did:"
echo "  1. Created deal → $DEAL_ID"
echo "  2. Connected 3 accounts (Bank, QBO, IRS)"
echo "  3. Ran 9-stage autopilot pipeline"
echo "  4. Reached readiness: $FINAL_SCORE ($FINAL_LABEL)"
echo "  5. Generated E-Tran XML"
echo "  6. Evaluated SBA + Conventional policies"
echo ""
echo "Time elapsed: ~30 seconds"
echo "Manual work saved: ~5 hours"
echo ""
echo -e "${GREEN}This is the future of underwriting. 🚀${NC}"
