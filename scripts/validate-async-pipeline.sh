#!/bin/bash
# Validation script for async pipeline implementation

set -e

echo "🔥 ASYNC PIPELINE VALIDATION"
echo "=============================="
echo ""

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Check DATABASE_URL
if [ -z "$DATABASE_URL" ]; then
  echo -e "${RED}❌ DATABASE_URL not set${NC}"
  exit 1
fi

echo -e "${GREEN}✅ DATABASE_URL configured${NC}"
echo ""

# Test 1: Check migration file exists
echo -e "${BLUE}Test 1: Migration file exists${NC}"
if [ -f "supabase/migrations/20251230000000_deal_pipeline_ledger.sql" ]; then
  echo -e "${GREEN}✅ Migration file found${NC}"
else
  echo -e "${RED}❌ Migration file missing${NC}"
  exit 1
fi
echo ""

# Test 2: Check new API routes exist
echo -e "${BLUE}Test 2: API routes exist${NC}"
ROUTES=(
  "src/app/api/deals/[dealId]/auto-seed/route.ts"
  "src/app/api/deals/[dealId]/pipeline/latest/route.ts"
)

for route in "${ROUTES[@]}"; do
  if [ -f "$route" ]; then
    echo -e "${GREEN}✅ $route${NC}"
  else
    echo -e "${RED}❌ $route missing${NC}"
    exit 1
  fi
done
echo ""

# Test 3: Check components exist
echo -e "${BLUE}Test 3: Components exist${NC}"
COMPONENTS=(
  "src/components/SafeBoundary.tsx"
  "src/components/deals/PipelineStatus.tsx"
)

for comp in "${COMPONENTS[@]}"; do
  if [ -f "$comp" ]; then
    echo -e "${GREEN}✅ $comp${NC}"
  else
    echo -e "${RED}❌ $comp missing${NC}"
    exit 1
  fi
done
echo ""

# Test 4: Apply migration (if not already applied)
echo -e "${BLUE}Test 4: Apply migration${NC}"
if psql "$DATABASE_URL" -c "SELECT 1 FROM information_schema.tables WHERE table_name = 'deal_pipeline_ledger'" | grep -q 1; then
  echo -e "${YELLOW}⚠️  Table already exists (migration already applied)${NC}"
else
  echo "Applying migration..."
  psql "$DATABASE_URL" -f supabase/migrations/20251230000000_deal_pipeline_ledger.sql
  echo -e "${GREEN}✅ Migration applied${NC}"
fi
echo ""

# Test 5: Verify table structure
echo -e "${BLUE}Test 5: Verify table structure${NC}"
TABLE_CHECK=$(psql "$DATABASE_URL" -t -c "
  SELECT COUNT(*) 
  FROM information_schema.columns 
  WHERE table_name = 'deal_pipeline_ledger' 
  AND column_name IN ('id', 'deal_id', 'bank_id', 'stage', 'status', 'payload', 'error', 'created_at')
")

if [ "$TABLE_CHECK" -eq 8 ]; then
  echo -e "${GREEN}✅ All required columns present${NC}"
else
  echo -e "${RED}❌ Table structure incomplete (found $TABLE_CHECK/8 columns)${NC}"
  exit 1
fi
echo ""

# Test 6: Verify helper functions
echo -e "${BLUE}Test 6: Verify helper functions${NC}"
FUNCTIONS=(
  "get_deal_pipeline_latest_stage"
  "get_deal_pipeline_history"
)

for func in "${FUNCTIONS[@]}"; do
  if psql "$DATABASE_URL" -t -c "SELECT 1 FROM pg_proc WHERE proname = '$func'" | grep -q 1; then
    echo -e "${GREEN}✅ Function: $func${NC}"
  else
    echo -e "${RED}❌ Function missing: $func${NC}"
    exit 1
  fi
done
echo ""

# Test 7: Verify indexes
echo -e "${BLUE}Test 7: Verify indexes${NC}"
INDEX_COUNT=$(psql "$DATABASE_URL" -t -c "
  SELECT COUNT(*) 
  FROM pg_indexes 
  WHERE tablename = 'deal_pipeline_ledger'
")

if [ "$INDEX_COUNT" -ge 3 ]; then
  echo -e "${GREEN}✅ Indexes created ($INDEX_COUNT found)${NC}"
else
  echo -e "${YELLOW}⚠️  Expected 3+ indexes, found $INDEX_COUNT${NC}"
fi
echo ""

# Test 8: TypeScript compilation
echo -e "${BLUE}Test 8: TypeScript check${NC}"
if npx tsc --noEmit --skipLibCheck 2>&1 | grep -q "error TS"; then
  echo -e "${RED}❌ TypeScript errors found${NC}"
  npx tsc --noEmit --skipLibCheck 2>&1 | grep "error TS" | head -5
  exit 1
else
  echo -e "${GREEN}✅ No TypeScript errors${NC}"
fi
echo ""

# Summary
echo ""
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}🎉 ALL VALIDATION TESTS PASSED${NC}"
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo -e "${BLUE}Next steps:${NC}"
echo "1. Test upload → auto-seed flow in UI"
echo "2. Monitor deal_pipeline_ledger table"
echo "3. Check error boundaries work"
echo "4. Deploy to staging"
echo ""
echo -e "${YELLOW}To test manually:${NC}"
echo "  1. Go to /deals/new"
echo "  2. Upload files"
echo "  3. Click 'Start Deal Processing'"
echo "  4. In cockpit, click 'Save + Auto-Seed Checklist'"
echo "  5. Verify no crashes, checklist created"
echo ""
