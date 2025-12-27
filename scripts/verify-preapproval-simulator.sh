#!/bin/bash

# =========================================================
# Pre-Approval Simulator Verification Script
# =========================================================
# Verifies all Phase 5 components are properly installed
# Usage: ./scripts/verify-preapproval-simulator.sh

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

ERRORS=0

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}Pre-Approval Simulator Verification${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""

# =========================================================
# 1. Check Database Migration
# =========================================================
echo -e "${YELLOW}1. Checking database migration...${NC}"

if [ -f "supabase/migrations/20251227000008_preapproval_simulator.sql" ]; then
  echo -e "${GREEN}✓${NC} Migration file exists"
  
  # Check for key tables
  if grep -q "CREATE TABLE preapproval_sim_runs" supabase/migrations/20251227000008_preapproval_simulator.sql; then
    echo -e "${GREEN}✓${NC} preapproval_sim_runs table defined"
  else
    echo -e "${RED}✗${NC} preapproval_sim_runs table missing"
    ERRORS=$((ERRORS + 1))
  fi
  
  if grep -q "CREATE TABLE preapproval_sim_results" supabase/migrations/20251227000008_preapproval_simulator.sql; then
    echo -e "${GREEN}✓${NC} preapproval_sim_results table defined"
  else
    echo -e "${RED}✗${NC} preapproval_sim_results table missing"
    ERRORS=$((ERRORS + 1))
  fi
  
  if grep -q "CREATE TYPE sim_status" supabase/migrations/20251227000008_preapproval_simulator.sql; then
    echo -e "${GREEN}✓${NC} sim_status enum defined"
  else
    echo -e "${RED}✗${NC} sim_status enum missing"
    ERRORS=$((ERRORS + 1))
  fi
  
  if grep -q "CREATE OR REPLACE FUNCTION get_latest_simulation" supabase/migrations/20251227000008_preapproval_simulator.sql; then
    echo -e "${GREEN}✓${NC} get_latest_simulation() function defined"
  else
    echo -e "${RED}✗${NC} get_latest_simulation() function missing"
    ERRORS=$((ERRORS + 1))
  fi
  
  if grep -q "CREATE OR REPLACE FUNCTION log_sim_stage" supabase/migrations/20251227000008_preapproval_simulator.sql; then
    echo -e "${GREEN}✓${NC} log_sim_stage() function defined"
  else
    echo -e "${RED}✗${NC} log_sim_stage() function missing"
    ERRORS=$((ERRORS + 1))
  fi
else
  echo -e "${RED}✗${NC} Migration file not found"
  ERRORS=$((ERRORS + 1))
fi

echo ""

# =========================================================
# 2. Check Type Definitions
# =========================================================
echo -e "${YELLOW}2. Checking type definitions...${NC}"

if [ -f "src/lib/preapproval/types.ts" ]; then
  echo -e "${GREEN}✓${NC} types.ts exists"
  
  # Check for key types
  TYPES=("SimMode" "SimOutcomeStatus" "SimReason" "SimOutcome" "SimOffer" "SimPunchlist" "SimResult" "SimRun" "SimResultRecord")
  
  for TYPE in "${TYPES[@]}"; do
    if grep -q "export.*$TYPE" src/lib/preapproval/types.ts; then
      echo -e "${GREEN}✓${NC} $TYPE type exported"
    else
      echo -e "${RED}✗${NC} $TYPE type missing"
      ERRORS=$((ERRORS + 1))
    fi
  done
else
  echo -e "${RED}✗${NC} types.ts not found"
  ERRORS=$((ERRORS + 1))
fi

echo ""

# =========================================================
# 3. Check Policy Packs
# =========================================================
echo -e "${YELLOW}3. Checking policy packs...${NC}"

if [ -f "src/lib/policy/packs/sba_preapproval.ts" ]; then
  echo -e "${GREEN}✓${NC} sba_preapproval.ts exists"
  
  if grep -q "export const SBA_PREAPPROVAL" src/lib/policy/packs/sba_preapproval.ts; then
    echo -e "${GREEN}✓${NC} SBA_PREAPPROVAL pack exported"
  else
    echo -e "${RED}✗${NC} SBA_PREAPPROVAL pack missing"
    ERRORS=$((ERRORS + 1))
  fi
else
  echo -e "${RED}✗${NC} sba_preapproval.ts not found"
  ERRORS=$((ERRORS + 1))
fi

if [ -f "src/lib/policy/packs/conventional_preapproval.ts" ]; then
  echo -e "${GREEN}✓${NC} conventional_preapproval.ts exists"
  
  if grep -q "export const CONVENTIONAL_PREAPPROVAL" src/lib/policy/packs/conventional_preapproval.ts; then
    echo -e "${GREEN}✓${NC} CONVENTIONAL_PREAPPROVAL pack exported"
  else
    echo -e "${RED}✗${NC} CONVENTIONAL_PREAPPROVAL pack missing"
    ERRORS=$((ERRORS + 1))
  fi
else
  echo -e "${RED}✗${NC} conventional_preapproval.ts not found"
  ERRORS=$((ERRORS + 1))
fi

echo ""

# =========================================================
# 4. Check Simulation Engine
# =========================================================
echo -e "${YELLOW}4. Checking simulation engine...${NC}"

if [ -f "src/lib/preapproval/simulate.ts" ]; then
  echo -e "${GREEN}✓${NC} simulate.ts exists"
  
  # Check for key functions
  FUNCTIONS=("simulatePreapproval" "gatherDealInputs" "evaluateSBAViability" "evaluateConventionalViability" "generateOfferRanges" "generatePunchlist" "calculateOverallConfidence")
  
  for FUNC in "${FUNCTIONS[@]}"; do
    if grep -q "function $FUNC" src/lib/preapproval/simulate.ts || grep -q "const $FUNC" src/lib/preapproval/simulate.ts; then
      echo -e "${GREEN}✓${NC} $FUNC() function defined"
    else
      echo -e "${RED}✗${NC} $FUNC() function missing"
      ERRORS=$((ERRORS + 1))
    fi
  done
  
  # Check for integration with Phase 4
  if grep -q "getSubstitutionSummary" src/lib/preapproval/simulate.ts; then
    echo -e "${GREEN}✓${NC} Integration with Phase 4 (getSubstitutionSummary)"
  else
    echo -e "${YELLOW}⚠${NC} Missing Phase 4 integration (getSubstitutionSummary)"
  fi
else
  echo -e "${RED}✗${NC} simulate.ts not found"
  ERRORS=$((ERRORS + 1))
fi

echo ""

# =========================================================
# 5. Check API Routes
# =========================================================
echo -e "${YELLOW}5. Checking API routes...${NC}"

if [ -f "src/app/api/deals/[dealId]/preapproval/run/route.ts" ]; then
  echo -e "${GREEN}✓${NC} run/route.ts exists"
  
  if grep -q "export async function POST" src/app/api/deals/[dealId]/preapproval/run/route.ts; then
    echo -e "${GREEN}✓${NC} POST handler exported"
  else
    echo -e "${RED}✗${NC} POST handler missing"
    ERRORS=$((ERRORS + 1))
  fi
  
  if grep -q "simulatePreapproval" src/app/api/deals/[dealId]/preapproval/run/route.ts; then
    echo -e "${GREEN}✓${NC} Calls simulatePreapproval()"
  else
    echo -e "${RED}✗${NC} Missing simulatePreapproval() call"
    ERRORS=$((ERRORS + 1))
  fi
else
  echo -e "${RED}✗${NC} run/route.ts not found"
  ERRORS=$((ERRORS + 1))
fi

if [ -f "src/app/api/deals/[dealId]/preapproval/status/route.ts" ]; then
  echo -e "${GREEN}✓${NC} status/route.ts exists"
  
  if grep -q "export async function GET" src/app/api/deals/[dealId]/preapproval/status/route.ts; then
    echo -e "${GREEN}✓${NC} GET handler exported"
  else
    echo -e "${RED}✗${NC} GET handler missing"
    ERRORS=$((ERRORS + 1))
  fi
  
  if grep -q "preapproval_sim_runs" src/app/api/deals/[dealId]/preapproval/status/route.ts; then
    echo -e "${GREEN}✓${NC} Queries preapproval_sim_runs table"
  else
    echo -e "${RED}✗${NC} Missing preapproval_sim_runs query"
    ERRORS=$((ERRORS + 1))
  fi
  
  if grep -q "preapproval_sim_results" src/app/api/deals/[dealId]/preapproval/status/route.ts; then
    echo -e "${GREEN}✓${NC} Queries preapproval_sim_results table"
  else
    echo -e "${RED}✗${NC} Missing preapproval_sim_results query"
    ERRORS=$((ERRORS + 1))
  fi
else
  echo -e "${RED}✗${NC} status/route.ts not found"
  ERRORS=$((ERRORS + 1))
fi

echo ""

# =========================================================
# 6. Check UI Components
# =========================================================
echo -e "${YELLOW}6. Checking UI components...${NC}"

if [ -f "src/components/preapproval/PreapprovalSimulator.tsx" ]; then
  echo -e "${GREEN}✓${NC} PreapprovalSimulator.tsx exists"
  
  if grep -q '"use client"' src/components/preapproval/PreapprovalSimulator.tsx; then
    echo -e "${GREEN}✓${NC} Marked as client component"
  else
    echo -e "${RED}✗${NC} Missing 'use client' directive"
    ERRORS=$((ERRORS + 1))
  fi
  
  if grep -q "runSimulation" src/components/preapproval/PreapprovalSimulator.tsx; then
    echo -e "${GREEN}✓${NC} runSimulation() function defined"
  else
    echo -e "${RED}✗${NC} runSimulation() function missing"
    ERRORS=$((ERRORS + 1))
  fi
  
  if grep -q "useEffect" src/components/preapproval/PreapprovalSimulator.tsx; then
    echo -e "${GREEN}✓${NC} Polling logic with useEffect"
  else
    echo -e "${RED}✗${NC} Missing polling logic"
    ERRORS=$((ERRORS + 1))
  fi
else
  echo -e "${RED}✗${NC} PreapprovalSimulator.tsx not found"
  ERRORS=$((ERRORS + 1))
fi

if [ -f "src/app/deals/[dealId]/preapproval/page.tsx" ]; then
  echo -e "${GREEN}✓${NC} page.tsx exists"
  
  if grep -q "PreapprovalSimulator" src/app/deals/[dealId]/preapproval/page.tsx; then
    echo -e "${GREEN}✓${NC} Renders PreapprovalSimulator component"
  else
    echo -e "${RED}✗${NC} Missing PreapprovalSimulator component"
    ERRORS=$((ERRORS + 1))
  fi
  
  if grep -q "await params" src/app/deals/[dealId]/preapproval/page.tsx; then
    echo -e "${GREEN}✓${NC} Awaits async params (Next.js 16 pattern)"
  else
    echo -e "${YELLOW}⚠${NC} Missing 'await params' (may break on Next.js 16)"
  fi
else
  echo -e "${RED}✗${NC} page.tsx not found"
  ERRORS=$((ERRORS + 1))
fi

echo ""

# =========================================================
# 7. Check Documentation
# =========================================================
echo -e "${YELLOW}7. Checking documentation...${NC}"

if [ -f "PREAPPROVAL_SIMULATOR_COMPLETE.md" ]; then
  echo -e "${GREEN}✓${NC} PREAPPROVAL_SIMULATOR_COMPLETE.md exists"
  
  SECTIONS=("Architecture" "API Routes" "UI Components" "Policy Pack Details" "Confidence Scoring")
  
  for SECTION in "${SECTIONS[@]}"; do
    if grep -q "$SECTION" PREAPPROVAL_SIMULATOR_COMPLETE.md; then
      echo -e "${GREEN}✓${NC} $SECTION section present"
    else
      echo -e "${YELLOW}⚠${NC} $SECTION section missing"
    fi
  done
else
  echo -e "${RED}✗${NC} PREAPPROVAL_SIMULATOR_COMPLETE.md not found"
  ERRORS=$((ERRORS + 1))
fi

echo ""

# =========================================================
# 8. Check Demo Script
# =========================================================
echo -e "${YELLOW}8. Checking demo script...${NC}"

if [ -f "scripts/demo-preapproval-simulator.sh" ]; then
  echo -e "${GREEN}✓${NC} demo-preapproval-simulator.sh exists"
  
  if [ -x "scripts/demo-preapproval-simulator.sh" ]; then
    echo -e "${GREEN}✓${NC} Script is executable"
  else
    echo -e "${YELLOW}⚠${NC} Script is not executable (run: chmod +x scripts/demo-preapproval-simulator.sh)"
  fi
else
  echo -e "${RED}✗${NC} demo-preapproval-simulator.sh not found"
  ERRORS=$((ERRORS + 1))
fi

echo ""

# =========================================================
# 9. Summary
# =========================================================
echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}Verification Summary${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""

if [ $ERRORS -eq 0 ]; then
  echo -e "${GREEN}✓ All checks passed! Phase 5 is ready to ship. 🚀${NC}"
  echo ""
  echo -e "${BLUE}Next Steps:${NC}"
  echo "1. Apply database migration: supabase/migrations/20251227000008_preapproval_simulator.sql"
  echo "2. Run demo: ./scripts/demo-preapproval-simulator.sh <dealId>"
  echo "3. Test UI: Visit /deals/[dealId]/preapproval"
  exit 0
else
  echo -e "${RED}✗ $ERRORS errors found. Please fix before deploying.${NC}"
  exit 1
fi
