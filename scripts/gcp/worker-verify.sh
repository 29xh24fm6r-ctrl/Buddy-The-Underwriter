#!/usr/bin/env bash
set -euo pipefail

PROJECT="${PROJECT:-buddy-the-underwriter}"
REGION="${REGION:-us-central1}"
SERVICE="${SERVICE:-buddy-core-worker}"

need() { command -v "$1" >/dev/null 2>&1 || { echo "missing dependency: $1" >&2; exit 1; }; }
need gcloud

gcloud config set project "$PROJECT" >/dev/null
gcloud config set run/region "$REGION" >/dev/null

# ─── Check last build (optional) ─────────────────────────────────────────────

if [[ -f /tmp/buddy-worker-last-build-id ]]; then
  BUILD_ID="$(cat /tmp/buddy-worker-last-build-id)"
  echo "[verify] last build: $BUILD_ID"
  BUILD_STATUS="$(gcloud builds describe "$BUILD_ID" --region "$REGION" --format="value(status)" 2>/dev/null || echo "UNKNOWN")"
  echo "[verify] build status: $BUILD_STATUS"
else
  echo "[verify] no previous build ID found (skipping build check)"
fi

# ─── Check Cloud Run service ─────────────────────────────────────────────────

echo "[verify] checking service exists"
gcloud run services describe "$SERVICE" >/dev/null

echo "[verify] tailing recent logs (last 2 minutes)"
TMP="$(mktemp)"
gcloud run services logs read "$SERVICE" --limit 200 --freshness=2m > "$TMP" || true

# Heuristics: fail on known bad signals
if grep -qi "password authentication failed\|permission denied\|row-level security\|RLS" "$TMP"; then
  echo "[verify] FAIL: detected DB auth/RLS errors"
  grep -n "password authentication failed\|permission denied\|row-level security\|RLS" "$TMP" || true
  exit 1
fi

if ! grep -qi "mcp_tick\|tick" "$TMP"; then
  echo "[verify][warn] no mcp_tick seen in recent logs; check if worker is emitting tick logs"
fi

echo "[verify] PASS (no DB/RLS errors in recent logs)"
