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
  local method=${3:-GET}
  local need_auth=${4:-true}
  local tmpfile
  tmpfile=$(mktemp)

  local curl_args=(-s -o "$tmpfile" -w "%{http_code}" -X "$method")
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
    local diff_count; diff_count=$(jq -r '.diff_events.count // empty' "$tmpfile" 2>/dev/null)
    local has_view_model; has_view_model=$(jq -r 'if .viewModel then "yes" else "no" end' "$tmpfile" 2>/dev/null)
    local shadow_enabled; shadow_enabled=$(jq -r '.shadow.enabled // empty' "$tmpfile" 2>/dev/null)

    [[ -n "$snap_id" ]] && extra+=" snapshotId=$snap_id"
    local v2_mode; v2_mode=$(jq -r '.v2_mode // empty' "$tmpfile" 2>/dev/null)
    local v2_mode_reason; v2_mode_reason=$(jq -r '.v2_mode_reason // empty' "$tmpfile" 2>/dev/null)
    local uw_mode; uw_mode=$(jq -r '.mode // empty' "$tmpfile" 2>/dev/null)
    local uw_engine; uw_engine=$(jq -r '.primaryEngine // empty' "$tmpfile" 2>/dev/null)
    local uw_fallback; uw_fallback=$(jq -r '.fallbackUsed // empty' "$tmpfile" 2>/dev/null)

    local v1_disabled; v1_disabled=$(jq -r '.v1_renderer_disabled // empty' "$tmpfile" 2>/dev/null)
    local v1_blocked; v1_blocked=$(jq -r '.v1_render_blocked.count // empty' "$tmpfile" 2>/dev/null)

    [[ -n "$v2_enabled" ]] && extra+=" v2=$v2_enabled metrics=$metric_count snapshots=$snapshot_count diffs=$diff_count"
    [[ -n "$v1_disabled" ]] && extra+=" v1_disabled=$v1_disabled v1_blocked=$v1_blocked"
    [[ -n "$v2_mode" ]] && extra+=" mode=$v2_mode reason=$v2_mode_reason"
    [[ -n "$uw_mode" && -n "$uw_engine" ]] && extra+=" engine=$uw_engine fallback=$uw_fallback"
    [[ "$has_view_model" == "yes" ]] && extra+=" viewModel=present"
    [[ "$shadow_enabled" == "true" ]] && extra+=" shadow=active"

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
check "health"       "$BASE_URL/api/health/model-v2" GET false

# Authenticated endpoints
check "preview"      "$BASE_URL/api/deals/$DEAL_ID/model-v2/preview"
check "parity"       "$BASE_URL/api/deals/$DEAL_ID/model-v2/parity"
check "render-diff"  "$BASE_URL/api/deals/$DEAL_ID/model-v2/render-diff"
check "kick"         "$BASE_URL/api/deals/$DEAL_ID/model-v2/kick" POST
check "moodys"       "$BASE_URL/api/deals/$DEAL_ID/spreads/moodys"
check "underwrite"   "$BASE_URL/api/deals/$DEAL_ID/underwrite"

# Admin endpoints (require super_admin auth)
check "replay-v2"    "$BASE_URL/api/admin/deals/$DEAL_ID/underwrite/replay?engine=v2"
check "replay-v1"    "$BASE_URL/api/admin/deals/$DEAL_ID/underwrite/replay?engine=v1"

echo ""
echo "--- Results ---"
echo "$pass passed, $fail failed"

if [[ $fail -gt 0 ]]; then
  exit 1
fi
