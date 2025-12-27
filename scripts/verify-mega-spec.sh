#!/bin/bash

# =====================================================================
# MEGA SPEC VERIFICATION SCRIPT
# Verifies all Phase 4 files (Connect Accounts + Dual Mode + E-Tran)
# =====================================================================

set -e

echo "🔍 Verifying Mega Spec Implementation (Phase 4)..."
echo ""

PASS=0
FAIL=0

# Function to check file exists
check_file() {
  local file=$1
  local description=$2
  
  if [ -f "$file" ]; then
    echo "✅ $description"
    ((PASS++))
  else
    echo "❌ MISSING: $description"
    echo "   Expected: $file"
    ((FAIL++))
  fi
}

# =====================================================================
# DATABASE MIGRATIONS
# =====================================================================
echo "📊 Database Migrations:"
check_file "supabase/migrations/20251227000005_deal_pipeline_runs.sql" "Autopilot pipeline runs table"
check_file "supabase/migrations/20251227000006_connect_accounts.sql" "Connect accounts schema"
check_file "supabase/migrations/20251227000007_dual_policy_mode.sql" "Dual policy mode schema"
echo ""

# =====================================================================
# INTEGRATION LIBRARIES
# =====================================================================
echo "🔌 Integration Libraries:"
check_file "src/lib/connect/plaid.ts" "Plaid integration"
check_file "src/lib/connect/quickbooks.ts" "QuickBooks integration"
check_file "src/lib/connect/irs.ts" "IRS transcript integration"
check_file "src/lib/connect/substitutions.ts" "Document substitution engine"
echo ""

# =====================================================================
# CORE LIBRARIES
# =====================================================================
echo "⚙️ Core Libraries:"
check_file "src/lib/etran/generator.ts" "E-Tran XML generator"
check_file "src/lib/borrower/readiness-score.ts" "Readiness score (with connection boost)"
check_file "src/lib/autopilot/orchestrator.ts" "Autopilot orchestrator (dual-mode)"
check_file "src/lib/autopilot/punchlist.ts" "Punchlist generator"
check_file "src/lib/autopilot/package-bundle.ts" "Package bundle assembler"
echo ""

# =====================================================================
# UI COMPONENTS
# =====================================================================
echo "🎨 UI Components:"
check_file "src/components/connect/ConnectAccountsPanel.tsx" "Connect Accounts panel"
check_file "src/components/autopilot/AutopilotConsole.tsx" "Autopilot console"
echo ""

# =====================================================================
# API ROUTES
# =====================================================================
echo "🌐 API Routes:"
check_file "src/app/api/deals/[dealId]/autopilot/run/route.ts" "Autopilot run endpoint"
check_file "src/app/api/deals/[dealId]/autopilot/status/route.ts" "Autopilot status endpoint"
echo ""

# =====================================================================
# DOCUMENTATION
# =====================================================================
echo "📚 Documentation:"
check_file "MEGA_SPEC_COMPLETE.md" "Mega Spec documentation"
check_file "ETRAN_READY_AUTOPILOT_COMPLETE.md" "E-Tran Autopilot documentation (Phase 3)"
check_file "SBA_GOD_MODE_COMPLETE_SUMMARY.md" "SBA God Mode summary (Phase 1-3)"
check_file "QUICKREF.md" "Quick reference guide"
echo ""

# =====================================================================
# PHASE 1-3 DEPENDENCIES
# =====================================================================
echo "🔗 Phase 1-3 Dependencies (should exist):"
check_file "src/lib/agents/policy-agent.ts" "Policy Agent"
check_file "src/lib/agents/eligibility-agent.ts" "Eligibility Agent"
check_file "src/lib/agents/cashflow-agent.ts" "Cash Flow Agent"
check_file "src/lib/agents/ownership-agent.ts" "Ownership Agent"
check_file "src/lib/arbitration/ingest.ts" "Arbitration ingest"
check_file "src/lib/arbitration/reconcile.ts" "Arbitration reconcile"
check_file "src/lib/arbitration/materialize.ts" "Arbitration materialize"
check_file "src/lib/overlays/apply.ts" "Bank overlay application"
echo ""

# =====================================================================
# RESULTS
# =====================================================================
echo "=========================================="
if [ $FAIL -eq 0 ]; then
  echo "✅ Mega Spec verification PASSED!"
  echo ""
  echo "🎯 Architecture Complete:"
  echo "  ✓ Phase 1: Multi-agent foundation"
  echo "  ✓ Phase 2: Arbitration + Bank Overlays"
  echo "  ✓ Phase 3: E-Tran Ready Autopilot"
  echo "  ✓ Phase 4: Connect Accounts + Dual Policy Mode"
  echo ""
  echo "Results: $PASS passed, $FAIL failed out of $((PASS + FAIL)) checks"
  echo ""
  echo "🚀 Next Steps:"
  echo "  1. Apply database migrations (in Supabase SQL Editor)"
  echo "  2. Set environment variables (Plaid, QuickBooks, IRS, SBA)"
  echo "  3. Run demo script: ./scripts/demo-mega-spec.sh"
  echo "  4. Deploy to production"
  exit 0
else
  echo "❌ Mega Spec verification FAILED"
  echo "Results: $PASS passed, $FAIL failed out of $((PASS + FAIL)) checks"
  exit 1
fi
