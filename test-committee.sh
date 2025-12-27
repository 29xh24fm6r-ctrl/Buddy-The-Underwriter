#!/bin/bash
# Test the committee Q&A endpoint

set -e

DEAL_ID="${1:-3d5f3725-5961-4cc2-91dd-3e95c54e7151}"
PORT="${PORT:-3000}"

echo "🧪 Testing Committee Q&A for deal: $DEAL_ID"
echo ""

# Test 1: Basic question
echo "📝 Test 1: Asking 'What are the biggest risks?'"
curl -s -X POST "http://localhost:$PORT/api/deals/$DEAL_ID/committee" \
  -H "Content-Type: application/json" \
  -d '{"question": "What are the biggest risks in this deal?"}' \
  | jq '.'

echo ""
echo "---"
echo ""

# Test 2: With debug mode
echo "🔍 Test 2: Same question with debug mode"
curl -s -X POST "http://localhost:$PORT/api/deals/$DEAL_ID/committee" \
  -H "Content-Type: application/json" \
  -d '{"question": "What are the biggest risks?", "debug": true}' \
  | jq '.debug.topChunks | length' \
  | xargs -I {} echo "Retrieved {} chunks"

echo ""
echo "---"
echo ""

# Test 3: Different question
echo "💰 Test 3: Asking about financial strength"
curl -s -X POST "http://localhost:$PORT/api/deals/$DEAL_ID/committee" \
  -H "Content-Type: application/json" \
  -d '{"question": "What is the financial strength of the borrower?"}' \
  | jq -r '.answer' \
  | head -5

echo ""
echo "✅ Committee Q&A tests complete!"
