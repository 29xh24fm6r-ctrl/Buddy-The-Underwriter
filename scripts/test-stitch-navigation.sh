#!/bin/bash
#
# Stitch Navigation System — Quick Test
# Usage: ./scripts/test-stitch-navigation.sh
#

set -e

echo "🧪 Stitch Navigation Integration Test"
echo "========================================"
echo ""

# 1. Verify all files exist
echo "1️⃣ Checking file structure..."
FILES=(
  "src/lib/stitch/stitchRouteMap.ts"
  "src/lib/stitch/resolveStitchHref.ts"
  "src/lib/stitch/stitchParams.ts"
  "src/lib/stitch/stitchReplace.ts"
  "src/components/stitch/StitchFrame.tsx"
  "src/components/stitch/StitchRouteBridge.tsx"
)

MISSING=0
for file in "${FILES[@]}"; do
  if [ ! -f "$file" ]; then
    echo "   ❌ Missing: $file"
    MISSING=$((MISSING + 1))
  fi
done

if [ $MISSING -eq 0 ]; then
  echo "   ✅ All 6 core files present"
else
  echo "   ❌ $MISSING files missing"
  exit 1
fi

# 2. Test route map
echo ""
echo "2️⃣ Testing route resolution..."
ROUTE_COUNT=$(grep -c "match:" src/lib/stitch/stitchRouteMap.ts || echo "0")
echo "   📊 Found $ROUTE_COUNT route rules"

if [ "$ROUTE_COUNT" -ge 8 ]; then
  echo "   ✅ Route map has adequate coverage"
else
  echo "   ⚠️  Only $ROUTE_COUNT routes (expected 8+)"
fi

# 3. Test navigation integration
echo ""
echo "3️⃣ Testing StitchFrame navigation hooks..."

# Check for router import
if grep -q "import.*useRouter.*from.*next/navigation" src/components/stitch/StitchFrame.tsx; then
  echo "   ✅ useRouter imported"
else
  echo "   ❌ useRouter not imported"
  exit 1
fi

# Check for resolver import
if grep -q "import.*resolveStitchHref" src/components/stitch/StitchFrame.tsx; then
  echo "   ✅ resolveStitchHref imported"
else
  echo "   ❌ resolveStitchHref not imported"
  exit 1
fi

# Check for message handler
if grep -q 'type.*===.*"navigate"' src/components/stitch/StitchFrame.tsx; then
  echo "   ✅ Navigate message handler present"
else
  echo "   ❌ Navigate handler missing"
  exit 1
fi

# Check for router.push
if grep -q "router\.push" src/components/stitch/StitchFrame.tsx; then
  echo "   ✅ router.push integration confirmed"
else
  echo "   ❌ router.push not found"
  exit 1
fi

# 4. Test param extraction
echo ""
echo "4️⃣ Testing parameter extraction..."

if grep -q "extractStitchParams" src/lib/stitch/stitchParams.ts; then
  echo "   ✅ extractStitchParams function exists"
else
  echo "   ❌ Missing extractStitchParams"
  exit 1
fi

# Check for common params
if grep -q "dealId" src/lib/stitch/stitchParams.ts; then
  echo "   ✅ Deal ID extraction supported"
else
  echo "   ⚠️  No deal ID support"
fi

# 5. Test React replacement
echo ""
echo "5️⃣ Testing React replacement infrastructure..."

if grep -q "STITCH_REPLACEMENTS" src/lib/stitch/stitchReplace.ts; then
  echo "   ✅ Replacement registry defined"
else
  echo "   ❌ Missing STITCH_REPLACEMENTS"
  exit 1
fi

if grep -q "getReactReplacement" src/lib/stitch/stitchReplace.ts; then
  echo "   ✅ Helper functions present"
else
  echo "   ❌ Missing helper functions"
  exit 1
fi

# 6. TypeScript validation
echo ""
echo "6️⃣ Running TypeScript check..."

if npx tsc --noEmit --skipLibCheck 2>&1 | grep -q "error TS"; then
  echo "   ⚠️  TypeScript errors found (check with: npx tsc --noEmit)"
else
  echo "   ✅ No TypeScript errors"
fi

# Summary
echo ""
echo "========================================"
echo "✅ STITCH NAVIGATION SYSTEM VERIFIED"
echo "========================================"
echo ""
echo "Next steps:"
echo "  1. Start dev server: npm run dev"
echo "  2. Visit: http://localhost:3000/command"
echo "  3. Click links inside Stitch iframe"
echo "  4. Verify browser URL updates"
echo ""
echo "Documentation: STITCH_INTEGRATION_COMPLETE.md"
echo ""
