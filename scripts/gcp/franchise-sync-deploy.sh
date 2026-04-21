#!/usr/bin/env bash
set -euo pipefail

PROJECT="${PROJECT:-buddy-the-underwriter}"
REGION="${REGION:-us-central1}"
SERVICE="${SERVICE:-franchise-sync-worker}"
SA="${SA:-buddy-core-worker@buddy-the-underwriter.iam.gserviceaccount.com}"
AR_REPO="${AR_REPO:-buddy-workers}"

IMAGE="$REGION-docker.pkg.dev/$PROJECT/$AR_REPO/$SERVICE"
TAG="$(git rev-parse --short HEAD)"
FULL_IMAGE="$IMAGE:$TAG"

echo "[deploy] franchise-sync-worker image=$FULL_IMAGE"

echo "[deploy] submitting build to Cloud Build"
gcloud builds submit services/franchise-sync-worker \
  --tag "$FULL_IMAGE" \
  --region "$REGION" \
  --project "$PROJECT"

echo "[deploy] deploying Cloud Run service"
gcloud run deploy "$SERVICE" \
  --image "$FULL_IMAGE" \
  --region "$REGION" \
  --project "$PROJECT" \
  --service-account "$SA" \
  --min-instances 0 \
  --max-instances 1 \
  --cpu 1 \
  --memory 512Mi \
  --timeout 3600 \
  --set-env-vars "NODE_ENV=production,GCS_BUCKET=buddy-franchise-fdds" \
  --set-secrets "BUDDY_DB_URL=BUDDY_DB_URL:latest,CRON_SECRET=CRON_SECRET:latest,BUDDY_DB_CA_BUNDLE=buddy-db-ca-bundle:latest" \
  --no-allow-unauthenticated

echo "[deploy] done"
gcloud run services describe "$SERVICE" --region "$REGION" --format="value(status.url)" | sed 's/^/[deploy] url: /'

echo ""
echo "[deploy] NEXT STEPS:"
echo "  1. Create Cloud Scheduler job (weekly, Mondays 6am CT):"
echo "     SERVICE_URL=\$(gcloud run services describe $SERVICE --region $REGION --format='value(status.url)')"
echo "     gcloud scheduler jobs create http franchise-sync-weekly \\"
echo "       --location=$REGION \\"
echo "       --schedule='0 6 * * 1' \\"
echo "       --time-zone='America/Chicago' \\"
echo "       --uri=\"\$SERVICE_URL\" \\"
echo "       --http-method=POST \\"
echo "       --oidc-service-account-email=$SA \\"
echo "       --headers='Content-Type=application/json'"
echo ""
echo "  2. Test manually:"
echo "     curl -X POST \"\$SERVICE_URL\" \\"
echo "       -H \"Authorization: Bearer \$(gcloud auth print-identity-token)\" \\"
echo "       -H 'x-cron-secret: YOUR_CRON_SECRET'"
