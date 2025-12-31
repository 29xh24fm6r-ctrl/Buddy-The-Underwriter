#!/usr/bin/env bash
# Guard: No legacy upload endpoints

set -e

echo "🔍 Checking for legacy upload endpoints..."

# Patterns that indicate legacy multipart upload (forbidden)
LEGACY_PATTERNS=(
  "/api/deals/\$\{dealId\}/upload"
  "/api/borrower/portal/.*/upload\""
  "FormData.*append.*file"
  "multipart/form-data"
)

FOUND_VIOLATIONS=0

for pattern in "${LEGACY_PATTERNS[@]}"; do
  echo "  Searching for: $pattern"
  
  if rg -n "$pattern" src --type ts --type tsx 2>/dev/null; then
    echo "❌ VIOLATION: Found legacy upload pattern: $pattern"
    FOUND_VIOLATIONS=$((FOUND_VIOLATIONS + 1))
  fi
done

# Check for signed-url only
echo "  Verifying signed URL usage..."
if ! rg -q "/files/sign" src 2>/dev/null; then
  echo "⚠️  WARNING: No /files/sign usage found (expected in upload flows)"
fi

if [ $FOUND_VIOLATIONS -gt 0 ]; then
  echo ""
  echo "❌ FAILED: Found $FOUND_VIOLATIONS legacy upload patterns"
  echo ""
  echo "Fix: All uploads must use signed URL flow:"
  echo "  1. POST /api/deals/[dealId]/files/sign"
  echo "  2. PUT <signed_url> (direct to storage)"
  echo "  3. POST /api/deals/[dealId]/files/record"
  echo ""
  exit 1
fi

echo "✅ PASSED: No legacy upload endpoints found"
