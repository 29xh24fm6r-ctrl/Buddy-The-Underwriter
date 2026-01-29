#!/usr/bin/env bash
set -euo pipefail

PROJECT="${PROJECT:-buddy-the-underwriter}"
REGION="${REGION:-us-central1}"
SERVICE="${SERVICE:-buddy-core-worker}"
SA="${SA:-buddy-core-worker@buddy-the-underwriter.iam.gserviceaccount.com}"

echo "[deploy] running preflight"
"$(dirname "$0")/worker-preflight.sh"

echo "[deploy] deploying Cloud Run service from source"
gcloud run deploy "$SERVICE" \
  --source services/buddy-core-worker \
  --service-account "$SA" \
  --min-instances 1 \
  --max-instances 2 \
  --cpu 1 \
  --memory 512Mi \
  --no-allow-unauthenticated \
  --set-secrets BUDDY_DB_URL=BUDDY_DB_URL:latest \
  --set-secrets PULSE_MCP_URL=PULSE_MCP_URL:latest \
  --set-secrets PULSE_MCP_KEY=PULSE_MCP_KEY:latest \
  --quiet

echo "[deploy] done"
gcloud run services describe "$SERVICE" --region "$REGION" --format="value(status.url)" | sed 's/^/[deploy] url: /'
