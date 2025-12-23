#!/bin/bash

# Test Pricing Quote + Memo Generation System
# Tests the complete flow from snapshot → risk facts → pricing → memo → PDF

set -e

echo "🧪 Testing Pricing Quote + Memo Generation System"
echo "=================================================="

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Test configuration
TEST_DEAL_ID="${1:-}"
API_BASE="${2:-http://localhost:3000}"

if [ -z "$TEST_DEAL_ID" ]; then
  echo -e "${RED}❌ Usage: $0 <deal-id> [api-base]${NC}"
  echo "Example: $0 abc-123-def-456"
  exit 1
fi

echo -e "${BLUE}📋 Configuration:${NC}"
echo "  Deal ID: $TEST_DEAL_ID"
echo "  API Base: $API_BASE"
echo ""

# Step 1: Check database tables exist
echo -e "${BLUE}1️⃣  Checking database tables...${NC}"

if [ -n "$DATABASE_URL" ]; then
  psql "$DATABASE_URL" <<SQL
SELECT 
  CASE 
    WHEN EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'risk_facts') THEN '✅ risk_facts exists'
    ELSE '❌ risk_facts missing'
  END,
  CASE 
    WHEN EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'pricing_quotes') THEN '✅ pricing_quotes exists'
    ELSE '❌ pricing_quotes missing'
  END,
  CASE 
    WHEN EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'generated_documents') THEN '✅ generated_documents exists'
    ELSE '❌ generated_documents missing'
  END;
SQL
else
  echo -e "${YELLOW}⚠️  DATABASE_URL not set - skipping database check${NC}"
fi

echo ""

# Step 2: Check snapshots exist for deal
echo -e "${BLUE}2️⃣  Checking for snapshots...${NC}"

if [ -n "$DATABASE_URL" ]; then
  SNAPSHOT_COUNT=$(psql "$DATABASE_URL" -t -c "SELECT COUNT(*) FROM deal_context_snapshots WHERE deal_id = '$TEST_DEAL_ID';")
  echo "  Found $SNAPSHOT_COUNT snapshot(s)"
  
  if [ "$SNAPSHOT_COUNT" -gt 0 ]; then
    echo -e "${GREEN}✅ Snapshots found${NC}"
    
    # Get latest snapshot ID
    LATEST_SNAPSHOT=$(psql "$DATABASE_URL" -t -c "SELECT id FROM deal_context_snapshots WHERE deal_id = '$TEST_DEAL_ID' ORDER BY created_at DESC LIMIT 1;" | xargs)
    echo "  Latest snapshot: $LATEST_SNAPSHOT"
  else
    echo -e "${RED}❌ No snapshots found for this deal${NC}"
    exit 1
  fi
else
  echo -e "${YELLOW}⚠️  Skipping snapshot check${NC}"
  LATEST_SNAPSHOT="${3:-}"
  
  if [ -z "$LATEST_SNAPSHOT" ]; then
    echo -e "${RED}❌ Provide snapshot ID as third argument when DATABASE_URL not set${NC}"
    exit 1
  fi
fi

echo ""

# Step 3: Test risk facts generation
echo -e "${BLUE}3️⃣  Testing risk facts generation...${NC}"

RISK_FACTS_RESPONSE=$(curl -s -X POST \
  "${API_BASE}/api/deals/${TEST_DEAL_ID}/risk-facts/generate" \
  -H "Content-Type: application/json" \
  -d "{\"snapshotId\":\"${LATEST_SNAPSHOT}\"}")

RISK_FACTS_ID=$(echo "$RISK_FACTS_RESPONSE" | jq -r '.risk_facts.id // empty')

if [ -n "$RISK_FACTS_ID" ]; then
  echo -e "${GREEN}✅ Risk facts generated: $RISK_FACTS_ID${NC}"
  
  # Show key metrics
  echo "  Key metrics:"
  echo "$RISK_FACTS_RESPONSE" | jq -r '.risk_facts.facts | 
    "    LTV: \(.collateral.ltv // "N/A")%",
    "    DSCR: \(.collateral.dscr // "N/A")x",
    "    NOI: $\(.financial.noi // "N/A")",
    "    Recourse: \(.loan.recourse_type // "N/A")"'
else
  echo -e "${RED}❌ Failed to generate risk facts${NC}"
  echo "$RISK_FACTS_RESPONSE" | jq .
  exit 1
fi

echo ""

# Step 4: Test pricing quote generation
echo -e "${BLUE}4️⃣  Testing pricing quote generation...${NC}"

PRICING_RESPONSE=$(curl -s -X POST \
  "${API_BASE}/api/deals/${TEST_DEAL_ID}/pricing-quotes/create" \
  -H "Content-Type: application/json" \
  -d "{\"snapshotId\":\"${LATEST_SNAPSHOT}\",\"riskFactsId\":\"${RISK_FACTS_ID}\"}")

PRICING_QUOTE_ID=$(echo "$PRICING_RESPONSE" | jq -r '.pricing_quote.id // empty')

if [ -n "$PRICING_QUOTE_ID" ]; then
  echo -e "${GREEN}✅ Pricing quote created: $PRICING_QUOTE_ID${NC}"
  
  # Show pricing details
  echo "  Pricing details:"
  echo "$PRICING_RESPONSE" | jq -r '.pricing_quote.quote |
    "    Product: \(.product)",
    "    All-in Rate: \(.rate.all_in_rate * 100)%",
    "    Margin: \(.rate.margin_bps)bps",
    "    Index: \(.rate.index)"'
else
  echo -e "${RED}❌ Failed to create pricing quote${NC}"
  echo "$PRICING_RESPONSE" | jq .
  exit 1
fi

echo ""

# Step 5: Test pricing quote update
echo -e "${BLUE}5️⃣  Testing pricing quote update...${NC}"

UPDATE_RESPONSE=$(curl -s -X PATCH \
  "${API_BASE}/api/deals/${TEST_DEAL_ID}/pricing-quotes/${PRICING_QUOTE_ID}" \
  -H "Content-Type: application/json" \
  -d '{"status":"proposed"}')

UPDATED_STATUS=$(echo "$UPDATE_RESPONSE" | jq -r '.pricing_quote.status // empty')

if [ "$UPDATED_STATUS" == "proposed" ]; then
  echo -e "${GREEN}✅ Quote status updated to: $UPDATED_STATUS${NC}"
else
  echo -e "${RED}❌ Failed to update quote status${NC}"
  echo "$UPDATE_RESPONSE" | jq .
fi

echo ""

# Step 6: Test memo generation
echo -e "${BLUE}6️⃣  Testing credit memo generation...${NC}"

MEMO_RESPONSE=$(curl -s -X POST \
  "${API_BASE}/api/deals/${TEST_DEAL_ID}/memos/generate" \
  -H "Content-Type: application/json" \
  -d "{\"snapshotId\":\"${LATEST_SNAPSHOT}\",\"riskFactsId\":\"${RISK_FACTS_ID}\",\"pricingQuoteId\":\"${PRICING_QUOTE_ID}\"}")

MEMO_DOC_ID=$(echo "$MEMO_RESPONSE" | jq -r '.generated_document.id // empty')

if [ -n "$MEMO_DOC_ID" ]; then
  echo -e "${GREEN}✅ Credit memo generated: $MEMO_DOC_ID${NC}"
  
  # Show memo sections
  echo "  Memo sections:"
  echo "$MEMO_RESPONSE" | jq -r '.generated_document.content_json |
    "    Borrower: \(.header.borrower)",
    "    Request: \(.header.request_summary)",
    "    Risk Factors: \(.risk_factors | length)",
    "    Exceptions: \(.policy_exceptions | length)"'
else
  echo -e "${RED}❌ Failed to generate memo${NC}"
  echo "$MEMO_RESPONSE" | jq .
  exit 1
fi

echo ""

# Step 7: Test PDF rendering
echo -e "${BLUE}7️⃣  Testing PDF rendering...${NC}"

PDF_RESPONSE=$(curl -s -X POST \
  "${API_BASE}/api/deals/${TEST_DEAL_ID}/memos/${MEMO_DOC_ID}/render-pdf" \
  -H "Content-Type: application/json")

PDF_URL=$(echo "$PDF_RESPONSE" | jq -r '.pdf_url // empty')
PDF_PATH=$(echo "$PDF_RESPONSE" | jq -r '.generated_document.pdf_storage_path // empty')

if [ -n "$PDF_PATH" ]; then
  echo -e "${GREEN}✅ PDF rendered: $PDF_PATH${NC}"
  
  if [ -n "$PDF_URL" ]; then
    echo "  Signed URL: ${PDF_URL:0:60}..."
  fi
else
  echo -e "${YELLOW}⚠️  PDF rendering may have failed (check errors)${NC}"
  echo "$PDF_RESPONSE" | jq .
fi

echo ""

# Summary
echo -e "${BLUE}📊 Test Summary${NC}"
echo "================================"
echo -e "${GREEN}✅ Risk Facts ID:     $RISK_FACTS_ID${NC}"
echo -e "${GREEN}✅ Pricing Quote ID:  $PRICING_QUOTE_ID${NC}"
echo -e "${GREEN}✅ Quote Status:      $UPDATED_STATUS${NC}"
echo -e "${GREEN}✅ Memo Document ID:  $MEMO_DOC_ID${NC}"

if [ -n "$PDF_PATH" ]; then
  echo -e "${GREEN}✅ PDF Storage Path:  $PDF_PATH${NC}"
else
  echo -e "${YELLOW}⚠️  PDF not generated${NC}"
fi

echo ""
echo -e "${GREEN}🎉 All tests completed!${NC}"
echo ""
echo "View results:"
echo "  UI: ${API_BASE}/deals/${TEST_DEAL_ID}/pricing-memo"
echo ""

# Database verification
if [ -n "$DATABASE_URL" ]; then
  echo -e "${BLUE}📋 Database verification:${NC}"
  
  psql "$DATABASE_URL" <<SQL
-- Risk Facts
SELECT 'Risk Facts:' as section, 
  id, 
  facts_hash, 
  to_char(created_at, 'YYYY-MM-DD HH24:MI:SS') as created 
FROM risk_facts 
WHERE deal_id = '$TEST_DEAL_ID' 
ORDER BY created_at DESC 
LIMIT 3;

-- Pricing Quotes
SELECT 'Pricing Quotes:' as section,
  id,
  status,
  (quote->>'product') as product,
  to_char(created_at, 'YYYY-MM-DD HH24:MI:SS') as created
FROM pricing_quotes
WHERE deal_id = '$TEST_DEAL_ID'
ORDER BY created_at DESC
LIMIT 3;

-- Generated Documents
SELECT 'Generated Docs:' as section,
  id,
  doc_type,
  status,
  CASE WHEN pdf_storage_path IS NOT NULL THEN '✅' ELSE '❌' END as has_pdf,
  to_char(created_at, 'YYYY-MM-DD HH24:MI:SS') as created
FROM generated_documents
WHERE deal_id = '$TEST_DEAL_ID'
ORDER BY created_at DESC
LIMIT 3;
SQL
fi

echo ""
echo -e "${GREEN}✅ Test complete!${NC}"
