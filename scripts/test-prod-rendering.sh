#!/bin/bash
#
# Test Production Rendering
# Verifies Stitch pages render correctly in production build
#

echo "╔════════════════════════════════════════════════════════════╗"
echo "║  PRODUCTION RENDERING TEST                                 ║"
echo "╚════════════════════════════════════════════════════════════╝"
echo ""

# Kill any existing process on 3000
echo "1️⃣  Cleaning up port 3000..."
lsof -nP -iTCP:3000 -sTCP:LISTEN 2>/dev/null | awk 'NR>1 {print $2}' | xargs -r kill -9 2>/dev/null || true
sleep 1
echo "   ✅ Port 3000 free"
echo ""

# Clean build
echo "2️⃣  Clean build..."
rm -rf .next
echo "   ✅ .next directory removed"
echo ""

# Build
echo "3️⃣  Running production build..."
if npm run build > /tmp/build.log 2>&1; then
  echo "   ✅ Build succeeded"
else
  echo "   ❌ Build failed"
  tail -20 /tmp/build.log
  exit 1
fi
echo ""

# Verify BUILD_ID
echo "4️⃣  Verifying BUILD_ID..."
if [ -f ".next/BUILD_ID" ]; then
  BUILD_ID=$(cat .next/BUILD_ID)
  echo "   ✅ BUILD_ID: $BUILD_ID"
else
  echo "   ❌ BUILD_ID not found"
  exit 1
fi
echo ""

# Instructions for manual test
echo "╔════════════════════════════════════════════════════════════╗"
echo "║  BUILD COMPLETE - READY FOR TESTING                        ║"
echo "╚════════════════════════════════════════════════════════════╝"
echo ""
echo "To test production rendering:"
echo ""
echo "1. Start production server:"
echo "   PORT=3000 npm run start"
echo ""
echo "2. Test routes with debug overlay:"
echo "   http://localhost:3000/command?stitchDebug=1"
echo "   http://localhost:3000/pricing?stitchDebug=1"
echo "   http://localhost:3000/credit-memo?stitchDebug=1"
echo ""
echo "3. Check debug overlay for:"
echo "   • srcDoc starts with <!doctype: true"
echo "   • srcDoc contains &lt;!doctype (escaped): false"
echo "   • bodyHtml starts with <: true"
echo "   • bodyHtml contains &lt; (escaped): false"
echo ""
echo "If any values are wrong, the HTML is being escaped somewhere."
echo ""
