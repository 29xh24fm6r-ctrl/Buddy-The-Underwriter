#!/bin/bash
# test-pdf-generation.sh - End-to-end test for Playwright PDF generation

set -e

echo "🚀 Testing Pricing + Memo + PDF Generation Pipeline"
echo ""

# Step 1: Generate risk facts
echo "1️⃣  Generating risk facts..."
RISK_RESP=$(curl -s -X POST "http://localhost:3000/api/deals/test-deal-123/risk-facts/generate" \
  -H "Content-Type: application/json" \
  -d '{
    "snapshot_id": "snap-001",
    "context": {
      "borrower_name": "Acme Corp",
      "loan_amount": 2500000,
      "property_type": "Multifamily",
      "dscr": 1.25,
      "ltv": 75,
      "experience_years": 8
    }
  }')

echo "$RISK_RESP" | jq '.'
RISK_ID=$(echo "$RISK_RESP" | jq -r '.risk_facts.id')
echo "✅ Risk Facts ID: $RISK_ID"
echo ""

# Step 2: Generate pricing quote
echo "2️⃣  Generating pricing quote..."
QUOTE_RESP=$(curl -s -X POST "http://localhost:3000/api/deals/test-deal-123/pricing-quotes/create" \
  -H "Content-Type: application/json" \
  -d "{
    \"risk_facts_id\": \"$RISK_ID\",
    \"product\": \"SBA 7(a) - 25yr\",
    \"loan_amount\": 2500000
  }")

echo "$QUOTE_RESP" | jq '.'
QUOTE_ID=$(echo "$QUOTE_RESP" | jq -r '.pricing_quote.id')
echo "✅ Pricing Quote ID: $QUOTE_ID"
echo ""

# Step 3: Generate memo JSON
echo "3️⃣  Generating credit memo..."
MEMO_RESP=$(curl -s -X POST "http://localhost:3000/api/deals/test-deal-123/memos/generate" \
  -H "Content-Type: application/json" \
  -d "{
    \"risk_facts_id\": \"$RISK_ID\",
    \"pricing_quote_id\": \"$QUOTE_ID\",
    \"deal_name\": \"Acme Corp - 123 Main Street\"
  }")

echo "$MEMO_RESP" | jq '.'
DOC_ID=$(echo "$MEMO_RESP" | jq -r '.generated_document.id')
echo "✅ Memo Document ID: $DOC_ID"
echo ""

# Step 4: Render PDF
echo "4️⃣  Rendering PDF with Playwright..."
PDF_RESP=$(curl -s -X POST "http://localhost:3000/api/deals/test-deal-123/memos/$DOC_ID/render-pdf")

echo "$PDF_RESP" | jq '.'

PDF_PATH=$(echo "$PDF_RESP" | jq -r '.pdf_storage_path')
PREVIEW_URL=$(echo "$PDF_RESP" | jq -r '.previewUrl')

echo ""
echo "✅ PDF Generated!"
echo "   Storage Path: $PDF_PATH"
echo "   Preview URL:  $PREVIEW_URL"
echo ""
echo "🎉 Full pipeline complete!"
echo ""
echo "Next steps:"
echo "  1. Visit preview: $PREVIEW_URL"
echo "  2. Download PDF from Supabase Storage: $PDF_PATH"
