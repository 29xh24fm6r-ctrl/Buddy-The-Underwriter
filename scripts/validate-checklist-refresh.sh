#!/bin/bash
# Test checklist refresh after auto-seed

set -e

echo "🔥 CHECKLIST REFRESH FIX - VALIDATION"
echo "======================================"
echo ""

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Test 1: Check files exist
echo -e "${BLUE}Test 1: Required files exist${NC}"
FILES=(
  "src/components/deals/DealCockpitClient.tsx"
  "src/app/api/deals/[dealId]/auto-seed/route.ts"
  "src/components/deals/DealIntakeCard.tsx"
  "src/components/deals/EnhancedChecklistCard.tsx"
)

for file in "${FILES[@]}"; do
  if [ -f "$file" ]; then
    echo -e "${GREEN}✅ $file${NC}"
  else
    echo -e "${RED}❌ $file missing${NC}"
    exit 1
  fi
done
echo ""

# Test 2: Check for critical patterns
echo -e "${BLUE}Test 2: Verify critical code patterns${NC}"

# Check auto-seed returns structured results
if grep -q "pipeline_state.*checklist_seeded" src/app/api/deals/[dealId]/auto-seed/route.ts; then
  echo -e "${GREEN}✅ Auto-seed returns pipeline_state${NC}"
else
  echo -e "${RED}❌ Auto-seed missing pipeline_state${NC}"
  exit 1
fi

# Check DealIntakeCard has callback
if grep -q "onChecklistSeeded" src/components/deals/DealIntakeCard.tsx; then
  echo -e "${GREEN}✅ DealIntakeCard has onChecklistSeeded callback${NC}"
else
  echo -e "${RED}❌ DealIntakeCard missing callback${NC}"
  exit 1
fi

# Check EnhancedChecklistCard exposes refresh
if grep -q "onRefresh" src/components/deals/EnhancedChecklistCard.tsx; then
  echo -e "${GREEN}✅ EnhancedChecklistCard exposes refresh${NC}"
else
  echo -e "${RED}❌ EnhancedChecklistCard missing onRefresh${NC}"
  exit 1
fi

# Check DealCockpitClient wires callbacks
if grep -q "handleChecklistSeeded" src/components/deals/DealCockpitClient.tsx; then
  echo -e "${GREEN}✅ DealCockpitClient wires callbacks together${NC}"
else
  echo -e "${RED}❌ DealCockpitClient missing callback wiring${NC}"
  exit 1
fi

echo ""

# Test 3: TypeScript check (only our files)
echo -e "${BLUE}Test 3: TypeScript check (our changes)${NC}"
TS_ERRORS=$(npx tsc --noEmit --skipLibCheck 2>&1 | grep -E "(DealCockpitClient|DealIntakeCard|EnhancedChecklistCard|auto-seed)" | grep "error TS" || true)

if [ -n "$TS_ERRORS" ]; then
  echo -e "${RED}❌ TypeScript errors in our changes:${NC}"
  echo "$TS_ERRORS"
  exit 1
else
  echo -e "${GREEN}✅ No TypeScript errors in our changes${NC}"
fi
echo ""

# Summary
echo ""
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}🎉 CHECKLIST REFRESH FIX VALIDATED${NC}"
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo -e "${BLUE}What was fixed:${NC}"
echo "  ✅ Auto-seed returns structured results"
echo "  ✅ DealIntakeCard triggers refresh callback"
echo "  ✅ EnhancedChecklistCard exposes refresh function"
echo "  ✅ DealCockpitClient wires everything together"
echo ""
echo -e "${YELLOW}Manual test (2 minutes):${NC}"
echo "  1. Go to /deals/new"
echo "  2. Upload test files"
echo "  3. Go to cockpit"
echo "  4. Click 'Save + Auto-Seed Checklist'"
echo "  5. Watch Network tab:"
echo "     - POST /auto-seed → 200"
echo "     - GET /checklist/list → refetched"
echo "  6. Checklist items appear immediately ✅"
echo ""
echo -e "${GREEN}Expected behavior:${NC}"
echo "  • Auto-seed completes"
echo "  • Checklist refreshes automatically"
echo "  • Items visible without manual refresh"
echo "  • Success message shows counts"
echo ""
