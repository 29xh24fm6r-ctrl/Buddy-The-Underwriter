# Schema Mismatch Fixes - Complete

## Overview

**Date**: 2024-12-27  
**Branch**: `feat/post-merge-upgrades`  
**Purpose**: Fix SQL errors from production schema vs. God-Mode migrations

This document details fixes for 7 schema mismatches identified in the user's screenshots.

---

## Errors Fixed

### A) ❌ `column c.source_label does not exist`
**Problem**: `deal_doc_chunks` didn't have `source_label` column  
**Fix**: Added `source_label TEXT` column to both `deal_doc_chunks` and `bank_policy_chunks`

### B) ❌ `column "kind" does not exist`
**Problem**: WOW Factor migration created `ai_run_events` with `run_kind`, but production has `ai_events` with `action`/`scope`  
**Fix**: 
- Dropped `ai_run_events` and `ai_run_citations` tables
- Extended existing `ai_events` with `model`, `usage_json`, `error_message`
- Created `ai_event_citations` table (references `ai_events.id`)
- Updated all code to use `scope` + `action` instead of `run_kind`

### C) ❌ `syntax error near ":"` 
**Problem**: Supabase SQL Editor doesn't support `:named` parameters  
**Fix**: Documentation note - use literal UUIDs or `DO $$ ... END $$` blocks

### D) ❌ `column c.embedding does not exist`
**Problem**: `bank_policy_chunks` was missing `embedding` column  
**Fix**: Added `embedding vector(1536)` column

### E) ❌ `column cannot have more than 2000 dims`
**Problem**: ivfflat index has 2000-dimension limit  
**Fix**: Switched to HNSW index (no dimension limit, faster)

### F) ❌ `syntax error near "SQL"`
**Problem**: User pasted markdown fence markers into SQL editor  
**Fix**: Documentation note - paste statements only, no markers

### G) ❌ `column "severity" does not exist`
**Problem**: `sba_policy_rules` was missing several columns  
**Fix**: Added `title`, `category`, `borrower_friendly_explanation`, `fix_suggestions`, `severity`, `effective_date`, `updated_at`

---

## Database Changes

### 1. Unified AI Events Schema

**Dropped**:
- `ai_run_events` (conflicted with existing `ai_events`)
- `ai_run_citations` (replaced with `ai_event_citations`)

**Extended `ai_events`**:
```sql
ALTER TABLE public.ai_events
  ADD COLUMN IF NOT EXISTS model TEXT,
  ADD COLUMN IF NOT EXISTS usage_json JSONB,
  ADD COLUMN IF NOT EXISTS error_message TEXT;
```

**Created `ai_event_citations`**:
```sql
CREATE TABLE public.ai_event_citations (
  citation_id UUID PRIMARY KEY,
  event_id UUID REFERENCES public.ai_events(id),
  source_kind TEXT CHECK (source_kind IN ('DEAL_DOC', 'BANK_POLICY', 'SBA_POLICY')),
  source_id UUID,
  chunk_id UUID,
  page_num INT,
  quote TEXT,
  similarity REAL,
  citation_index INT
);
```

### 2. Vector Embeddings Fix

**bank_policy_chunks**:
```sql
ALTER TABLE public.bank_policy_chunks
  ADD COLUMN IF NOT EXISTS embedding vector(1536),
  ADD COLUMN IF NOT EXISTS source_label TEXT;

-- HNSW index (no dimension limit)
CREATE INDEX bank_policy_chunks_embedding_hnsw
  ON public.bank_policy_chunks
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);
```

**deal_doc_chunks**:
```sql
ALTER TABLE public.deal_doc_chunks
  ADD COLUMN IF NOT EXISTS source_label TEXT;

-- Ensure HNSW index exists
CREATE INDEX deal_doc_chunks_embedding_hnsw
  ON public.deal_doc_chunks
  USING hnsw (embedding vector_cosine_ops);
```

### 3. SBA Policy Rules Enhancement

```sql
ALTER TABLE public.sba_policy_rules
  ADD COLUMN IF NOT EXISTS title TEXT,
  ADD COLUMN IF NOT EXISTS category TEXT,
  ADD COLUMN IF NOT EXISTS borrower_friendly_explanation TEXT,
  ADD COLUMN IF NOT EXISTS fix_suggestions JSONB,
  ADD COLUMN IF NOT EXISTS severity TEXT CHECK (severity IN ('HARD_STOP', 'REQUIRES_MITIGATION', 'ADVISORY')),
  ADD COLUMN IF NOT EXISTS effective_date DATE,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
```

### 4. Updated RPC Function

```sql
CREATE OR REPLACE FUNCTION public.match_bank_policy_chunks(
  p_bank_id UUID,
  query_embedding vector(1536),
  match_count INT DEFAULT 10
)
RETURNS TABLE (
  chunk_id UUID,
  asset_id UUID,
  chunk_text TEXT,
  doc_name TEXT,
  source_label TEXT,
  similarity REAL
)
-- Returns results with source_label included
```

---

## Code Changes

### API Routes Updated

**Before (using ai_run_events)**:
```typescript
const { data: runEvent } = await sb
  .from("ai_run_events")
  .insert({
    deal_id: dealId,
    run_kind: "ASK_BUDDY",
    input_json: { question },
    output_json: result
  })
  .select("run_id")
  .single();
```

**After (using ai_events)**:
```typescript
const { data: eventRow } = await sb
  .from("ai_events")
  .insert({
    deal_id: dealId,
    scope: "ask_buddy",
    action: "answer",
    input_json: { question },
    output_json: result,
    model: "gpt-4o-mini",
    usage_json: completion.usage,
    requires_human_review: false
  })
  .select("id")
  .single();
```

### Scope/Action Mapping

| Old `run_kind` | New `scope` | New `action` |
|----------------|-------------|--------------|
| `ASK_BUDDY` | `ask_buddy` | `answer` |
| `MEMO_SECTION` | `memo_generation` | `generate_section` |
| `COMMITTEE` | `committee_simulation` | `evaluate` |
| `EXPLAIN_RISK` | `risk_explanation` | `explain` |

### Citations Updated

**Before**:
```typescript
await sb.from("ai_run_citations").insert({
  run_id: runEvent.run_id,
  source_kind: "DEAL_DOC",
  ...
});
```

**After**:
```typescript
await sb.from("ai_event_citations").insert({
  event_id: eventRow.id,
  source_kind: "DEAL_DOC",
  ...
});
```

---

## Files Changed

### Migration:
- `supabase/migrations/20251227_fix_schema_mismatches.sql` - All schema fixes

### API Routes:
- `src/app/api/deals/[dealId]/ask/route.ts` - Use ai_events
- `src/app/api/deals/[dealId]/memo/generate/route.ts` - Use ai_events
- `src/app/api/deals/[dealId]/committee/evaluate/route.ts` - Update response

### Libraries:
- `src/lib/sba/committee.ts` - Use ai_events, update CommitteeResult type

---

## Migration Instructions

### 1. Run Schema Fix Migration

```bash
psql $DATABASE_URL -f supabase/migrations/20251227_fix_schema_mismatches.sql
```

### 2. Verify Schema

```sql
-- Check ai_events has new columns
SELECT column_name FROM information_schema.columns 
WHERE table_name='ai_events' AND column_name IN ('model', 'usage_json');

-- Check ai_event_citations exists
SELECT table_name FROM information_schema.tables 
WHERE table_name='ai_event_citations';

-- Check bank_policy_chunks has embedding
SELECT column_name FROM information_schema.columns 
WHERE table_name='bank_policy_chunks' AND column_name='embedding';

-- Check HNSW indexes exist
SELECT indexname FROM pg_indexes 
WHERE indexname LIKE '%hnsw%';
```

### 3. Test API Endpoints

```bash
# Test Ask Buddy
curl -X POST http://localhost:3000/api/deals/{dealId}/ask \
  -H "Content-Type: application/json" \
  -d '{"question": "What is the DSCR?"}'

# Test Committee Evaluation
curl -X POST http://localhost:3000/api/deals/{dealId}/committee/evaluate \
  -H "Content-Type: application/json" \
  -d '{"question": "Is this deal approvable?"}'
```

---

## Breaking Changes

### 1. API Response Format

**Before**:
```json
{ "ok": true, "run_id": "uuid", "answer": "..." }
```

**After**:
```json
{ "ok": true, "event_id": "uuid", "answer": "..." }
```

### 2. Database Tables

- `ai_run_events` → Use `ai_events` instead
- `ai_run_citations` → Use `ai_event_citations` instead

### 3. Query Patterns

**Before**:
```sql
SELECT * FROM ai_run_events WHERE run_kind = 'ASK_BUDDY';
```

**After**:
```sql
SELECT * FROM ai_events WHERE scope = 'ask_buddy' AND action = 'answer';
```

---

## Benefits of New Schema

### 1. Single Source of Truth
- All AI activity in one `ai_events` table
- Consistent with existing production schema
- No duplicate event tracking

### 2. Better Performance
- HNSW indexes (faster than ivfflat)
- No dimension limits (supports any embedding model)
- Optimized for pgvector queries

### 3. Improved Traceability
- `scope` + `action` more granular than `run_kind`
- `usage_json` tracks token costs
- `error_message` for debugging

### 4. Flexible Schema
- Easy to add new scopes/actions without migration
- Compatible with existing `ai_events` consumers
- Backward compatible with production code

---

## Verification Queries

### Check AI Events

```sql
-- Recent AI events
SELECT scope, action, created_at, model
FROM ai_events
ORDER BY created_at DESC
LIMIT 10;

-- Events with citations
SELECT e.scope, e.action, COUNT(c.citation_id) as citation_count
FROM ai_events e
LEFT JOIN ai_event_citations c ON e.id = c.event_id
GROUP BY e.scope, e.action;
```

### Check Vector Embeddings

```sql
-- Bank policy chunks with embeddings
SELECT COUNT(*), AVG(array_length(embedding::float[], 1)) as avg_dims
FROM bank_policy_chunks
WHERE embedding IS NOT NULL;

-- Deal doc chunks with embeddings
SELECT COUNT(*), AVG(array_length(embedding::float[], 1)) as avg_dims
FROM deal_doc_chunks
WHERE embedding IS NOT NULL;
```

---

## Conclusion

All 7 schema mismatch errors are now fixed:

✅ **A** - Added `source_label` to both chunk tables  
✅ **B** - Unified to `ai_events` (scope/action) instead of `ai_run_events` (run_kind)  
✅ **C** - Documented parameter syntax  
✅ **D** - Added `embedding` column to `bank_policy_chunks`  
✅ **E** - Switched to HNSW indexes (no dimension limit)  
✅ **F** - Documented SQL editor usage  
✅ **G** - Added missing columns to `sba_policy_rules`  

The schema is now consistent between God-Mode features and production database.
