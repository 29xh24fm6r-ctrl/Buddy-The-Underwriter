#!/bin/bash
# Test WOW Factor Features

set -e

DEAL_ID="${1:-test-deal-id}"
BASE_URL="${2:-http://localhost:3000}"

echo "🚀 Testing WOW Factor Features"
echo "Deal ID: $DEAL_ID"
echo "Base URL: $BASE_URL"
echo ""

# Test 1: Ask Buddy
echo "1️⃣ Testing Ask Buddy..."
curl -X POST "$BASE_URL/api/deals/$DEAL_ID/ask" \
  -H "Content-Type: application/json" \
  -d '{
    "question": "What is the business DSCR?",
    "k": 10
  }' \
  --silent --show-error | jq '.' || echo "❌ Ask Buddy failed"
echo ""

# Test 2: Auto-Memo
echo "2️⃣ Testing Auto-Memo generation..."
curl -X POST "$BASE_URL/api/deals/$DEAL_ID/memo/generate" \
  -H "Content-Type: application/json" \
  -d '{}' \
  --silent --show-error | jq '.sections | length' || echo "❌ Auto-Memo failed"
echo ""

# Test 3: Why? Explainer
echo "3️⃣ Testing Why? Explainer..."
curl -X POST "$BASE_URL/api/deals/$DEAL_ID/risk/explain" \
  -H "Content-Type: application/json" \
  -d '{
    "headline": "Risk Rating: 4"
  }' \
  --silent --show-error | jq '.explanation' || echo "❌ Explainer failed"
echo ""

echo "✅ All tests complete"
