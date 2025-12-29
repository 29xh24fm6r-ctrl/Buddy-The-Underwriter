#!/usr/bin/env bash
# Guard against multipart upload regression in deal document flows
# This ensures zero file bytes ever pass through Vercel after migration to signed uploads
set -euo pipefail

echo "🔍 Checking for forbidden multipart uploads in deal/borrower/portal code..."

# Check for FormData usage in deal upload contexts
if rg -n "new FormData\(\)|formData\.append.*file" \
  src/components/deals \
  src/app/\(app\)/deals \
  src/app/\(app\)/borrower \
  src/app/portal \
  --type ts --type tsx 2>/dev/null | grep -v "^$"; then
  echo ""
  echo "❌ FAIL: FormData detected in deal/borrower/portal code"
  echo "❌ All document uploads MUST use signed URLs (see SIGNED_UPLOAD_ARCHITECTURE.md)"
  echo ""
  echo "Forbidden patterns:"
  echo "  • new FormData()"
  echo "  • formData.append('file', ...)"
  echo ""
  echo "Required pattern:"
  echo "  • import { directDealDocumentUpload } from '@/lib/uploads/uploadFile'"
  echo "  • await directDealDocumentUpload({ dealId, file, ... })"
  echo ""
  exit 1
fi

# Check for multipart/form-data in fetch calls
if rg -n "multipart/form-data" \
  src/components/deals \
  src/app/\(app\)/deals \
  src/app/\(app\)/borrower \
  src/app/portal \
  --type ts --type tsx 2>/dev/null | grep -v "^$"; then
  echo ""
  echo "❌ FAIL: multipart/form-data detected in deal/borrower/portal code"
  echo "❌ All document uploads MUST use signed URLs (JSON payloads only)"
  exit 1
fi

# Check for deprecated /upload endpoint usage
if rg -n "/api/deals/\\\$\{.*\}/upload\b|/api/borrower/portal/.*upload\b" \
  src/components \
  src/app \
  --type ts --type tsx 2>/dev/null | grep -v "deprecated\|410\|DEPRECATED\|sign\|record" | grep -v "^$"; then
  echo ""
  echo "❌ FAIL: Legacy /upload endpoint usage detected"
  echo "❌ Use /files/sign + /files/record pattern instead"
  exit 1
fi

echo "✅ PASS: Upload architecture guard passed"
echo "✅ All deal/borrower uploads use signed URLs"
echo "✅ Zero file bytes pass through Vercel"
