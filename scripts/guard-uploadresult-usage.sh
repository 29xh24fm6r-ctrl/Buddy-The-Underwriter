#!/usr/bin/env bash
# Guard: UploadResult usage (no legacy .results[] access)

set -e

echo "🔍 Checking for legacy upload result access patterns..."

# Patterns that indicate legacy response handling (forbidden in upload contexts)
LEGACY_RESULT_PATTERNS=(
  "uploadResult\.results\["
  "result\.results\["
  "json\.results\["
  "data\.results\[0\]"
)

FOUND_VIOLATIONS=0

for pattern in "${LEGACY_RESULT_PATTERNS[@]}"; do
  echo "  Searching for: $pattern"
  
  # Search in upload-related files
  if rg -n "$pattern" src/components/deals src/app --type ts --type tsx 2>/dev/null; then
    echo "❌ VIOLATION: Found legacy .results[] access: $pattern"
    FOUND_VIOLATIONS=$((FOUND_VIOLATIONS + 1))
  fi
done

# Verify UploadResult type is imported in upload client files
echo "  Verifying UploadResult type usage..."
UPLOAD_FILES=$(rg -l "directDealDocumentUpload|uploadBorrowerFile" src --type ts --type tsx 2>/dev/null || true)

for file in $UPLOAD_FILES; do
  if ! rg -q "UploadResult" "$file" 2>/dev/null; then
    echo "⚠️  WARNING: $file uses upload functions but doesn't reference UploadResult type"
  fi
done

if [ $FOUND_VIOLATIONS -gt 0 ]; then
  echo ""
  echo "❌ FAILED: Found $FOUND_VIOLATIONS legacy result access patterns"
  echo ""
  echo "Fix: Use canonical UploadResult type:"
  echo "  const result: UploadResult = await directDealDocumentUpload(...);"
  echo "  if (!result?.ok) { ... } else { result.file_id ... }"
  echo ""
  echo "Never assume nested fields exist. Never use .results[]."
  echo ""
  exit 1
fi

echo "✅ PASSED: No legacy result access patterns found"
