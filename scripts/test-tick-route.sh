#!/bin/bash
# scripts/test-tick-route.sh
# Test the hardened tick route with optional admin secret

set -e

ENDPOINT="${1:-http://localhost:3000/api/admin/reminders/tick}"
LIMIT="${2:-10}"
CADENCE_HOURS="${3:-24}"

echo "🔄 Testing tick route..."
echo "   Endpoint: $ENDPOINT"
echo "   Limit: $LIMIT"
echo "   Cadence: $CADENCE_HOURS hours"
echo ""

# Build curl command
CURL_CMD="curl -sS -X POST"

# Add admin secret header if set
if [ -n "$ADMIN_CRON_SECRET" ]; then
  echo "🔐 Using ADMIN_CRON_SECRET from env"
  CURL_CMD="$CURL_CMD -H 'x-admin-cron-secret: $ADMIN_CRON_SECRET'"
else
  echo "⚠️  No ADMIN_CRON_SECRET set (dev mode)"
fi

# Add URL with params
CURL_CMD="$CURL_CMD '${ENDPOINT}?limit=${LIMIT}&cadenceHours=${CADENCE_HOURS}'"

echo ""
echo "📡 Running: $CURL_CMD"
echo ""

# Execute and pretty-print JSON if jq is available
if command -v jq &> /dev/null; then
  eval "$CURL_CMD" | jq
else
  eval "$CURL_CMD"
fi

echo ""
echo "✅ Tick route test complete"
echo ""
echo "To verify runs in Supabase SQL Editor:"
echo "  SELECT * FROM public.deal_reminder_runs ORDER BY ran_at DESC LIMIT 50;"
