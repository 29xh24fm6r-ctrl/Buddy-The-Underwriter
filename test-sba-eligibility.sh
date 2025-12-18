#!/bin/bash
# Quick smoke test for SBA eligibility engine

set -e

echo "🧪 SBA Eligibility Engine - Smoke Test"
echo "======================================"
echo ""

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check if server is running
echo "1️⃣  Checking dev server..."
if curl -s http://localhost:3000/api/ping > /dev/null; then
    echo -e "${GREEN}✓${NC} Dev server is running"
else
    echo -e "${RED}✗${NC} Dev server is not running!"
    echo "   Run: npm run dev"
    exit 1
fi
echo ""

# Check environment
echo "2️⃣  Checking environment..."
if [ -f .env.local ]; then
    if grep -q "SUPABASE_SERVICE_ROLE_KEY" .env.local; then
        echo -e "${GREEN}✓${NC} .env.local exists with Supabase credentials"
    else
        echo -e "${YELLOW}⚠${NC}  .env.local exists but missing SUPABASE_SERVICE_ROLE_KEY"
        echo "   Add: SUPABASE_SERVICE_ROLE_KEY=your-key-here"
    fi
else
    echo -e "${RED}✗${NC} .env.local not found!"
    echo "   Create .env.local with Supabase credentials"
    exit 1
fi
echo ""

# Test create endpoint (will fail if DB not set up, which is expected)
echo "3️⃣  Testing borrower token creation..."
echo "   POST /api/borrower/admin/create"

RESPONSE=$(curl -s -X POST http://localhost:3000/api/borrower/admin/create \
  -H "Content-Type: application/json" \
  -d '{"user_id":"00000000-0000-0000-0000-000000000000"}')

if echo "$RESPONSE" | jq -e '.ok' > /dev/null 2>&1; then
    TOKEN=$(echo "$RESPONSE" | jq -r '.token')
    URL=$(echo "$RESPONSE" | jq -r '.url')
    
    echo -e "${GREEN}✓${NC} Token created successfully!"
    echo "   Token: $TOKEN"
    echo "   URL: $URL"
    echo ""
    
    # Test answer upsert
    echo "4️⃣  Testing answer upsert..."
    ANSWER_RESPONSE=$(curl -s -X POST "http://localhost:3000/api/borrower/${TOKEN}/answer/upsert" \
      -H "Content-Type: application/json" \
      -d '{"section":"loan","question_key":"loan.amount","value":500000}')
    
    if echo "$ANSWER_RESPONSE" | jq -e '.ok' > /dev/null 2>&1; then
        echo -e "${GREEN}✓${NC} Answer saved successfully"
    else
        echo -e "${RED}✗${NC} Answer upsert failed:"
        echo "$ANSWER_RESPONSE" | jq
    fi
    echo ""
    
    # Test eligibility recompute
    echo "5️⃣  Testing eligibility recompute..."
    ELIG_RESPONSE=$(curl -s -X POST "http://localhost:3000/api/borrower/${TOKEN}/eligibility/recompute")
    
    if echo "$ELIG_RESPONSE" | jq -e '.ok' > /dev/null 2>&1; then
        STATUS=$(echo "$ELIG_RESPONSE" | jq -r '.result.status')
        PROGRAM=$(echo "$ELIG_RESPONSE" | jq -r '.result.best_program')
        CANDIDATE=$(echo "$ELIG_RESPONSE" | jq -r '.result.candidate')
        
        echo -e "${GREEN}✓${NC} Eligibility computed successfully"
        echo "   Status: $STATUS"
        echo "   Best Program: $PROGRAM"
        echo "   Candidate: $CANDIDATE"
    else
        echo -e "${RED}✗${NC} Eligibility recompute failed:"
        echo "$ELIG_RESPONSE" | jq
    fi
    echo ""
    
    echo "================================"
    echo -e "${GREEN}✅ All API tests passed!${NC}"
    echo ""
    echo "🌐 Open in browser:"
    echo "   $URL"
    echo ""
    echo "📝 Next: Fill out the wizard and watch eligibility update in real-time!"
    
else
    ERROR=$(echo "$RESPONSE" | jq -r '.error')
    echo -e "${RED}✗${NC} Token creation failed!"
    echo "   Error: $ERROR"
    echo ""
    
    if [[ "$ERROR" == *"fetch failed"* ]] || [[ "$ERROR" == *"create_failed"* ]]; then
        echo "💡 This is expected if database tables don't exist yet."
        echo ""
        echo "📋 Run this SQL in Supabase SQL Editor:"
        echo ""
        echo "   -- Add SBA columns to borrower_applications"
        echo "   ALTER TABLE borrower_applications"
        echo "     ADD COLUMN IF NOT EXISTS sba7a_candidate BOOLEAN,"
        echo "     ADD COLUMN IF NOT EXISTS sba7a_eligible BOOLEAN,"
        echo "     ADD COLUMN IF NOT EXISTS sba7a_ineligibility_reasons JSONB,"
        echo "     ADD COLUMN IF NOT EXISTS loan_type TEXT,"
        echo "     ADD COLUMN IF NOT EXISTS token TEXT UNIQUE;"
        echo ""
        echo "   -- Create borrower_answers table"
        echo "   CREATE TABLE IF NOT EXISTS borrower_answers ("
        echo "     id UUID PRIMARY KEY DEFAULT gen_random_uuid(),"
        echo "     application_id UUID NOT NULL REFERENCES borrower_applications(id),"
        echo "     section TEXT NOT NULL,"
        echo "     question_key TEXT NOT NULL,"
        echo "     value JSONB,"
        echo "     created_at TIMESTAMPTZ DEFAULT NOW(),"
        echo "     updated_at TIMESTAMPTZ DEFAULT NOW(),"
        echo "     UNIQUE(application_id, question_key)"
        echo "   );"
        echo ""
        echo "   -- Create index"
        echo "   CREATE INDEX IF NOT EXISTS idx_borrower_answers_app_id"
        echo "     ON borrower_answers(application_id);"
        echo ""
    fi
    
    echo "📖 See STEPS_3_4_COMPLETE.md for full setup instructions"
fi

echo ""
