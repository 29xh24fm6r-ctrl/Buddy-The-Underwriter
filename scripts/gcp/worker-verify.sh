#!/usr/bin/env bash
set -euo pipefail

PROJECT="${PROJECT:-buddy-the-underwriter}"
REGION="${REGION:-us-central1}"
SERVICE="${SERVICE:-buddy-core-worker}"

need() { command -v "$1" >/dev/null 2>&1 || { echo "missing dependency: $1" >&2; exit 1; }; }
need gcloud
need curl

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

# ─── Assert revision is ready ────────────────────────────────────────────────

REV="$(gcloud run services describe "$SERVICE" --region "$REGION" --format="value(status.latestReadyRevisionName)")"
if [ -z "${REV}" ]; then
  echo "[verify] FAIL: no latestReadyRevisionName (service not ready)"; exit 1;
fi
echo "[verify] ready revision: ${REV}"

# ─── Authenticated /healthz check ────────────────────────────────────────────

URL="$(gcloud run services describe "$SERVICE" --region "$REGION" --format="value(status.url)")"
TOKEN="$(gcloud auth print-identity-token)"
CODE="$(curl -s -o /dev/null -w "%{http_code}" -H "Authorization: Bearer ${TOKEN}" "${URL}/healthz" || true)"
if [ "${CODE}" != "200" ]; then
  echo "[verify] FAIL: /healthz returned ${CODE}"; exit 1;
fi
echo "[verify] /healthz OK"

# ─── Log tail ────────────────────────────────────────────────────────────────

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
