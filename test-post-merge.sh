#!/bin/bash
# Test all post-merge upgrades

set -e

DEAL_ID="${1:-3d5f3725-5961-4cc2-91dd-3e95c54e7151}"
BANK_ID="${2}" # Optional for blended tests
PORT="${PORT:-3000}"

echo "🧪 Testing Post-Merge Upgrades for deal: $DEAL_ID"
echo ""

# Test 1: Committee with traceability
echo "📝 Test 1: Committee Q&A with ai_events logging"
RESPONSE=$(curl -s -X POST "http://localhost:$PORT/api/deals/$DEAL_ID/committee" \
  -H "Content-Type: application/json" \
  -d '{"question": "What are the biggest risks?"}')

echo "$RESPONSE" | jq -r '.ai_event_id' | xargs -I {} echo "✅ ai_event_id: {}"
echo "$RESPONSE" | jq -r '.citations | length' | xargs -I {} echo "Citations count: {}"
echo ""
echo "---"
echo ""

# Test 2: Memo section generation
echo "📄 Test 2: Memo section generator"
MEMO_RESPONSE=$(curl -s -X POST "http://localhost:$PORT/api/deals/$DEAL_ID/memo/section" \
  -H "Content-Type: application/json" \
  -d '{"section_key": "risks", "prompt": "Be concise, focus on credit risk"}')

echo "$MEMO_RESPONSE" | jq -r '.draft_id' | xargs -I {} echo "✅ draft_id: {}"
echo "$MEMO_RESPONSE" | jq -r '.content' | head -3
echo ""
echo "---"
echo ""

# Test 3: Policy query (if bank_id provided)
if [ -n "$BANK_ID" ]; then
  echo "🏛️ Test 3: Bank policy query"
  POLICY_RESPONSE=$(curl -s -X POST "http://localhost:$PORT/api/banks/$BANK_ID/policy/query" \
    -H "Content-Type: application/json" \
    -d '{"question": "What is the maximum LTV for CRE loans?"}')
  
  echo "$POLICY_RESPONSE" | jq -r '.ai_event_id' | xargs -I {} echo "✅ ai_event_id: {}"
  echo "$POLICY_RESPONSE" | jq -r '.answer' | head -2
  echo ""
  echo "---"
  echo ""

  # Test 4: Blended retrieval
  echo "🔀 Test 4: Blended retrieval (deal + policy)"
  BLENDED_RESPONSE=$(curl -s -X POST "http://localhost:$PORT/api/deals/$DEAL_ID/committee/blended" \
    -H "Content-Type: application/json" \
    -d "{\"question\": \"Does this deal comply with policy?\", \"bank_id\": \"$BANK_ID\"}")
  
  echo "$BLENDED_RESPONSE" | jq -r '.ai_event_id' | xargs -I {} echo "✅ ai_event_id: {}"
  echo "$BLENDED_RESPONSE" | jq -r '.citations | map(.source_kind) | unique | join(", ")' | xargs -I {} echo "Citation sources: {}"
  echo ""
else
  echo "ℹ️  Skipping policy tests (no bank_id provided)"
  echo "   Run with: ./test-post-merge.sh <deal_id> <bank_id>"
  echo ""
fi

echo "✅ Post-merge upgrade tests complete!"
echo ""
echo "Next steps:"
echo "1. Check ai_events table: SELECT * FROM ai_events ORDER BY created_at DESC LIMIT 5;"
echo "2. Check citations: SELECT source_kind, COUNT(*) FROM ai_run_citations GROUP BY source_kind;"
echo "3. Check memo drafts: SELECT * FROM deal_memo_section_drafts ORDER BY created_at DESC LIMIT 3;"
