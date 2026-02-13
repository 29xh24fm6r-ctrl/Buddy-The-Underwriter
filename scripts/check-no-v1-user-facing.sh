#!/usr/bin/env bash
# CI Guardrail: Prevent user-facing code from importing V1 rendering entrypoints.
#
# Phase 11: V1 rendering is only allowed in admin replay endpoints.
# This script fails if user-facing routes import V1-specific symbols.
#
# Usage:
#   ./scripts/check-no-v1-user-facing.sh
#   npm run check:no-v1-user-facing

set -euo pipefail

# Folders that must not reference V1 rendering entrypoints.
TARGETS=(
  "src/app/(app)"
  "src/app/api/deals"
  "src/components"
)

# Allowlist patterns (admin replay endpoint only).
ALLOWLIST_PATHS=(
  "src/app/api/admin/deals"
)

# Grep patterns that indicate V1 renderer usage in user-facing code.
# These are the actual V1-specific symbols from this codebase.
PATTERNS=(
  "renderMoodysSpreadWithValidation"
  "renderMoodysSpread[^W]"
  "renderFromLegacySpread"
)

is_allowlisted() {
  local file="$1"
  for allow in "${ALLOWLIST_PATHS[@]}"; do
    if [[ "$file" == $allow* ]]; then
      return 0
    fi
  done
  return 1
}

fail=0

for target in "${TARGETS[@]}"; do
  [[ -d "$target" ]] || continue

  while IFS= read -r -d '' file; do
    if is_allowlisted "$file"; then
      continue
    fi

    for pat in "${PATTERNS[@]}"; do
      if grep -qE "$pat" "$file" 2>/dev/null; then
        echo "ERROR: Forbidden V1 reference in user-facing code:"
        echo "  file: $file"
        echo "  pattern: $pat"
        grep -nE "$pat" "$file" || true
        echo
        fail=1
      fi
    done
  done < <(find "$target" -type f \( -name "*.ts" -o -name "*.tsx" \) -print0)
done

if [[ "$fail" -eq 1 ]]; then
  echo "FAIL: user-facing code references V1 rendering entrypoints."
  echo "Move V1 usage to admin replay routes or remove it."
  exit 1
fi

echo "PASS: no user-facing V1 rendering references found."
