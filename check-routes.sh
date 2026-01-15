#!/bin/bash
# Navigation Route Verification

set -e

echo "🗺️  Navigation Route Verification"
echo "=================================="
echo ""

missing=0
checked=0

check_route() {
  local route=$1
  local purpose=$2

  checked=$((checked + 1))

  # Next.js route groups like `(app)` don't appear in the URL path, so pages can
  # live under `src/app/(group)/...` while still resolving to `/${route}`.
  local clean="${route#/}"

  # Find any matching page.{ts,tsx} for this URL path under src/app.
  local found
  local matches
  matches=$(find src/app -type f \( -name 'page.tsx' -o -name 'page.ts' \) 2>/dev/null | grep -E "/${clean}/page\\.ts(x)?$" || true)

  # If multiple pages match (e.g. /command exists as a global page and a nested
  # deal sub-route), prefer the shortest path (closest to app root).
  found=$(printf '%s\n' "$matches" | awk -F/ 'NF { print NF ":" $0 }' | sort -n | head -n 1 | cut -d: -f2-)

  if [ -n "$found" ]; then
    echo "✅ ${route} - ${purpose} (${found})"
  else
    echo "❌ ${route} - ${purpose} (MISSING)"
    missing=$((missing + 1))
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
if [ "$missing" -eq 0 ]; then
  echo "✅ All ${checked} checked navigation routes are present."
else
  echo "1. Add pages (or alias routes) for missing sections"
  echo "2. Or update navigation links to point at the existing routes"
  echo "3. Re-run this script until missing=0"
fi
echo ""
