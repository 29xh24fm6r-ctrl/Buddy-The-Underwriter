#!/bin/bash
# Navigation Route Verification

set -e

echo "🗺️  Navigation Route Verification"
echo "=================================="
echo ""

check_route() {
  local route=$1
  local purpose=$2
  
  if [ -f "src/app${route}/page.tsx" ] || [ -f "src/app${route}/page.ts" ]; then
    echo "✅ ${route} - ${purpose}"
  else
    echo "❌ ${route} - ${purpose} (MISSING)"
  fi
}

echo "📋 Main Navigation Routes:"
echo "-------------------------"
check_route "/deals" "Deal list + hub"
check_route "/borrower-portal" "Borrower-facing upload"
check_route "/documents" "Staff document library"
check_route "/underwrite" "Risk analysis"
check_route "/pricing" "Structure + rate"
check_route "/credit-memo" "Approval artifact"
check_route "/servicing" "Post-close monitoring"
check_route "/admin" "Configuration"

echo ""
echo "🎯 Global Actions:"
echo "-----------------"
check_route "/command" "Command center"
check_route "/settings" "User settings"

echo ""
echo "📊 Alternative Existing Routes:"
echo "------------------------------"
echo "ℹ️  /deals/[dealId] - Deal detail page"
echo "ℹ️  /deals/[dealId]/underwriter - Underwriter view"
echo "ℹ️  /deals/[dealId]/borrower - Borrower view"
echo "ℹ️  /deals/[dealId]/sba - SBA analysis"
echo "ℹ️  /borrower/portal/[token] - Borrower portal"
echo "ℹ️  /portal/documents - Portal documents"
echo "ℹ️  /admin/templates - Admin templates"
echo "ℹ️  /servicing - Servicing page (EXISTS)"

echo ""
echo "💡 Recommendations:"
echo "------------------"
echo "1. Consider using /deals/[dealId] as the main hub"
echo "2. Add top-level routes for missing sections"
echo "3. Or update HeroBar to use existing nested routes"
echo ""
