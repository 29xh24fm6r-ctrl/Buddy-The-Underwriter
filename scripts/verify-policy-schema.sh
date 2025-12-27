#!/bin/bash
# Verify bank_policy_chunks embedding configuration

set -e

echo "🔍 Checking bank_policy_chunks table schema..."
echo ""

# Check if table exists
psql "$DATABASE_URL" -c "\dt bank_policy_chunks" 2>/dev/null || {
  echo "❌ bank_policy_chunks table not found"
  echo "Run the migration first: supabase/migrations/*bank_policy*.sql"
  exit 1
}

# Check embedding column type
echo "📊 Embedding column type:"
psql "$DATABASE_URL" -c "
  SELECT pg_typeof(embedding) as vector_type
  FROM bank_policy_chunks 
  WHERE embedding IS NOT NULL
  LIMIT 1;
" 2>/dev/null || echo "No embedded rows yet"

# Check column definition
echo ""
echo "📋 Column definition:"
psql "$DATABASE_URL" -c "
  SELECT column_name, data_type, udt_name
  FROM information_schema.columns
  WHERE table_name = 'bank_policy_chunks'
    AND column_name = 'embedding';
"

# Check indexes
echo ""
echo "🔗 Indexes:"
psql "$DATABASE_URL" -c "
  SELECT indexname, indexdef
  FROM pg_indexes
  WHERE tablename = 'bank_policy_chunks'
    AND indexname LIKE '%embedding%';
"

# Check RPC function signature
echo ""
echo "⚙️  RPC function signature:"
psql "$DATABASE_URL" -c "
  SELECT 
    p.proname as function_name,
    pg_get_function_arguments(p.oid) as arguments,
    pg_get_function_result(p.oid) as return_type
  FROM pg_proc p
  JOIN pg_namespace n ON p.pronamespace = n.oid
  WHERE n.nspname = 'public'
    AND p.proname = 'match_bank_policy_chunks';
"

# Check chunk counts
echo ""
echo "📊 Chunk statistics:"
psql "$DATABASE_URL" -c "
  SELECT
    bank_id,
    COUNT(*) as total_chunks,
    COUNT(embedding) as embedded_chunks,
    MIN(embedded_at) as first_embed,
    MAX(embedded_at) as last_embed
  FROM bank_policy_chunks
  GROUP BY bank_id
  ORDER BY embedded_chunks DESC;
"

echo ""
echo "✅ Schema check complete!"
echo ""
echo "Expected:"
echo "  - vector_type: vector(1536)"
echo "  - index: ivfflat with vector_cosine_ops"
echo "  - RPC: match_bank_policy_chunks(uuid, vector(1536), int)"
