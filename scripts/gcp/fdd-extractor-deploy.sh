#!/bin/bash
# Build + deploy franchise-fdd-extractor to Cloud Run.
# Tags the image with the current git short SHA.
set -euo pipefail

cd "$(git rev-parse --show-toplevel)/services/franchise-fdd-extractor"

SHA=$(git rev-parse --short=8 HEAD)
IMAGE="us-central1-docker.pkg.dev/buddy-the-underwriter/buddy-workers/franchise-fdd-extractor:$SHA"

echo ">> Building $IMAGE"
gcloud builds submit \
  --tag "$IMAGE" \
  --region us-central1 \
  --gcs-source-staging-dir=gs://buddy-the-underwriter_cloudbuild/source \
  .

echo ">> Deploying to Cloud Run"
gcloud run deploy franchise-fdd-extractor \
  --image "$IMAGE" \
  --region us-central1 \
  --service-account buddy-core-worker@buddy-the-underwriter.iam.gserviceaccount.com \
  --min-instances 0 \
  --max-instances 1 \
  --cpu 2 \
  --memory 1Gi \
  --timeout 3600 \
  --update-env-vars "NODE_ENV=production,GCS_BUCKET=buddy-franchise-fdds" \
  --update-secrets "BUDDY_DB_URL=BUDDY_DB_URL:3,GEMINI_API_KEY=GEMINI_API_KEY:latest,CRON_SECRET=CRON_SECRET:latest" \
  --no-allow-unauthenticated \
  --quiet

echo ">> Service URL"
gcloud run services describe franchise-fdd-extractor --region=us-central1 --format='value(status.url)'
