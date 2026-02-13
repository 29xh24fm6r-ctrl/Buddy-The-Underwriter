#!/usr/bin/env bash
# Smoke test: Model Engine V2 endpoints
#
# Prerequisites:
#   - USE_MODEL_ENGINE_V2=true must be set in the target environment
#   - metric_definitions and deal_model_snapshots tables must exist
#
# Usage:
#   DEAL_ID=<uuid> BASE_URL=<url> COOKIE=<auth_cookie> ./scripts/smoke-test-model-v2.sh
#
# Examples:
#   DEAL_ID=d5c10a53-xxxx BASE_URL=http://localhost:3000 COOKIE="__session=..." ./scripts/smoke-test-model-v2.sh
#   DEAL_ID=d5c10a53-xxxx BASE_URL=https://buddy.vercel.app COOKIE="__session=..." ./scripts/smoke-test-model-v2.sh

set -euo pipefail

DEAL_ID="${DEAL_ID:?DEAL_ID is required}"
BASE_URL="${BASE_URL:-http://localhost:3000}"
COOKIE="${COOKIE:-}"

pass=0
fail=0

check() {
  local label=$1
  local url=$2
  local tmpfile
  tmpfile=$(mktemp)

  local status
  status=$(curl -s -o "$tmpfile" -w "%{http_code}" -b "$COOKIE" "$url")
  local ok
  ok=$(jq -r '.ok' "$tmpfile" 2>/dev/null || echo "null")

  if [[ "$status" == "200" && "$ok" == "true" ]]; then
    echo "PASS  $label  (HTTP $status)"
    ((pass++)) || true
  else
    echo "FAIL  $label  (HTTP $status, ok=$ok)"
    # Show first 200 chars of error response
    head -c 200 "$tmpfile" 2>/dev/null || true
    echo ""
    ((fail++)) || true
  fi

  rm -f "$tmpfile"
}

echo "=== Model Engine V2 Smoke Test ==="
echo "Deal:  $DEAL_ID"
echo "Base:  $BASE_URL"
echo ""

check "preview"     "$BASE_URL/api/deals/$DEAL_ID/model-v2/preview"
check "parity"      "$BASE_URL/api/deals/$DEAL_ID/model-v2/parity"
check "render-diff"  "$BASE_URL/api/deals/$DEAL_ID/model-v2/render-diff"

echo ""
echo "--- Results ---"
echo "$pass passed, $fail failed"

if [[ $fail -gt 0 ]]; then
  exit 1
fi
