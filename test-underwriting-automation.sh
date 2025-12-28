#!/bin/bash
# Test Complete Underwriting Automation System
# Tests: Auto-trigger → Pipeline → Notifications

set -e

echo "🧪 Testing Complete Underwriting Automation"
echo ""

BASE_URL="${BASE_URL:-http://localhost:3000}"
DEAL_ID="${DEAL_ID:-test-deal-auto-$(date +%s)}"

echo "📋 Configuration:"
echo "  Base URL: $BASE_URL"
echo "  Deal ID: $DEAL_ID"
echo ""

# Step 1: Test underwriting start endpoint
echo "1️⃣  Testing POST /api/deals/$DEAL_ID/underwrite/start..."
START_RESULT=$(curl -s -X POST "$BASE_URL/api/deals/$DEAL_ID/underwrite/start" \
  -H "content-type: application/json")
echo "   Response: $START_RESULT"
echo ""

# Step 2: Test events endpoint
echo "2️⃣  Testing GET /api/deals/$DEAL_ID/events..."
EVENTS=$(curl -s "$BASE_URL/api/deals/$DEAL_ID/events?limit=5")
echo "   Response: $EVENTS"
echo ""

# Step 3: Test notification stats (requires admin auth)
echo "3️⃣  Testing GET /api/admin/notifications/stats..."
echo "   (Requires admin auth - test manually in browser)"
echo ""

# Step 4: Test notification processor (requires admin auth)
echo "4️⃣  Testing POST /api/admin/notifications/process..."
echo "   (Requires admin auth - test manually)"
echo ""

echo "✅ API endpoint tests complete!"
echo ""
echo "📋 Manual Testing Steps:"
echo ""
echo "1. Create a deal with required checklist items:"
echo "   INSERT INTO deal_checklist_items (deal_id, checklist_key, title, required)"
echo "   VALUES"
echo "     ('$DEAL_ID', 'tax_returns', '3 Years Tax Returns', true),"
echo "     ('$DEAL_ID', 'financials', 'Financial Statements', true);"
echo ""
echo "2. Upload and confirm documents via borrower portal"
echo ""
echo "3. Watch for auto-trigger:"
echo "   SELECT * FROM deal_events"
echo "   WHERE deal_id = '$DEAL_ID'"
echo "   AND kind = 'deal_ready_for_underwriting';"
echo ""
echo "4. Check notification queue:"
echo "   SELECT * FROM notification_queue"
echo "   WHERE deal_id = '$DEAL_ID';"
echo ""
echo "5. Process notifications:"
echo "   curl -X POST $BASE_URL/api/admin/notifications/process"
echo ""
echo "6. Verify emails sent (check Resend dashboard)"
echo ""
echo "🎯 Expected Flow:"
echo "   Borrower submits last required doc"
echo "   → DB trigger emits 'deal_ready_for_underwriting'"
echo "   → Underwriting pipeline starts"
echo "   → Notifications queued"
echo "   → Emails sent to underwriters"
