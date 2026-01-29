#!/usr/bin/env bash
set -euo pipefail

PROJECT="${PROJECT:-buddy-the-underwriter}"
REGION="${REGION:-us-central1}"
SERVICE="${SERVICE:-buddy-core-worker}"
SA="${SA:-buddy-core-worker@buddy-the-underwriter.iam.gserviceaccount.com}"

need() { command -v "$1" >/dev/null 2>&1 || { echo "missing dependency: $1" >&2; exit 1; }; }
need gcloud

echo "[preflight] project=$PROJECT region=$REGION service=$SERVICE sa=$SA"

# Ensure gcloud points to correct project/region
gcloud config set project "$PROJECT" >/dev/null
gcloud config set run/region "$REGION" >/dev/null

# APIs required for source deploy
echo "[preflight] ensuring required APIs enabled"
gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com secretmanager.googleapis.com >/dev/null

# Validate service account exists
echo "[preflight] checking service account exists"
gcloud iam service-accounts describe "$SA" >/dev/null

# Validate secrets exist (names only)
echo "[preflight] checking secrets exist"
for s in BUDDY_DB_URL PULSE_MCP_URL PULSE_MCP_KEY; do
  gcloud secrets describe "$s" >/dev/null
done

# Validate SA can access secrets (IAM binding may take time; best-effort check)
echo "[preflight] checking secret access bindings (best-effort)"
for s in BUDDY_DB_URL PULSE_MCP_URL PULSE_MCP_KEY; do
  if ! gcloud secrets get-iam-policy "$s" \
    --format="json(bindings)" | grep -q "$SA"; then
    echo "[preflight][warn] SA not found in IAM policy for secret $s (may still work if bound at project-level)."
  fi
done

echo "[preflight] OK"
