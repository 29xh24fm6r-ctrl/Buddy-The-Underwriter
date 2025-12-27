#!/bin/bash

# SBA God Mode - Phase 2 Verification Script
# Tests arbitration system, bank overlays, and borrower delight components

set -e

echo "🔍 SBA God Mode Phase 2 - File Verification"
echo "=========================================="
echo ""

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Counters
TOTAL=0
PASSED=0
FAILED=0

check_file() {
  TOTAL=$((TOTAL + 1))
  if [ -f "$1" ]; then
    echo -e "${GREEN}✓${NC} $1"
    PASSED=$((PASSED + 1))
  else
    echo -e "${RED}✗${NC} $1 (MISSING)"
    FAILED=$((FAILED + 1))
  fi
}

check_dir() {
  TOTAL=$((TOTAL + 1))
  if [ -d "$1" ]; then
    echo -e "${GREEN}✓${NC} $1/"
    PASSED=$((PASSED + 1))
  else
    echo -e "${RED}✗${NC} $1/ (MISSING)"
    FAILED=$((FAILED + 1))
  fi
}

echo "📊 Database Migrations"
echo "----------------------"
check_file "supabase/migrations/20251227000002_agent_arbitration.sql"
check_file "supabase/migrations/20251227000003_bank_overlays.sql"
check_file "supabase/migrations/20251227000004_deal_truth_events.sql"
echo ""

echo "⚖️  Arbitration System (src/lib/agents/)"
echo "----------------------------------------"
check_file "src/lib/agents/claim-normalization.ts"
check_file "src/lib/agents/arbitration.ts"
check_file "src/lib/agents/bank-overlay.ts"
echo ""

echo "🔌 Arbitration API Routes"
echo "-------------------------"
check_file "src/app/api/deals/[dealId]/arbitration/ingest/route.ts"
check_file "src/app/api/deals/[dealId]/arbitration/reconcile/route.ts"
check_file "src/app/api/deals/[dealId]/arbitration/materialize/route.ts"
check_file "src/app/api/deals/[dealId]/arbitration/status/route.ts"
echo ""

echo "🎯 Borrower Delight System"
echo "--------------------------"
check_file "src/lib/borrower/readiness-score.ts"
check_file "src/components/borrower/ReadinessScoreCard.tsx"
check_file "src/components/borrower/NextBestActionCard.tsx"
check_file "src/components/borrower/SmartUploadDropzone.tsx"
check_file "src/components/borrower/MilestoneToast.tsx"
check_file "src/components/borrower/ExplainWhyDrawer.tsx"
check_file "src/app/api/deals/[dealId]/borrower/readiness-score/route.ts"
check_file "src/app/api/deals/[dealId]/explain/route.ts"
echo ""

echo "📡 Eventing System"
echo "------------------"
check_file "src/lib/events/deal-truth.ts"
echo ""

echo "🖥️  UI Components"
echo "-----------------"
check_file "src/components/agents/TruthConflictsPanel.tsx"
echo ""

echo "📝 Documentation"
echo "----------------"
check_file "SBA_GOD_MODE_PHASE_2_COMPLETE.md"
echo ""

echo "=========================================="
echo -e "Results: ${GREEN}${PASSED} passed${NC}, ${RED}${FAILED} failed${NC} out of ${TOTAL} checks"
echo ""

if [ $FAILED -eq 0 ]; then
  echo -e "${GREEN}✅ Phase 2 verification PASSED!${NC}"
  echo ""
  echo "Next steps:"
  echo "1. Apply database migrations: psql \$DATABASE_URL -f supabase/migrations/*.sql"
  echo "2. Run TypeScript compilation: npm run build"
  echo "3. Test API endpoints: curl -X POST http://localhost:3000/api/deals/{dealId}/arbitration/ingest"
  echo "4. Proceed to Phase 3: Remaining 6 agents + E-Tran package generator"
  exit 0
else
  echo -e "${RED}❌ Phase 2 verification FAILED${NC}"
  echo "Please create missing files before proceeding."
  exit 1
fi
