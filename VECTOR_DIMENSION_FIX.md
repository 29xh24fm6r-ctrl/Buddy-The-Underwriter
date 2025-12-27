# Vector Dimension Fix - Complete ✅

## Issue
The `bank_policy_chunks.embedding` column needs to use `vector(1536)` to be compatible with ivfflat indexes in PostgreSQL/pgvector. ivfflat only supports vectors with ≤ 2000 dimensions.

## Solution Applied
All code and migrations already use the correct configuration:
- ✅ Embedding model: `text-embedding-3-small` (1536 dimensions)
- ✅ Migration: `vector(1536)` in `20251227_post_merge_upgrades.sql`
- ✅ Index: ivfflat with `vector_cosine_ops`
- ✅ RPC: `match_bank_policy_chunks(uuid, vector(1536), int)`

## What Changed

### 1. Migration Already Correct
[supabase/migrations/20251227_post_merge_upgrades.sql](supabase/migrations/20251227_post_merge_upgrades.sql)
```sql
alter table public.bank_policy_chunks
  add column if not exists embedding vector(1536);  -- ✅ 1536 dims

create index bank_policy_chunks_embedding_idx
  using ivfflat (embedding vector_cosine_ops)  -- ✅ ivfflat works with 1536
  with (lists = 100);
```

### 2. Embedding Script Already Correct
[scripts/retrieval/embedBankPolicy.ts](scripts/retrieval/embedBankPolicy.ts)
```typescript
const EMBEDDING_MODEL = 
  process.env.OPENAI_EMBEDDING_MODEL || "text-embedding-3-small"; // ✅ 1536 dims
```

### 3. Retrieval Helper Already Correct
[src/lib/retrieval/retrieve.ts](src/lib/retrieval/retrieve.ts)
```typescript
const EMBEDDING_MODEL = 
  process.env.OPENAI_EMBEDDING_MODEL || "text-embedding-3-small"; // ✅ 1536 dims
```

### 4. Policy Retrieval Already Correct
[src/lib/retrieval/policy.ts](src/lib/retrieval/policy.ts)
```typescript
// Uses embedQuery() which uses text-embedding-3-small ✅
const emb = await embedQuery(question);
```

## New Files Created

### Fix Migration (if needed)
[supabase/migrations/20251227_fix_policy_vector_dims.sql](supabase/migrations/20251227_fix_policy_vector_dims.sql)
- Drops and recreates `embedding` column at `vector(1536)`
- Recreates ivfflat index
- Recreates RPC with correct signature
- Run this ONLY if your table was created with wrong dimensions

### Verification Script
[scripts/verify-policy-schema.sh](scripts/verify-policy-schema.sh)
```bash
# Check schema configuration
./scripts/verify-policy-schema.sh
```

Verifies:
- Embedding column type is `vector(1536)`
- ivfflat index exists
- RPC signature is correct
- Shows chunk statistics

## Verification Commands

### 1. Check Column Type
```sql
SELECT pg_typeof(embedding) as vector_type
FROM bank_policy_chunks 
WHERE embedding IS NOT NULL
LIMIT 1;

-- Expected: vector(1536)
```

### 2. Check Index
```sql
SELECT indexname, indexdef
FROM pg_indexes
WHERE tablename = 'bank_policy_chunks'
  AND indexname LIKE '%embedding%';

-- Expected: ivfflat index with vector_cosine_ops
```

### 3. Check RPC Function
```sql
SELECT 
  proname as function_name,
  pg_get_function_arguments(oid) as arguments
FROM pg_proc
WHERE proname = 'match_bank_policy_chunks'
  AND pronamespace = 'public'::regnamespace;

-- Expected: in_bank_id uuid, in_query_embedding vector(1536), in_match_count integer
```

### 4. Test Embedding
```bash
# Embed a few chunks
npx tsx scripts/retrieval/embedBankPolicy.ts <bank_uuid>

# Check counts
psql $DATABASE_URL -c "
  SELECT 
    COUNT(*) as total,
    COUNT(embedding) as embedded
  FROM bank_policy_chunks
  WHERE bank_id = '<bank_uuid>';
"
```

### 5. Test Retrieval
```bash
curl -X POST http://localhost:3000/api/banks/<bankId>/policy/query \
  -H "content-type: application/json" \
  -d '{"question":"What is the maximum LTV?"}'
```

## Why 1536 Dims?

### text-embedding-3-small (1536 dims) ✅
- **Works with ivfflat** (≤ 2000 dims)
- Cost-effective ($0.02 / 1M tokens)
- Fast retrieval
- Good quality for most use cases
- **Aligns with deal_doc_chunks** (also 1536)

### text-embedding-3-large (3072 dims) ❌
- **Doesn't work with ivfflat** (> 2000 dims)
- Requires HNSW index (not all pgvector versions support)
- 2x cost ($0.13 / 1M tokens)
- Marginal quality improvement
- Slower retrieval

## Alternative: HNSW (if you need 3072 dims)

If you absolutely need `text-embedding-3-large` (3072 dims):

```sql
-- Check pgvector version
SELECT extversion FROM pg_extension WHERE extname='vector';

-- If version >= 0.5.0, HNSW is available:
alter table bank_policy_chunks
  add column embedding vector(3072);

create index bank_policy_chunks_embedding_hnsw
  on bank_policy_chunks using hnsw (embedding vector_cosine_ops);
```

**But we recommend sticking with 1536 dims** for consistency with deal chunks and proven ivfflat performance.

## Troubleshooting

### Error: "ivfflat index only supports vectors with <= 2000 dimensions"
**Solution:** Run the fix migration:
```bash
# In Supabase SQL Editor:
# Paste contents of supabase/migrations/20251227_fix_policy_vector_dims.sql
```

### Error: "dimension mismatch" when inserting embeddings
**Check:**
```sql
-- What dimension is the column?
SELECT pg_typeof(embedding) FROM bank_policy_chunks LIMIT 1;

-- What dimension are you inserting?
-- Embedding model should be text-embedding-3-small (1536)
```

### Error: "function match_bank_policy_chunks does not exist"
**Solution:** Run the RPC creation part of the migration.

### Slow retrieval
**Check index:**
```sql
-- Should have ivfflat index
SELECT * FROM pg_indexes 
WHERE tablename = 'bank_policy_chunks' 
  AND indexname LIKE '%embedding%';
```

## Summary

✅ **No changes needed!** Your implementation already uses:
- `vector(1536)` dimensions
- `text-embedding-3-small` model
- ivfflat index (compatible with 1536)
- Correct RPC signature

If you encounter dimension errors, it means the table was created differently than the migration. Run the fix migration to reset to correct dimensions.

---

**Consistent 1536 dims across all vector stores. ivfflat-compatible. Production-ready.** 🎯
