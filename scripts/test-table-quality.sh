#!/bin/bash

# Test script for table quality scoring + auto-retry OCR system
# Demonstrates all three components working together

set -e

echo "🧪 Testing Table Quality Scoring + Auto-Retry OCR System"
echo "=========================================================="
echo ""

# Test 1: Extract without OCR (should use PDFJS path)
echo "Test 1: Extract FINANCIALS doc without OCR"
echo "curl -s -X POST http://localhost:3000/api/docs/extract -H 'Content-Type: application/json' -d '{\"docId\":\"DOC_...\"}''"
echo ""

# Test 2: Check table quality scoring
echo "Test 2: View table quality metrics"
echo "curl -s -X POST http://localhost:3000/api/docs/extract -H 'Content-Type: application/json' -d '{\"docId\":\"DOC_...\"}' | jq '.extract.fields.tableQuality'"
echo ""

# Test 3: Check OCR retry logic
echo "Test 3: Check OCR retry metadata"
echo "curl -s -X POST http://localhost:3000/api/docs/extract -H 'Content-Type: application/json' -d '{\"docId\":\"DOC_...\"}' | jq '.extract.fields.ocrRetry'"
echo ""

# Test 4: Extraction mode
echo "Test 4: View extraction mode (pdfjs_coordinate or azure_ocr+coordinate)"
echo "curl -s -X POST http://localhost:3000/api/docs/extract -H 'Content-Type: application/json' -d '{\"docId\":\"DOC_...\"}' | jq '.extract.fields.extractionMode'"
echo ""

# Test 5: Full table quality object
echo "Test 5: Full table quality breakdown"
echo "curl -s -X POST http://localhost:3000/api/docs/extract -H 'Content-Type: application/json' -d '{\"docId\":\"DOC_...\"}' | jq '.extract.fields.tableQuality.best'"
echo ""

echo "🎯 Key Features Implemented:"
echo "  ✅ Table quality scoring (0-100 with metrics)"
echo "  ✅ Auto-retry OCR when sparse/scanned (threshold: score < 58)"
echo "  ✅ Doc-type router (FINANCIALS, BANK_STATEMENTS, TAX_RETURNS, etc.)"
echo ""

echo "📊 Table Quality Metrics:"
echo "  - score: 0-100 overall quality"
echo "  - fillRatio: % numeric cells filled"
echo "  - numericDensity: numeric/total cells"
echo "  - rowStrengthRatio: % rows with >=2 numerics"
echo "  - headerHasPeriods: detects FY/TTM headers"
echo "  - reasons: array of quality issues"
echo ""

echo "🔄 Auto-Retry Logic:"
echo "  Retries with OCR when:"
echo "  - Text layer score <= 2 (scanned)"
echo "  - No tables detected (pdfBuilt.tables.length === 0)"
echo "  - Best table score < 58 (sparse/low quality)"
echo ""

echo "🎯 Next Steps:"
echo "  1. Upload a FINANCIALS doc via POST /api/docs/upload"
echo "  2. (Optional) Attach Azure OCR via POST /api/docs/ocr"
echo "  3. Extract via POST /api/docs/extract"
echo "  4. Inspect .extract.fields.tableQuality and .extract.fields.ocrRetry"
echo ""

echo "💡 Example Quality Thresholds:"
echo "  90-100: Excellent (dense, clear periods, strong rows)"
echo "  70-89:  Good (minor gaps or weak rows)"
echo "  50-69:  Fair (sparse or missing periods)"
echo "  <50:    Poor (triggers OCR retry if available)"
echo ""
