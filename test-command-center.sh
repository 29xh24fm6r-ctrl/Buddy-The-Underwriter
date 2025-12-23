#!/bin/bash
# Test Deal Command Center

set -e

echo "🎯 Deal Command Center - Test Suite"
echo "===================================="
echo ""

# Check if we have a database connection
if [ -z "$DATABASE_URL" ]; then
    echo "⚠️  DATABASE_URL not set - some tests will be skipped"
    HAS_DB=false
else
    HAS_DB=true
fi

# Get a recent deal ID for testing
if [ "$HAS_DB" = true ] && command -v psql &> /dev/null; then
    echo "📋 Finding a test deal..."
    DEAL_ID=$(psql "$DATABASE_URL" -t -c "SELECT id FROM deals ORDER BY created_at DESC LIMIT 1;" 2>/dev/null | tr -d ' ')
    
    if [ -n "$DEAL_ID" ]; then
        echo "✅ Found deal: $DEAL_ID"
        echo ""
        
        # Check if snapshot exists
        echo "📸 Checking for snapshot..."
        SNAPSHOT_EXISTS=$(psql "$DATABASE_URL" -t -c "SELECT EXISTS(SELECT 1 FROM deal_context_snapshots WHERE deal_id = '$DEAL_ID');" 2>/dev/null | tr -d ' ')
        
        if [ "$SNAPSHOT_EXISTS" = "t" ]; then
            echo "✅ Snapshot exists"
        else
            echo "⚠️  No snapshot - will fall back to view"
            echo "   Run: SELECT refresh_deal_context_snapshot('$DEAL_ID');"
        fi
        echo ""
        
        # Check for uploads
        echo "📄 Checking for uploads..."
        UPLOAD_COUNT=$(psql "$DATABASE_URL" -t -c "SELECT COUNT(*) FROM borrower_uploads WHERE deal_id = '$DEAL_ID';" 2>/dev/null | tr -d ' ')
        echo "   Found $UPLOAD_COUNT upload(s)"
        echo ""
        
        # Show command center URL
        echo "🚀 Test Command Center:"
        echo "   http://localhost:3000/deals/$DEAL_ID/command"
        echo ""
        
        # Test intel endpoint
        echo "🧪 Test Intel Endpoint:"
        if [ "$UPLOAD_COUNT" -gt 0 ]; then
            echo "   curl -X POST \"http://localhost:3000/api/deals/$DEAL_ID/intel/run\" | jq"
        else
            echo "   ⚠️  No uploads found - intel endpoint will fail"
        fi
        echo ""
        
        # Test pricing endpoint
        echo "💰 Test Pricing Endpoint:"
        echo "   curl -X POST \"http://localhost:3000/api/deals/$DEAL_ID/pricing/quote\" \\"
        echo "     -H \"Content-Type: application/json\" \\"
        echo "     -d '{\"requestedAmount\":500000,\"termMonths\":60,\"riskRating\":5,\"collateralStrength\":\"moderate\"}' | jq"
        echo ""
        
    else
        echo "❌ No deals found in database"
        echo "   Create a deal first"
    fi
else
    echo "⚠️  Cannot query database directly"
    echo "   Replace [DEAL_ID] with actual ID:"
    echo ""
    echo "🚀 Command Center:"
    echo "   http://localhost:3000/deals/[DEAL_ID]/command"
    echo ""
    echo "🧪 Intel API:"
    echo "   curl -X POST \"http://localhost:3000/api/deals/[DEAL_ID]/intel/run\" | jq"
    echo ""
    echo "💰 Pricing API:"
    echo "   curl -X POST \"http://localhost:3000/api/deals/[DEAL_ID]/pricing/quote\" \\"
    echo "     -H \"Content-Type: application/json\" \\"
    echo "     -d '{\"requestedAmount\":500000,\"termMonths\":60,\"riskRating\":5,\"collateralStrength\":\"moderate\"}' | jq"
fi

echo ""
echo "✅ Test suite ready!"
echo ""
echo "Next steps:"
echo "1. Start dev server: npm run dev"
echo "2. Visit command center URL above"
echo "3. Click 'Run Intel Now' button"
echo "4. Click 'Quote Pricing' button"
echo ""
