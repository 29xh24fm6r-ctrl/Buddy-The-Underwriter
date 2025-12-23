#!/bin/bash
# Test Upload Intelligence System

set -e

echo "🧪 Upload Intelligence System - Test Suite"
echo "=========================================="
echo ""

# Check if psql is available
if ! command -v psql &> /dev/null; then
    echo "⚠️  psql not found - skipping direct database queries"
    echo "   You can run these queries in Supabase Dashboard instead"
    echo ""
    HAS_PSQL=false
else
    HAS_PSQL=true
fi

# Check if DATABASE_URL is set
if [ -z "$DATABASE_URL" ]; then
    echo "⚠️  DATABASE_URL not set - some tests will be skipped"
    echo ""
    HAS_DB=false
else
    HAS_DB=true
fi

# Test 1: Get recent uploads
if [ "$HAS_DB" = true ] && [ "$HAS_PSQL" = true ]; then
    echo "📋 Test 1: Recent Uploads"
    echo "------------------------"
    psql "$DATABASE_URL" -c "
        SELECT id, deal_id, original_filename, created_at 
        FROM borrower_uploads 
        ORDER BY created_at DESC 
        LIMIT 5;
    " 2>&1 || echo "Failed to query uploads"
    echo ""
fi

# Test 2: Show example curl command
echo "🔧 Test 2: Trigger Intelligence Extraction"
echo "----------------------------------------"
if [ "$HAS_DB" = true ] && [ "$HAS_PSQL" = true ]; then
    UPLOAD_ID=$(psql "$DATABASE_URL" -t -c "SELECT id FROM borrower_uploads ORDER BY created_at DESC LIMIT 1;" 2>/dev/null | tr -d ' ')
    if [ -n "$UPLOAD_ID" ]; then
        echo "Found upload ID: $UPLOAD_ID"
        echo ""
        echo "Run this command to test:"
        echo "  curl -s -X POST \"http://localhost:3000/api/uploads/$UPLOAD_ID/intel\" | jq"
    else
        echo "No uploads found"
    fi
else
    echo "Replace <UPLOAD_ID> with actual ID:"
    echo "  curl -s -X POST \"http://localhost:3000/api/uploads/<UPLOAD_ID>/intel\" | jq"
fi
echo ""

# Test 3: Check for extractions
if [ "$HAS_DB" = true ] && [ "$HAS_PSQL" = true ]; then
    echo "📊 Test 3: Recent Extractions"
    echo "---------------------------"
    psql "$DATABASE_URL" -c "
        SELECT deal_id, upload_id, kind, created_at 
        FROM borrower_upload_extractions 
        ORDER BY created_at DESC 
        LIMIT 5;
    " 2>&1 || echo "No extractions found (or table doesn't exist yet)"
    echo ""
fi

# Test 4: Check snapshots
if [ "$HAS_DB" = true ] && [ "$HAS_PSQL" = true ]; then
    echo "📸 Test 4: Recent Snapshot Updates"
    echo "--------------------------------"
    psql "$DATABASE_URL" -c "
        SELECT deal_id, updated_at, version 
        FROM deal_context_snapshots 
        ORDER BY updated_at DESC 
        LIMIT 5;
    " 2>&1 || echo "No snapshots found (or table doesn't exist yet)"
    echo ""
fi

# Test 5: Verify trigger exists
if [ "$HAS_DB" = true ] && [ "$HAS_PSQL" = true ]; then
    echo "🔍 Test 5: Verify Trigger Exists"
    echo "------------------------------"
    psql "$DATABASE_URL" -c "
        SELECT tgname, tgrelid::regclass, tgfoid::regproc
        FROM pg_trigger 
        WHERE tgname = 'tr_refresh_snapshot_upload_extractions';
    " 2>&1 || echo "Trigger not found (needs to be created)"
    echo ""
fi

echo "✅ Test suite complete!"
echo ""
echo "Next steps:"
echo "1. Run the migration: migrations/create_upload_extractions_trigger.sql"
echo "2. Test with a real upload ID"
echo "3. Enhance extractor logic in src/lib/intel/extractors/"
echo ""
