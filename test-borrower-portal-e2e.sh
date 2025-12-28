#!/bin/bash
# Test Borrower Portal E2E Flow
# Usage: ./test-borrower-portal-e2e.sh

set -e

echo "🧪 Testing Borrower Portal E2E Implementation"
echo ""

# Configuration
BASE_URL="${BASE_URL:-http://localhost:3000}"
DEAL_ID="${DEAL_ID:-test-deal-123}"
TOKEN="${TOKEN:-test-token-$(date +%s)}"

echo "📋 Configuration:"
echo "  Base URL: $BASE_URL"
echo "  Deal ID: $DEAL_ID"
echo "  Token: $TOKEN"
echo ""

# Step 1: Create portal link (manual SQL for now)
echo "1️⃣  Creating portal link..."
echo "   Run this SQL manually:"
echo "   INSERT INTO borrower_portal_links (deal_id, token, expires_at)"
echo "   VALUES ('$DEAL_ID', '$TOKEN', NOW() + INTERVAL '7 days');"
echo ""
read -p "   Press Enter after running SQL..."

# Step 2: Test context endpoint
echo "2️⃣  Testing GET /api/portal/$TOKEN/context..."
CONTEXT=$(curl -s "$BASE_URL/api/portal/$TOKEN/context")
echo "   Response: $CONTEXT"
echo ""

# Step 3: Test docs list
echo "3️⃣  Testing GET /api/portal/$TOKEN/docs..."
DOCS=$(curl -s "$BASE_URL/api/portal/$TOKEN/docs")
echo "   Response: $DOCS"
echo ""

# Step 4: Test upload init
echo "4️⃣  Testing POST /api/portal/$TOKEN/upload-init..."
UPLOAD_INIT=$(curl -s -X POST "$BASE_URL/api/portal/$TOKEN/upload-init" \
  -H "content-type: application/json" \
  -d '{"filename":"test.pdf","size":1024,"mime_type":"application/pdf"}')
echo "   Response: $UPLOAD_INIT"
UPLOAD_ID=$(echo "$UPLOAD_INIT" | jq -r '.upload_id // empty')
echo "   Upload ID: $UPLOAD_ID"
echo ""

if [ -n "$UPLOAD_ID" ]; then
  # Step 5: Test upload complete
  echo "5️⃣  Testing POST /api/portal/$TOKEN/upload-complete..."
  UPLOAD_COMPLETE=$(curl -s -X POST "$BASE_URL/api/portal/$TOKEN/upload-complete" \
    -H "content-type: application/json" \
    -d "{\"upload_id\":\"$UPLOAD_ID\"}")
  echo "   Response: $UPLOAD_COMPLETE"
  echo ""

  # Step 6: Test process endpoint (extraction)
  echo "6️⃣  Testing POST /api/deals/$DEAL_ID/process..."
  PROCESS=$(curl -s -X POST "$BASE_URL/api/deals/$DEAL_ID/process" \
    -H "content-type: application/json")
  echo "   Response: $PROCESS"
  echo ""

  # Step 7: Test fields endpoint
  echo "7️⃣  Testing GET /api/portal/$TOKEN/docs/$UPLOAD_ID/fields..."
  FIELDS=$(curl -s "$BASE_URL/api/portal/$TOKEN/docs/$UPLOAD_ID/fields")
  echo "   Response: $FIELDS"
  FIELD_ID=$(echo "$FIELDS" | jq -r '.fields[0].id // empty')
  echo "   First Field ID: $FIELD_ID"
  echo ""

  if [ -n "$FIELD_ID" ]; then
    # Step 8: Test field confirm
    echo "8️⃣  Testing POST /api/portal/$TOKEN/docs/$UPLOAD_ID/field-confirm..."
    CONFIRM=$(curl -s -X POST "$BASE_URL/api/portal/$TOKEN/docs/$UPLOAD_ID/field-confirm" \
      -H "content-type: application/json" \
      -d "{\"field_id\":\"$FIELD_ID\"}")
    echo "   Response: $CONFIRM"
    echo ""
  fi

  # Step 9: Test submit (may fail if fields not all confirmed)
  echo "9️⃣  Testing POST /api/portal/$TOKEN/docs/$UPLOAD_ID/submit..."
  SUBMIT=$(curl -s -X POST "$BASE_URL/api/portal/$TOKEN/docs/$UPLOAD_ID/submit" \
    -H "content-type: application/json" \
    -d '{}')
  echo "   Response: $SUBMIT"
  echo ""
fi

# Step 10: Test progress endpoint
echo "🔟 Testing GET /api/deals/$DEAL_ID/progress..."
PROGRESS=$(curl -s "$BASE_URL/api/deals/$DEAL_ID/progress")
echo "   Response: $PROGRESS"
echo ""

echo "✅ E2E API test complete!"
echo ""
echo "📋 Next Steps:"
echo "  1. Check Supabase tables for inserted data"
echo "  2. Open portal UI: $BASE_URL/portal/$TOKEN"
echo "  3. Open upload UI: $BASE_URL/upload/$TOKEN"
echo "  4. Open cockpit: $BASE_URL/deals/$DEAL_ID/cockpit"
