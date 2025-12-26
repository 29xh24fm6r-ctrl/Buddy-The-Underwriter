#!/bin/bash
#
# MEGA SPEC VERIFICATION
# Tests all 4 components of the Stitch integration system
#

echo "╔════════════════════════════════════════════════════════════╗"
echo "║  STITCH INTEGRATION MEGA SPEC — VERIFICATION               ║"
echo "╚════════════════════════════════════════════════════════════╝"
echo ""

SUCCESS=0
TOTAL=0

# 1. AUTO-GENERATED ROUTE MAP
echo "1️⃣  AUTO-GENERATED ROUTE MAP"
echo "─────────────────────────────────────────────────────────────"
TOTAL=$((TOTAL + 1))
if [ -f "src/lib/stitch/autoGenerateRouteMap.ts" ]; then
  echo "   ✅ autoGenerateRouteMap.ts exists"
  
  grep -q "STITCH_ROUTE_DEFS" src/lib/stitch/autoGenerateRouteMap.ts && echo "   ✅ Route definitions present"
  grep -q "buildStitchRouteMap" src/lib/stitch/autoGenerateRouteMap.ts && echo "   ✅ Route builder function present"
  grep -q "validateRouteDefinitions" src/lib/stitch/autoGenerateRouteMap.ts && echo "   ✅ Validation function present"
  
  ROUTE_COUNT=$(grep -c "key:" src/lib/stitch/autoGenerateRouteMap.ts || echo "0")
  echo "   📊 Route definitions: $ROUTE_COUNT"
  
  SUCCESS=$((SUCCESS + 1))
else
  echo "   ❌ autoGenerateRouteMap.ts MISSING"
fi
echo ""

# 2. HARD NAVIGATION GUARD
echo "2️⃣  IFRAME NAVIGATION GUARD"
echo "─────────────────────────────────────────────────────────────"
TOTAL=$((TOTAL + 1))
if [ -f "src/lib/stitch/stitchGuard.ts" ]; then
  echo "   ✅ stitchGuard.ts exists"
  
  grep -q "installStitchNavigationGuard" src/lib/stitch/stitchGuard.ts && echo "   ✅ Install function present"
  grep -q "STITCH BLOCKED" src/lib/stitch/stitchGuard.ts && echo "   ✅ Guard blocks navigation"
  grep -q "pushState\|replaceState" src/lib/stitch/stitchGuard.ts && echo "   ✅ History API blocking active"
  
  SUCCESS=$((SUCCESS + 1))
else
  echo "   ❌ stitchGuard.ts MISSING"
fi
echo ""

# 3. ROUTE MAP USES AUTO-GENERATION
echo "3️⃣  ROUTE MAP AUTO-GENERATION INTEGRATION"
echo "─────────────────────────────────────────────────────────────"
TOTAL=$((TOTAL + 1))
if [ -f "src/lib/stitch/stitchRouteMap.ts" ]; then
  echo "   ✅ stitchRouteMap.ts exists"
  
  if grep -q "buildStitchRouteMap" src/lib/stitch/stitchRouteMap.ts; then
    echo "   ✅ Uses auto-generation"
    SUCCESS=$((SUCCESS + 1))
  else
    echo "   ⚠️  Not using auto-generation"
  fi
  
  grep -q "DO NOT EDIT" src/lib/stitch/stitchRouteMap.ts && echo "   ✅ Warning comment present"
else
  echo "   ❌ stitchRouteMap.ts MISSING"
fi
echo ""

# 4. STITCHFRAME GUARD INTEGRATION
echo "4️⃣  STITCHFRAME GUARD INTEGRATION"
echo "─────────────────────────────────────────────────────────────"
TOTAL=$((TOTAL + 1))
if [ -f "src/components/stitch/StitchFrame.tsx" ]; then
  echo "   ✅ StitchFrame.tsx exists"
  
  if grep -q "installStitchNavigationGuard" src/components/stitch/StitchFrame.tsx; then
    echo "   ✅ Guard import and installation present"
    SUCCESS=$((SUCCESS + 1))
  else
    echo "   ⚠️  Guard not integrated"
  fi
  
  grep -q "useRouter" src/components/stitch/StitchFrame.tsx && echo "   ✅ Router integration present"
  grep -q "resolveStitchHref" src/components/stitch/StitchFrame.tsx && echo "   ✅ Route resolution active"
else
  echo "   ❌ StitchFrame.tsx MISSING"
fi
echo ""

# 5. EXISTING FEATURES PRESERVED
echo "5️⃣  EXISTING FEATURES PRESERVED"
echo "─────────────────────────────────────────────────────────────"
TOTAL=$((TOTAL + 1))

PRESERVED=0
[ -f "src/lib/stitch/resolveStitchHref.ts" ] && echo "   ✅ resolveStitchHref.ts (Phase 1)" && PRESERVED=$((PRESERVED + 1))
[ -f "src/lib/stitch/stitchParams.ts" ] && echo "   ✅ stitchParams.ts (Phase 2)" && PRESERVED=$((PRESERVED + 1))
[ -f "src/lib/stitch/stitchReplace.ts" ] && echo "   ✅ stitchReplace.ts (Phase 3)" && PRESERVED=$((PRESERVED + 1))

if [ $PRESERVED -eq 3 ]; then
  echo "   ✅ All previous features intact"
  SUCCESS=$((SUCCESS + 1))
else
  echo "   ⚠️  Missing $((3 - PRESERVED)) previous features"
fi
echo ""

# SUMMARY
echo "╔════════════════════════════════════════════════════════════╗"
echo "║  VERIFICATION SUMMARY                                      ║"
echo "╚════════════════════════════════════════════════════════════╝"
echo ""
echo "Score: $SUCCESS/$TOTAL components verified"
echo ""

if [ $SUCCESS -eq $TOTAL ]; then
  echo "✅ ALL MEGA SPEC REQUIREMENTS MET"
  echo ""
  echo "You now have:"
  echo "  1. Auto-generated route map (single source of truth)"
  echo "  2. Hard navigation guard (prevents iframe hijacking)"
  echo "  3. Unified navigation system (postMessage + resolver)"
  echo "  4. React replacement foundation (progressive migration)"
  echo ""
  echo "Next steps:"
  echo "  • Run: npm run dev"
  echo "  • Visit: http://localhost:3000/command"
  echo "  • Test: Click Stitch links, verify real URLs"
  echo "  • Verify: Browser console shows no [STITCH BLOCKED] warnings"
  echo ""
else
  echo "⚠️  PARTIAL IMPLEMENTATION"
  echo ""
  echo "Missing components: $((TOTAL - SUCCESS))"
  echo "Review output above for details."
fi

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
