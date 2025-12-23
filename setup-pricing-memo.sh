#!/bin/bash

# Pricing + Memo System - Final Integration
# Run this script to complete the setup

set -e

echo "🚀 Pricing + Memo System - Final Integration"
echo "=============================================="
echo ""

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Check if DATABASE_URL is set
if [ -z "$DATABASE_URL" ]; then
  echo -e "${RED}❌ DATABASE_URL environment variable not set${NC}"
  echo ""
  echo "Please set your DATABASE_URL:"
  echo "  export DATABASE_URL='postgresql://...'"
  echo ""
  exit 1
fi

echo -e "${BLUE}1️⃣  Running database migration...${NC}"
echo ""

# Run the migration
psql "$DATABASE_URL" -f supabase/migrations/20251223_pricing_memo_tables.sql

if [ $? -eq 0 ]; then
  echo ""
  echo -e "${GREEN}✅ Migration completed successfully${NC}"
else
  echo ""
  echo -e "${RED}❌ Migration failed${NC}"
  echo "Please check the error messages above and try again."
  exit 1
fi

echo ""
echo -e "${BLUE}2️⃣  Verifying tables...${NC}"

# Check if tables were created
TABLES_EXIST=$(psql "$DATABASE_URL" -t -c "
  SELECT COUNT(*) 
  FROM pg_tables 
  WHERE schemaname = 'public' 
  AND tablename IN ('risk_facts', 'pricing_quotes', 'generated_documents');
")

if [ "$TABLES_EXIST" -eq 3 ]; then
  echo -e "${GREEN}✅ All 3 tables created successfully${NC}"
  
  # Show table details
  psql "$DATABASE_URL" <<SQL
  SELECT 
    tablename,
    (SELECT COUNT(*) FROM pg_indexes WHERE tablename = t.tablename) as index_count
  FROM pg_tables t
  WHERE schemaname = 'public' 
  AND tablename IN ('risk_facts', 'pricing_quotes', 'generated_documents')
  ORDER BY tablename;
SQL
else
  echo -e "${YELLOW}⚠️  Expected 3 tables but found $TABLES_EXIST${NC}"
  echo "Tables found:"
  psql "$DATABASE_URL" -c "
    SELECT tablename 
    FROM pg_tables 
    WHERE schemaname = 'public' 
    AND tablename IN ('risk_facts', 'pricing_quotes', 'generated_documents');
  "
fi

echo ""
echo -e "${BLUE}3️⃣  Checking for Storage bucket...${NC}"
echo ""

# Check if bucket exists
BUCKET_EXISTS=$(psql "$DATABASE_URL" -t -c "
  SELECT COUNT(*) 
  FROM storage.buckets 
  WHERE id = 'generated-documents';
" 2>/dev/null || echo "0")

if [ "$BUCKET_EXISTS" -gt 0 ]; then
  echo -e "${GREEN}✅ Storage bucket 'generated-documents' already exists${NC}"
else
  echo -e "${YELLOW}⚠️  Storage bucket 'generated-documents' not found${NC}"
  echo ""
  echo "Create the bucket manually:"
  echo "  1. Open Supabase Dashboard"
  echo "  2. Go to Storage → Buckets"
  echo "  3. Click 'New bucket'"
  echo "  4. Name: generated-documents"
  echo "  5. Public: NO (keep private)"
  echo "  6. Create"
  echo ""
  echo "Or run this SQL in Supabase SQL Editor:"
  echo ""
  echo "  INSERT INTO storage.buckets (id, name, public)"
  echo "  VALUES ('generated-documents', 'generated-documents', false);"
  echo ""
fi

echo ""
echo -e "${BLUE}4️⃣  Next steps:${NC}"
echo ""
echo "  1. Create Storage bucket 'generated-documents' (if not exists)"
echo "  2. Add RLS policies for Storage (see PRICING_MEMO_SETUP_GUIDE.md)"
echo "  3. Start dev server: npm run dev"
echo "  4. Navigate to: /deals/[dealId]/pricing-memo"
echo "  5. Run test: ./test-pricing-memo.sh <deal-id>"
echo ""
echo -e "${GREEN}✅ Integration complete!${NC}"
echo ""
echo "📚 Documentation:"
echo "  - Full guide: PRICING_MEMO_SYSTEM.md"
echo "  - Quick ref: PRICING_MEMO_QUICK_REF.md"
echo "  - Setup: PRICING_MEMO_SETUP_GUIDE.md"
echo ""
