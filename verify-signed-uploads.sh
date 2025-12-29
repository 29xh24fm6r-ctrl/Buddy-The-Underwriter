#!/bin/bash
set -e

echo "🔍 Verifying Signed Upload Migration"
echo "====================================="
echo

echo "✅ Check 1: No FormData in deal document uploads"
if rg -n "FormData.*append.*file" src/components/deals src/app -S 2>/dev/null | grep -v "banks/assets\|admin/banks\|public/upload"; then
  echo "❌ FAIL: Found FormData usage in deal uploads"
  exit 1
else
  echo "✅ PASS: No FormData in deal uploads"
fi
echo

echo "✅ Check 2: No legacy /upload endpoint calls"
if rg -n "/api/deals/\\\$\{.*\}/upload\b" src --type tsx --type ts 2>/dev/null | grep -v "deprecated\|410"; then
  echo "❌ FAIL: Found legacy upload endpoint calls"
  exit 1
else
  echo "✅ PASS: No legacy upload calls"
fi
echo

echo "✅ Check 3: Signed upload endpoints exist"
for file in \
  "src/app/api/deals/[dealId]/files/sign/route.ts" \
  "src/app/api/deals/[dealId]/files/record/route.ts" \
  "src/app/api/borrower/portal/[token]/files/sign/route.ts"; do
  if [[ ! -f "$file" ]]; then
    echo "❌ FAIL: Missing $file"
    exit 1
  fi
done
echo "✅ PASS: All signed upload endpoints exist"
echo

echo "✅ Check 4: Client helper exists"
if [[ ! -f "src/lib/uploads/uploadFile.ts" ]]; then
  echo "❌ FAIL: Missing client helper"
  exit 1
fi
echo "✅ PASS: Client helper exists"
echo

echo "✅ Check 5: TypeScript compiles"
if npm run typecheck 2>&1 | grep -q "error TS"; then
  echo "❌ FAIL: TypeScript errors"
  exit 1
fi
echo "✅ PASS: TypeScript compiles"
echo

echo "✅ Check 6: Storage migration exists"
if [[ ! -f "supabase/migrations/20241229000001_storage_signed_uploads.sql" ]]; then
  echo "❌ FAIL: Missing storage migration"
  exit 1
fi
echo "✅ PASS: Storage migration exists"
echo

echo "========================================="
echo "🚀 ALL CHECKS PASSED - READY TO DEPLOY"
echo "========================================="
echo
echo "Next steps:"
echo "1. Run migration: psql \$DATABASE_URL -f supabase/migrations/20241229000001_storage_signed_uploads.sql"
echo "2. Test upload in dev: npm run dev"
echo "3. Deploy to Vercel"
echo
echo "Documentation: SIGNED_UPLOAD_ARCHITECTURE.md"
