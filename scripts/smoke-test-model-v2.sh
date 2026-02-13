#!/usr/bin/env bash
# Smoke test: Model Engine V2 production endpoints
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
  local need_auth=${3:-true}
  local tmpfile
  tmpfile=$(mktemp)

  local curl_args=(-s -o "$tmpfile" -w "%{http_code}")
  if [[ "$need_auth" == "true" && -n "$COOKIE" ]]; then
    curl_args+=(-b "$COOKIE")
  fi

  local status
  status=$(curl "${curl_args[@]}" "$url")

  # Fail if response is HTML (should always be JSON)
  if head -c 50 "$tmpfile" 2>/dev/null | grep -qi '<!DOCTYPE\|<html'; then
    echo "FAIL  $label  (HTTP $status, got HTML instead of JSON)"
    ((fail++)) || true
    rm -f "$tmpfile"
    return
  fi

  local ok
  ok=$(jq -r '.ok' "$tmpfile" 2>/dev/null || echo "null")

  if [[ "$status" == "200" && "$ok" == "true" ]]; then
    # Print summary info if available
    local extra=""
    local snap_id; snap_id=$(jq -r '.snapshotId // empty' "$tmpfile" 2>/dev/null)
    local v2_enabled; v2_enabled=$(jq -r '.v2_enabled // empty' "$tmpfile" 2>/dev/null)
    local metric_count; metric_count=$(jq -r '.metric_definitions.count // empty' "$tmpfile" 2>/dev/null)
    local snapshot_count; snapshot_count=$(jq -r '.deal_model_snapshots.count // empty' "$tmpfile" 2>/dev/null)
    local has_view_model; has_view_model=$(jq -r 'if .viewModel then "yes" else "no" end' "$tmpfile" 2>/dev/null)

    [[ -n "$snap_id" ]] && extra+=" snapshotId=$snap_id"
    [[ -n "$v2_enabled" ]] && extra+=" v2=$v2_enabled metrics=$metric_count snapshots=$snapshot_count"
    [[ "$has_view_model" == "yes" ]] && extra+=" viewModel=present"

    echo "PASS  $label  (HTTP $status)$extra"
    ((pass++)) || true
  else
    echo "FAIL  $label  (HTTP $status, ok=$ok)"
    head -c 200 "$tmpfile" 2>/dev/null || true
    echo ""
    ((fail++)) || true
  fi

  rm -f "$tmpfile"
}

echo "=== Model Engine V2 Production Smoke Test ==="
echo "Deal:  $DEAL_ID"
echo "Base:  $BASE_URL"
echo ""

# Health endpoint (no auth required)
check "health"       "$BASE_URL/api/health/model-v2" false

# Authenticated endpoints
check "preview"      "$BASE_URL/api/deals/$DEAL_ID/model-v2/preview"
check "parity"       "$BASE_URL/api/deals/$DEAL_ID/model-v2/parity"
check "render-diff"  "$BASE_URL/api/deals/$DEAL_ID/model-v2/render-diff"
check "moodys"       "$BASE_URL/api/deals/$DEAL_ID/spreads/moodys"

echo ""
echo "--- Results ---"
echo "$pass passed, $fail failed"

if [[ $fail -gt 0 ]]; then
  exit 1
fi
