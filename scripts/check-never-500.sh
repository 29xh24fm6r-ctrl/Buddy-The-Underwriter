#!/bin/bash
# Guardrail: Ensure critical API routes follow the "Never 500" pattern
#
# Critical routes must:
# 1. Always return HTTP 200 (errors in response body)
# 2. Use correlation IDs for tracing
# 3. Use jsonSafe or respond200 for serialization
#
# This catches routes that might crash and return 500s under edge conditions.

set -e

echo "🔍 Checking critical API routes for Never-500 pattern..."

# Critical routes that MUST follow Never-500 pattern
CRITICAL_ROUTES=(
  "src/app/api/deals/[dealId]/route.ts"
  "src/app/api/deals/[dealId]/lifecycle/route.ts"
  "src/app/api/deals/[dealId]/context/route.ts"
  "src/app/api/deals/[dealId]/checklist/list/route.ts"
  "src/app/api/deals/[dealId]/artifacts/route.ts"
  "src/app/api/deals/[dealId]/underwrite/start/route.ts"
  "src/app/api/deals/[dealId]/decision/latest/route.ts"
  "src/app/api/deals/[dealId]/financial-snapshot/decision/route.ts"
)

# Patterns that indicate Never-500 compliance
COMPLIANCE_PATTERNS=(
  "respond200"                    # Uses shared envelope helper
  "createJsonResponse"            # Uses local JSON response helper
  "status: 200"                   # Explicitly returns 200
  "jsonSafe"                      # Uses JSON-safe serialization
)

# Patterns that indicate correlation ID usage
CORRELATION_PATTERNS=(
  "correlationId"
  "x-correlation-id"
  "makeCorrelationId"
  "generateCorrelationId"
)

# Patterns that indicate route identity header (x-buddy-route)
ROUTE_IDENTITY_PATTERNS=(
  "x-buddy-route"
  "createHeaders"
)

VIOLATIONS=""
MISSING_ROUTES=""

for route in "${CRITICAL_ROUTES[@]}"; do
  if [ ! -f "$route" ]; then
    MISSING_ROUTES="$MISSING_ROUTES\n  - $route (file not found)"
    continue
  fi

  # Check for Never-500 compliance pattern
  COMPLIANT=false
  for pattern in "${COMPLIANCE_PATTERNS[@]}"; do
    if grep -q "$pattern" "$route" 2>/dev/null; then
      COMPLIANT=true
      break
    fi
  done

  if [ "$COMPLIANT" = false ]; then
    VIOLATIONS="$VIOLATIONS\n  - $route (missing Never-500 pattern)"
    continue
  fi

  # Check for correlation ID
  HAS_CORRELATION=false
  for pattern in "${CORRELATION_PATTERNS[@]}"; do
    if grep -q "$pattern" "$route" 2>/dev/null; then
      HAS_CORRELATION=true
      break
    fi
  done

  if [ "$HAS_CORRELATION" = false ]; then
    VIOLATIONS="$VIOLATIONS\n  - $route (missing correlation ID)"
    continue
  fi

  # Check for try-catch at route level (ultimate safety net)
  if ! grep -q "catch.*unexpectedErr\|catch.*err\|} catch" "$route" 2>/dev/null; then
    VIOLATIONS="$VIOLATIONS\n  - $route (missing ultimate catch block)"
  fi
done

# Report results
if [ -n "$MISSING_ROUTES" ]; then
  echo ""
  echo "⚠️  Missing critical routes:"
  echo -e "$MISSING_ROUTES"
fi

if [ -n "$VIOLATIONS" ]; then
  echo ""
  echo "❌ Never-500 pattern violations found:"
  echo -e "$VIOLATIONS"
  echo ""
  echo "Critical routes must:"
  echo "  1. Use respond200() or createJsonResponse() (never throw/500)"
  echo "  2. Include correlationId in response + x-correlation-id header"
  echo "  3. Have an ultimate catch block for unexpected errors"
  echo "  4. Use jsonSafe() to prevent serialization crashes"
  echo ""
  echo "See src/lib/api/envelope.ts for the standard pattern."
  exit 1
fi

echo "✅ All critical routes follow the Never-500 pattern."
echo ""
echo "📊 Critical route status:"
for route in "${CRITICAL_ROUTES[@]}"; do
  if [ -f "$route" ]; then
    echo "  ✓ $route"
  else
    echo "  ⚠ $route (not found)"
  fi
done

exit 0
