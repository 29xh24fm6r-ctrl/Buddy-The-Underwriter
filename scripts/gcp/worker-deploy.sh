#!/usr/bin/env bash
set -euo pipefail

PROJECT="${PROJECT:-buddy-the-underwriter}"
REGION="${REGION:-us-central1}"
SERVICE="${SERVICE:-buddy-core-worker}"
SA="${SA:-buddy-core-worker@buddy-the-underwriter.iam.gserviceaccount.com}"
AR_REPO="${AR_REPO:-buddy-workers}"

IMAGE="$REGION-docker.pkg.dev/$PROJECT/$AR_REPO/$SERVICE"
TAG="$(git rev-parse --short HEAD)"
FULL_IMAGE="$IMAGE:$TAG"

echo "[deploy] image=$FULL_IMAGE"
echo "[deploy] running preflight"
"$(dirname "$0")/worker-preflight.sh"

# ─── Build + push image via Cloud Build ───────────────────────────────────────

echo "[deploy] submitting build to Cloud Build"
BUILD_OUTPUT="$(mktemp)"

gcloud builds submit services/buddy-core-worker \
  --tag "$FULL_IMAGE" \
  --region "$REGION" \
  --project "$PROJECT" \
  2>&1 | tee "$BUILD_OUTPUT"

# Extract build ID from output (line like "ID: <uuid>" or "created [<uuid>]")
BUILD_ID="$(grep -oP '(?<=ID:\s)[0-9a-f-]+' "$BUILD_OUTPUT" | head -1 || true)"
if [[ -z "$BUILD_ID" ]]; then
  BUILD_ID="$(grep -oP '(?<=created \[)[0-9a-f-]+(?=\])' "$BUILD_OUTPUT" | head -1 || true)"
fi

if [[ -n "$BUILD_ID" ]]; then
  echo "$BUILD_ID" > /tmp/buddy-worker-last-build-id
  echo "[deploy] build_id=$BUILD_ID"
else
  echo "[deploy][warn] could not extract build ID from output"
fi

# ─── Deploy Cloud Run from image ─────────────────────────────────────────────

echo "[deploy] deploying Cloud Run service from image"
gcloud run deploy "$SERVICE" \
  --image "$FULL_IMAGE" \
  --region "$REGION" \
  --project "$PROJECT" \
  --service-account "$SA" \
  --min-instances 1 \
  --max-instances 2 \
  --cpu 1 \
  --memory 512Mi \
  --set-env-vars "NODE_ENV=production,WORKER_ENABLED=true,POLL_INTERVAL_MS=2000,BATCH_SIZE=25,HEARTBEAT_INTERVAL_MS=15000,HTTP_TIMEOUT_MS=2000" \
  --set-secrets "BUDDY_DB_URL=BUDDY_DB_URL:latest,PULSE_MCP_URL=PULSE_MCP_URL:latest,PULSE_MCP_KEY=PULSE_MCP_KEY:latest" \
  --no-allow-unauthenticated

echo "[deploy] done"
echo "[deploy] image=$FULL_IMAGE"
gcloud run services describe "$SERVICE" --region "$REGION" --format="value(status.url)" | sed 's/^/[deploy] url: /'
