#!/usr/bin/env bash
set -e
DEMO_STRINGS=("Highland Capital" "Project Atlas" "Titan Equities")
FOUND=0
for pattern in "${DEMO_STRINGS[@]}"; do
  matches=$(grep -rl "$pattern" src/ --include="*.tsx" --include="*.ts" 2>/dev/null || true)
  if [ -n "$matches" ]; then echo "FAIL: Demo string '$pattern' found in:"; echo "$matches"; FOUND=1; fi
done
if [ "$FOUND" -eq 1 ]; then echo ""; echo "guard:demo-data FAILED"; exit 1; fi
echo "guard:demo-data PASSED"
