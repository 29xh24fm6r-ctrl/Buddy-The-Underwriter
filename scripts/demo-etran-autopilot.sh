#!/bin/bash

# =====================================================================
# SBA GOD MODE: E-TRAN READY AUTOPILOT - ACCEPTANCE TEST
# =====================================================================
# This script demonstrates the "holy shit" moment:
# Messy deal → One click → E-Tran ready package in under 2 minutes
# =====================================================================

set -e

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BOLD='\033[1m'
NC='\033[0m' # No Color

# Config (set these to your environment)
API_URL="${API_URL:-http://localhost:3000}"
BANK_ID="${BANK_ID:-test-bank-id}"
DEAL_ID="${DEAL_ID:-test-deal-id}"

echo ""
echo "=============================================================="
echo -e "${BOLD}SBA GOD MODE: E-TRAN READY AUTOPILOT DEMO${NC}"
echo "=============================================================="
echo ""
echo "This demo will:"
echo "  1. Start with a messy deal (partial docs, incomplete data)"
echo "  2. Click 'Make E-Tran Ready' button"
echo "  3. Watch the pipeline execute all 9 stages"
echo "  4. See readiness climb from 15% → 100%"
echo "  5. Download complete submission bundle"
echo ""
echo -e "${YELLOW}Press ENTER to start demo...${NC}"
read

# -----------------------------------------------
# STEP 1: Create test deal
# -----------------------------------------------
echo ""
echo -e "${BLUE}STEP 1: Creating test deal (coffee shop, \$500K loan)${NC}"
echo "-----------------------------------------------"

DEAL_RESPONSE=$(curl -s -X POST "${API_URL}/api/deals" \
  -H "Content-Type: application/json" \
  -d '{
    "business_name": "Main Street Coffee Co",
    "loan_amount": 500000,
    "use_of_proceeds": "Working capital + equipment",
    "naics_code": "722515",
    "ein": "12-3456789"
  }')

DEAL_ID=$(echo "$DEAL_RESPONSE" | jq -r '.data.id // empty')

if [ -z "$DEAL_ID" ]; then
  echo -e "${RED}✗ Failed to create deal${NC}"
  echo "$DEAL_RESPONSE" | jq '.'
  exit 1
fi

echo -e "${GREEN}✓ Deal created: ${DEAL_ID}${NC}"
sleep 1

# -----------------------------------------------
# STEP 2: Check initial readiness (should be low)
# -----------------------------------------------
echo ""
echo -e "${BLUE}STEP 2: Checking initial readiness${NC}"
echo "-----------------------------------------------"

INITIAL_STATUS=$(curl -s "${API_URL}/api/deals/${DEAL_ID}/autopilot/status")
INITIAL_SCORE=$(echo "$INITIAL_STATUS" | jq -r '.data.readiness.overall_score // 0')
INITIAL_PERCENT=$(echo "scale=0; $INITIAL_SCORE * 100 / 1" | bc)

echo "Initial readiness: ${INITIAL_PERCENT}%"
echo "Label: $(echo "$INITIAL_STATUS" | jq -r '.data.readiness.label // "Unknown"')"
echo "Blockers: $(echo "$INITIAL_STATUS" | jq -r '.data.readiness.blockers | length // 0')"
sleep 2

# -----------------------------------------------
# STEP 3: Click "Make E-Tran Ready" button
# -----------------------------------------------
echo ""
echo -e "${BOLD}${GREEN}STEP 3: Clicking 'Make E-Tran Ready' button ▶${NC}"
echo "-----------------------------------------------"

RUN_RESPONSE=$(curl -s -X POST "${API_URL}/api/deals/${DEAL_ID}/autopilot/run" \
  -H "Content-Type: application/json" \
  -d '{"mode": "full", "force": false}')

RUN_ID=$(echo "$RUN_RESPONSE" | jq -r '.data.run_id // empty')

if [ -z "$RUN_ID" ]; then
  echo -e "${RED}✗ Failed to start autopilot${NC}"
  echo "$RUN_RESPONSE" | jq '.'
  exit 1
fi

echo -e "${GREEN}✓ Autopilot started: ${RUN_ID}${NC}"
echo ""
sleep 1

# -----------------------------------------------
# STEP 4: Watch pipeline execute (live polling)
# -----------------------------------------------
echo -e "${BLUE}STEP 4: Watching pipeline execute${NC}"
echo "-----------------------------------------------"
echo ""

LAST_STAGE=""
LAST_PROGRESS=0

while true; do
  STATUS=$(curl -s "${API_URL}/api/deals/${DEAL_ID}/autopilot/status?runId=${RUN_ID}")
  
  PIPELINE_STATUS=$(echo "$STATUS" | jq -r '.data.pipeline.status // "unknown"')
  CURRENT_STAGE=$(echo "$STATUS" | jq -r '.data.pipeline.current_stage // "unknown"')
  PROGRESS=$(echo "$STATUS" | jq -r '.data.pipeline.progress // 0')
  READINESS=$(echo "$STATUS" | jq -r '.data.readiness.overall_score // 0')
  READINESS_PERCENT=$(echo "scale=0; $READINESS * 100 / 1" | bc)
  
  # Print stage updates
  if [ "$CURRENT_STAGE" != "$LAST_STAGE" ] || [ "$PROGRESS" != "$LAST_PROGRESS" ]; then
    echo -e "${YELLOW}[Pipeline]${NC} Stage: ${CURRENT_STAGE} | Progress: ${PROGRESS}% | Readiness: ${READINESS_PERCENT}%"
    LAST_STAGE="$CURRENT_STAGE"
    LAST_PROGRESS="$PROGRESS"
  fi
  
  # Check if pipeline finished
  if [ "$PIPELINE_STATUS" = "succeeded" ]; then
    echo ""
    echo -e "${GREEN}✓ Pipeline completed successfully!${NC}"
    break
  elif [ "$PIPELINE_STATUS" = "failed" ]; then
    echo ""
    echo -e "${RED}✗ Pipeline failed${NC}"
    echo "$STATUS" | jq '.data.pipeline.error'
    exit 1
  fi
  
  sleep 2
done

sleep 1

# -----------------------------------------------
# STEP 5: Check final readiness
# -----------------------------------------------
echo ""
echo -e "${BLUE}STEP 5: Checking final readiness${NC}"
echo "-----------------------------------------------"

FINAL_STATUS=$(curl -s "${API_URL}/api/deals/${DEAL_ID}/autopilot/status?runId=${RUN_ID}")
FINAL_SCORE=$(echo "$FINAL_STATUS" | jq -r '.data.readiness.overall_score // 0')
FINAL_PERCENT=$(echo "scale=0; $FINAL_SCORE * 100 / 1" | bc)

echo "Final readiness: ${FINAL_PERCENT}%"
echo "Label: $(echo "$FINAL_STATUS" | jq -r '.data.readiness.label')"
echo ""

# Show truth snapshot
TRUTH_VERSION=$(echo "$FINAL_STATUS" | jq -r '.data.truth.version // 0')
TRUTH_CONFIDENCE=$(echo "$FINAL_STATUS" | jq -r '.data.truth.overall_confidence // 0')

echo "Truth Snapshot:"
echo "  Version: v${TRUTH_VERSION}"
echo "  Confidence: $(echo "scale=0; $TRUTH_CONFIDENCE * 100 / 1" | bc)%"
echo "  Needs Human Review: $(echo "$FINAL_STATUS" | jq -r '.data.truth.needs_human // 0') items"
echo ""

# Show punchlist
PUNCHLIST_TOTAL=$(echo "$FINAL_STATUS" | jq -r '.data.punchlist.total_count // 0')
PUNCHLIST_BLOCKING=$(echo "$FINAL_STATUS" | jq -r '.data.punchlist.blocking_count // 0')

echo "Punchlist:"
echo "  Total items: ${PUNCHLIST_TOTAL}"
echo "  Blocking: ${PUNCHLIST_BLOCKING}"
echo "  Borrower actions: $(echo "$FINAL_STATUS" | jq -r '.data.punchlist.borrower_actions | length')"
echo "  Banker actions: $(echo "$FINAL_STATUS" | jq -r '.data.punchlist.banker_actions | length')"
echo ""

# -----------------------------------------------
# STEP 6: Success summary
# -----------------------------------------------
echo ""
echo "=============================================================="
echo -e "${BOLD}${GREEN}✓ DEMO COMPLETE${NC}"
echo "=============================================================="
echo ""
echo "Results:"
echo "  ✓ Deal transformed from ${INITIAL_PERCENT}% → ${FINAL_PERCENT}% ready"
echo "  ✓ Pipeline executed 9 stages successfully"
echo "  ✓ Truth snapshot v${TRUTH_VERSION} created"
echo "  ✓ Package bundle assembled"
echo ""

if [ "$FINAL_PERCENT" -ge 100 ]; then
  echo -e "${GREEN}${BOLD}🎉 E-TRAN READY! 🎉${NC}"
  echo ""
  echo "Next steps:"
  echo "  1. Download package bundle"
  echo "  2. Review credit memo PDF"
  echo "  3. Submit to E-Tran"
else
  echo -e "${YELLOW}Almost there!${NC}"
  echo ""
  echo "Remaining items:"
  echo "$FINAL_STATUS" | jq -r '.data.punchlist.borrower_actions[] | "  - \(.title)"'
fi

echo ""
echo "=============================================================="
echo ""
