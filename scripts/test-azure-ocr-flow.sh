#!/bin/bash
# Azure OCR Auto-Selection Test Flow
# This script demonstrates the complete workflow

set -e

echo "=== Azure OCR Auto-Selection Test Flow ==="
echo ""

# Configuration
API_BASE="http://localhost:3000/api"
DOC_ID="DOC_DEMO_001"

echo "Step 1: Upload a scanned financial PDF"
echo "---------------------------------------"
echo "Use the UI uploader or:"
echo "  curl -X POST $API_BASE/docs/upload \\"
echo "    -F 'file=@scanned_financials.pdf' \\"
echo "    -F 'dealId=DEAL-DEMO-001' \\"
echo "    -F 'docType=FINANCIALS'"
echo ""

echo "Step 2: Attach Azure OCR JSON"
echo "------------------------------"
cat << 'EOF' > /tmp/test_ocr_payload.json
{
  "docId": "DOC_DEMO_001",
  "azureOcrJson": {
    "analyzeResult": {
      "readResults": [
        {
          "page": 1,
          "lines": [
            {
              "text": "Income Statement",
              "boundingBox": [100, 50, 300, 50, 300, 80, 100, 80]
            },
            {
              "text": "Revenue: $1,250,000",
              "boundingBox": [100, 100, 400, 100, 400, 120, 100, 120]
            }
          ]
        }
      ]
    }
  }
}
EOF

echo "Testing OCR attachment..."
curl -s -X POST $API_BASE/docs/ocr \
  -H "Content-Type: application/json" \
  -d @/tmp/test_ocr_payload.json | jq '.'

echo ""
echo "Step 3: Extract (auto-selects OCR for scanned PDFs)"
echo "---------------------------------------------------"
echo "Testing extraction with auto-OCR selection..."
curl -s -X POST $API_BASE/docs/extract \
  -H "Content-Type: application/json" \
  -d "{\"docId\":\"$DOC_ID\"}" | jq '{
    extractionMode: .extract.fields.extractionMode,
    ocrUsed: .extract.fields.ocrUsed,
    ocrAvailable: .extract.fields.ocrAvailable,
    quality: .extract.fields.pdfTextLayerQuality,
    tables: .extract.tables | length,
    evidence: .extract.evidence | length
  }'

echo ""
echo "=== Expected Results ==="
echo "✓ extractionMode: 'azure_ocr+coordinate' (for scanned)"
echo "✓ extractionMode: 'pdfjs_coordinate' (for text PDFs)"
echo "✓ ocrUsed: true (when scanned and OCR available)"
echo "✓ quality.scannedLikely: true/false"
echo "✓ quality.score: 0-8 (higher = better text layer)"
echo ""

echo "=== Text Layer Quality Scoring ==="
echo "Score Components:"
echo "  - Total tokens: 0-3 points (>=1200, >=400, >=120)"
echo "  - Tokens per page: 0-2 points (>=250, >=120)"
echo "  - Alpha ratio: 0-2 points (>=0.35, >=0.18)"
echo "  - Unique ratio: 0-1 point (>=0.45)"
echo ""
echo "Scanned detection triggers:"
echo "  - Total tokens < 120"
echo "  - Tokens per page < 50"
echo "  - Alpha ratio < 0.12"
echo "  - Quality score <= 2"
echo ""

echo "=== Integration Points ==="
echo ""
echo "1. Your existing Azure pipeline:"
echo "   → Run OCR externally"
echo "   → POST Azure JSON to /api/docs/ocr"
echo ""
echo "2. Buddy auto-detection:"
echo "   → Scores pdfjs text layer quality"
echo "   → Automatically uses OCR for scanned docs"
echo "   → Falls back to pdfjs for text PDFs"
echo ""
echo "3. Same normalized output:"
echo "   → Fields, tables, evidence (consistent schema)"
echo "   → Works with existing memo generation"
echo ""

# Cleanup
rm -f /tmp/test_ocr_payload.json

echo "Test script complete!"
echo ""
echo "Next steps:"
echo "  1. Upload a real scanned financial PDF"
echo "  2. Run your Azure DI OCR pipeline"
echo "  3. POST OCR JSON to /api/docs/ocr"
echo "  4. Call /api/docs/extract"
echo "  5. Verify auto-selection and table reconstruction"
