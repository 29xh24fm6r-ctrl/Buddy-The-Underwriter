#!/bin/bash
# Simple test to verify preview route works

DOC_ID="00000000-0000-0000-0000-000000000001"  # Replace with actual doc_id after creating one
DEAL_ID="test-deal-123"

echo "Testing preview route..."
echo "URL: http://localhost:3000/deals/$DEAL_ID/memos/$DOC_ID/preview"
echo ""
echo "Open this URL in your browser to see the HTML preview before PDF generation."
echo ""
echo "To generate the PDF, run:"
echo "  curl -X POST http://localhost:3000/api/deals/$DEAL_ID/memos/$DOC_ID/render-pdf"
