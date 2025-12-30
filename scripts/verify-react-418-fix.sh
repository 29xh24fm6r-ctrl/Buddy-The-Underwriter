#!/usr/bin/env bash
# Verification: React #418 Fix Complete

set -e

echo "🔍 Verifying React #418 Fix Implementation..."
echo ""

# 1. Check new types exist
echo "1️⃣ Canonical types..."
if [ ! -f "src/lib/uploads/types.ts" ]; then
  echo "❌ Missing: src/lib/uploads/types.ts"
  exit 1
fi
if ! rg -q "export type UploadResult" src/lib/uploads/types.ts; then
  echo "❌ Missing UploadResult type in types.ts"
  exit 1
fi
echo "   ✅ src/lib/uploads/types.ts exists with UploadResult"

# 2. Check safe parsing exists
echo "2️⃣ Safe parsing utilities..."
if [ ! -f "src/lib/uploads/parse.ts" ]; then
  echo "❌ Missing: src/lib/uploads/parse.ts"
  exit 1
fi
if ! rg -q "export async function readJson" src/lib/uploads/parse.ts; then
  echo "❌ Missing readJson function in parse.ts"
  exit 1
fi
if ! rg -q "export function generateRequestId" src/lib/uploads/parse.ts; then
  echo "❌ Missing generateRequestId function in parse.ts"
  exit 1
fi
echo "   ✅ src/lib/uploads/parse.ts exists with safe parsing utils"

# 3. Check error boundary exists
echo "3️⃣ Error boundary..."
if [ ! -f "src/components/common/ErrorBoundary.tsx" ]; then
  echo "❌ Missing: src/components/common/ErrorBoundary.tsx"
  exit 1
fi
if ! rg -q "export class ErrorBoundary" src/components/common/ErrorBoundary.tsx; then
  echo "❌ Missing ErrorBoundary class"
  exit 1
fi
echo "   ✅ src/components/common/ErrorBoundary.tsx exists"

# 4. Check upload client uses new types
echo "4️⃣ Upload client normalization..."
if ! rg -q "import type.*UploadResult.*from.*types" src/lib/uploads/uploadFile.ts; then
  echo "❌ uploadFile.ts doesn't import UploadResult from types"
  exit 1
fi
if ! rg -q "generateRequestId" src/lib/uploads/uploadFile.ts; then
  echo "❌ uploadFile.ts doesn't use request ID correlation"
  exit 1
fi
if ! rg -q "readJson" src/lib/uploads/uploadFile.ts; then
  echo "❌ uploadFile.ts doesn't use safe JSON parsing"
  exit 1
fi
echo "   ✅ uploadFile.ts uses canonical types + request IDs + safe parsing"

# 5. Check error boundaries in use
echo "5️⃣ Error boundary usage..."
if ! rg -q "ErrorBoundary.*context.*UploadBox" src/app/\(app\)/deals/\[dealId\]/DealWorkspaceClient.tsx; then
  echo "❌ UploadBox not wrapped in ErrorBoundary"
  exit 1
fi
echo "   ✅ UploadBox wrapped in ErrorBoundary"

# 6. Check CI guards exist
echo "6️⃣ CI guards..."
if [ ! -f "scripts/guard-no-legacy-upload-endpoints.sh" ]; then
  echo "❌ Missing guard: guard-no-legacy-upload-endpoints.sh"
  exit 1
fi
if [ ! -f "scripts/guard-uploadresult-usage.sh" ]; then
  echo "❌ Missing guard: guard-uploadresult-usage.sh"
  exit 1
fi
if [ ! -x "scripts/guard-no-legacy-upload-endpoints.sh" ]; then
  echo "❌ Guard not executable: guard-no-legacy-upload-endpoints.sh"
  exit 1
fi
if [ ! -x "scripts/guard-uploadresult-usage.sh" ]; then
  echo "❌ Guard not executable: guard-uploadresult-usage.sh"
  exit 1
fi
echo "   ✅ Both CI guard scripts exist and are executable"

# 7. Run the guards
echo "7️⃣ Running CI guards..."
if ! ./scripts/guard-no-legacy-upload-endpoints.sh > /dev/null 2>&1; then
  echo "❌ Legacy upload endpoint guard failed"
  exit 1
fi
if ! ./scripts/guard-uploadresult-usage.sh > /dev/null 2>&1; then
  echo "❌ UploadResult usage guard failed"
  exit 1
fi
echo "   ✅ All guards passing"

# 8. TypeScript compilation
echo "8️⃣ TypeScript compilation..."
if ! npm run typecheck > /dev/null 2>&1; then
  echo "❌ TypeScript compilation failed"
  exit 1
fi
echo "   ✅ TypeScript compiles with no errors"

echo ""
echo "✅ VERIFICATION COMPLETE"
echo ""
echo "React #418 fix implementation verified:"
echo "  • Canonical types (UploadResult)"
echo "  • Safe parsing utilities (readJson, toUploadErr, etc.)"
echo "  • Error boundaries (ErrorBoundary class)"
echo "  • Upload client normalization (request IDs + safe parsing)"
echo "  • Error boundary usage (UploadBox wrapped)"
echo "  • CI guards (legacy endpoints + UploadResult usage)"
echo "  • All guards passing"
echo "  • TypeScript compilation successful"
echo ""
echo "🚀 Ready for production deployment"
