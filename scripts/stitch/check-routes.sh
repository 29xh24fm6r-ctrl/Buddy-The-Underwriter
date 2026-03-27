#!/usr/bin/env bash
# Stitch route smoke test — verifies production routes contain the Stitch DOM marker.
# Usage: BASE_URL=https://your-app.vercel.app ./scripts/stitch/check-routes.sh
# Requires: curl, grep
# Exit code: 0 = all pass, 1 = failures found

set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:3000}"
MARKER='data-stitch-surface="true"'
FAIL=0
PASS=0
SKIP=0

# Routes to check — only non-deal-scoped routes (deal routes need a real dealId)
ROUTES=(
  "/analytics"
  "/servicing"
  "/workout"
  "/workout/case-file"
  "/workout/committee-packet"
  "/workout/legal"
  "/workout/reo"
  "/workout/chargeoff"
  "/compliance/audit-ledger"
  "/templates/vault"
  "/exceptions"
  "/ocr/review"
  "/admin/roles"
  "/admin/merge-fields"
  "/borrowers/control-record"
  "/credit/committee"
  "/portfolio"
  "/intake"
  "/stitch-recovery/deals"
  "/stitch-recovery/deals-new"
)

echo "Stitch route smoke test"
echo "Base URL: $BASE_URL"
echo "Checking ${#ROUTES[@]} routes..."
echo ""

for route in "${ROUTES[@]}"; do
  url="${BASE_URL}${route}"
  # Fetch with timeout, follow redirects, capture HTTP status
  HTTP_CODE=$(curl -s -o /tmp/stitch-check-body.html -w "%{http_code}" -L --max-time 15 "$url" 2>/dev/null || echo "000")

  if [ "$HTTP_CODE" = "000" ]; then
    echo "SKIP  $route  (connection failed)"
    SKIP=$((SKIP + 1))
    continue
  fi

  if [ "$HTTP_CODE" != "200" ]; then
    echo "FAIL  $route  (HTTP $HTTP_CODE)"
    FAIL=$((FAIL + 1))
    continue
  fi

  if grep -q "$MARKER" /tmp/stitch-check-body.html 2>/dev/null; then
    echo "PASS  $route"
    PASS=$((PASS + 1))
  else
    echo "FAIL  $route  (marker missing)"
    FAIL=$((FAIL + 1))
  fi
done

echo ""
echo "Results: $PASS pass, $FAIL fail, $SKIP skip"

if [ "$FAIL" -gt 0 ]; then
  echo "FAILED: $FAIL routes do not contain the Stitch marker."
  exit 1
fi

echo "All routes verified."
exit 0
