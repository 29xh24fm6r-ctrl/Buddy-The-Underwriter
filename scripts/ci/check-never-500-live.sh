#!/usr/bin/env bash
# CI Entrypoint: Live Never-500 Checks
#
# Requires:
#   BASE             - Production or preview URL
#   SEEDED_DEAL_ID   - A known deal ID for testing (or DEAL_ID)
#
# Usage:
#   BASE="https://..." SEEDED_DEAL_ID="..." ./scripts/ci/check-never-500-live.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"

# Validate required env vars
if [[ -z "${BASE:-}" ]]; then
  echo "❌ ERROR: missing BASE environment variable"
  echo "   Set BASE to the deployment URL (e.g., https://buddy-the-underwriter.vercel.app)"
  exit 1
fi

# Accept either SEEDED_DEAL_ID or DEAL_ID
DEAL_ID="${SEEDED_DEAL_ID:-${DEAL_ID:-}}"
if [[ -z "${DEAL_ID}" ]]; then
  echo "⚠️  WARNING: missing SEEDED_DEAL_ID or DEAL_ID environment variable"
  echo "   Live checks will use fallback UUID (may return auth errors, which is expected)"
  export DEAL_ID="00000000-0000-0000-0000-000000000000"
else
  export DEAL_ID
fi

echo "🔍 Running live Never-500 checks..."
echo "   BASE: ${BASE}"
echo "   DEAL_ID: ${DEAL_ID}"
echo ""

exec "${ROOT_DIR}/scripts/check-never-500.sh" --live
