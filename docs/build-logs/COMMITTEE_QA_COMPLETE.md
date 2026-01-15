# Committee Q&A System - Complete ✅

## Overview
The Committee Q&A system allows underwriters to ask natural language questions about a deal and get AI-generated answers that are **grounded in actual evidence** from uploaded documents. Every answer includes clickable citations that link directly to the source chunks.

## Architecture

### Two-Phase Retrieval + Rerank
```
User Question
     ↓
[1. Retrieve] → pgvector semantic search → Top 20 chunks
     ↓
[2. Rerank] → LLM selects best 1-8 chunks → High-quality subset
     ↓
[3. Answer] → LLM generates answer with citations → Grounded response
```

### Why Two Phases?
1. **Retrieve (Top-K)**: Fast semantic search using pgvector returns 20 candidates
2. **Rerank (LLM)**: AI selects the MINIMUM set (1-8) that actually answer the question
   - Eliminates false positives from semantic search
   - Reduces context window for better answer quality
   - Focuses LLM on most relevant evidence

## Database Schema

### deal_doc_chunks Table
```sql
CREATE TABLE deal_doc_chunks (
  id UUID PRIMARY KEY,
  deal_id UUID REFERENCES deals(id),
  upload_id UUID REFERENCES deal_uploads(id),
  chunk_index INTEGER,
  content TEXT,
  embedding VECTOR(1536), -- OpenAI text-embedding-3-small
  page_start INTEGER,
  page_end INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX ON deal_doc_chunks USING ivfflat (embedding vector_cosine_ops);
```

### RPC Function
```sql
CREATE FUNCTION match_deal_doc_chunks(
  in_deal_id UUID,
  in_query_embedding VECTOR(1536),
  in_match_count INTEGER
) RETURNS TABLE (
  chunk_id UUID,
  upload_id UUID,
  chunk_index INTEGER,
  content TEXT,
  page_start INTEGER,
  page_end INTEGER,
  similarity FLOAT
) AS $$
  SELECT 
    id AS chunk_id,
    upload_id,
    chunk_index,
    content,
    page_start,
    page_end,
    1 - (embedding <=> in_query_embedding) AS similarity
  FROM deal_doc_chunks
  WHERE deal_id = in_deal_id
  ORDER BY embedding <=> in_query_embedding
  LIMIT in_match_count;
$$ LANGUAGE sql;
```

## API Endpoint

### POST /api/deals/:dealId/committee
```typescript
// Request
{
  question: string;
  debug?: boolean; // Show retrieval details
}

// Response
{
  ok: true;
  answer: string;
  citations: Citation[];
  debug?: {
    topChunks: RetrievedChunk[];
    selectedChunks: RetrievedChunk[];
  };
}

// Citation Format
{
  chunk_id: string;
  upload_id: string;
  chunk_index?: number;
  page_start?: number;
  page_end?: number;
  snippet: string;
  similarity?: number;
}
```

## Core Functions

### 1. retrieveTopChunks (Semantic Search)
```typescript
// src/lib/retrieval/retrieve.ts
export async function retrieveTopChunks(opts: {
  dealId: string;
  question: string;
  k?: number;
}): Promise<RetrievedChunk[]>
```
- Embeds question using OpenAI `text-embedding-3-small`
- Calls `match_deal_doc_chunks` RPC for vector similarity search
- Returns top K chunks (default 20) with similarity scores

### 2. rerankChunks (LLM Selection)
```typescript
// src/lib/retrieval/committee.ts
export async function rerankChunks(
  question: string,
  candidates: RetrievedChunk[]
): Promise<{ selected_chunk_ids: string[]; rationale?: string }>
```
- Prompts LLM: "Select MINIMUM set of chunks (1-8) that best answer question"
- Uses `gpt-4o` with JSON mode for structured output
- Returns only chunk IDs + rationale for selection

### 3. answerWithCitations (Grounded Answer)
```typescript
export async function answerWithCitations(
  question: string,
  selected: RetrievedChunk[]
): Promise<{ answer: string; citations: { chunk_id: string; quote: string }[] }>
```
- Context: Only the selected chunks (not all 20)
- Instructions: "Answer using ONLY provided chunks, MUST cite with chunk_id + quote"
- Uses `gpt-4o` with JSON mode
- Returns answer + citations array

### 4. committeeAnswer (Orchestration)
```typescript
export async function committeeAnswer(opts: {
  dealId: string;
  question: string;
  debug?: boolean;
}): Promise<CommitteeAnswer>
```
- Calls retrieve → rerank → answer in sequence
- Enriches citations with full chunk metadata
- Returns complete response with citations

## UI Components

### Committee Page (/deals/:dealId/committee)
```typescript
// src/app/deals/[dealId]/committee/page.tsx
"use client"

Features:
- Textarea for natural language question
- Submit button with loading state
- Answer display with markdown formatting
- Clickable citations linking to evidence viewer
- Debug mode toggle (shows retrieval details)
- Error handling + user feedback
```

### Evidence Viewer (/deals/:dealId/evidence?chunk_id=xxx)
```typescript
// src/app/deals/[dealId]/evidence/page.tsx

Features:
- Shows target chunk (highlighted)
- Shows surrounding chunks by index (context)
- Displays chunk metadata (page range, similarity)
- Breadcrumbs back to committee
```

## Testing

### 1. Embed Test Deal Chunks
```bash
# One-time setup: embed chunks for a deal
npx tsx scripts/retrieval/embedDeal.ts 3d5f3725-5961-4cc2-91dd-3e95c54e7151

# Verify embeddings
node scripts/verify-embeddings.mjs
```

### 2. Test Committee Endpoint
```bash
curl -X POST http://localhost:3000/api/deals/3d5f3725-5961-4cc2-91dd-3e95c54e7151/committee \
  -H "Content-Type: application/json" \
  -d '{"question": "What are the biggest risks?", "debug": true}'
```

### 3. Manual Testing
```bash
npm run dev
# Navigate to http://localhost:3000/deals/:dealId/committee
# Ask: "What are the biggest risks in this deal?"
# Click citations → verify evidence viewer shows correct chunk
```

### Expected Flow
1. Enter question: "What are the biggest risks?"
2. Click "Ask Committee"
3. See answer: "Based on the loan documents, the main risks are..."
4. See citations: [1] Financial statements show declining revenue...
5. Click citation [1] → Evidence viewer shows chunk + neighbors

## Key Patterns Applied

### ✅ Multi-Tenant
- All queries scoped to `deal_id`
- No cross-deal leakage in vector search

### ✅ Supabase Admin Pattern
```typescript
const sb = getSupabaseServerClient();
const { data } = await sb.rpc('match_deal_doc_chunks', { ... });
```

### ✅ OpenAI Chat Completions
```typescript
const openai = getOpenAI();
const model = getModel();
const resp = await openai.chat.completions.create({
  model: model,
  messages: [...],
  response_format: { type: "json_object" },
  temperature: 0.1,
});
```

### ✅ Next.js 16 Async Params
```typescript
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ dealId: string }> }
) {
  const { dealId } = await ctx.params;
  // ...
}
```

## Prompt Engineering

### Rerank Prompt
```
You are an underwriting assistant. Your task: select the MINIMUM set of chunks (1-8) that can answer the question.

Question: {question}

Candidates:
1. id=uuid1 sim=0.87 text="..."
2. id=uuid2 sim=0.85 text="..."
...

Return JSON: {"selected_chunk_ids": ["uuid1", ...], "rationale": "..."}
```

### Answer Prompt
```
You are an underwriting committee assistant.
Answer using ONLY the provided chunks.
If chunks don't contain enough info, say what is missing and do NOT invent facts.
You MUST include citations. Each citation must reference chunk_id and include a short quote.

Question: {question}

CHUNK 1
chunk_id: uuid1
text: ...

CHUNK 2
chunk_id: uuid2
text: ...

Return JSON: {
  "answer": "...",
  "citations": [
    {"chunk_id": "uuid1", "quote": "exact quote from chunk"}
  ]
}
```

## Environment Variables

### Required
```bash
OPENAI_API_KEY=sk-...
NEXT_PUBLIC_SUPABASE_URL=https://xyz.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...
```

### Optional
```bash
OPENAI_EMBEDDING_MODEL=text-embedding-3-small  # Default
OPENAI_CHAT_MODEL=gpt-4o                        # Default
```

## Troubleshooting

### No chunks returned
```bash
# Check if chunks exist
node scripts/check-chunks.mjs

# Check if embeddings exist
node scripts/verify-embeddings.mjs

# Embed if needed
npx tsx scripts/retrieval/embedDeal.ts <dealId>
```

### Poor retrieval quality
- Increase K in retrieveTopChunks (default 20)
- Check embedding model consistency (must match chunks)
- Verify chunks have meaningful content (not just headers/footers)

### Citations missing
- Check LLM response includes citations array
- Verify Zod schema parsing succeeds
- Enable debug mode to see raw LLM output

### Evidence viewer not loading
- Check chunk_id in URL is valid UUID
- Verify chunk exists in deal_doc_chunks table
- Check Supabase RLS policies allow access

## Future Enhancements

### Short-term
- [ ] Store committee runs in `ai_events` table for traceability
- [ ] Add seed questions UI ("Summarize concentration risk", "What covenants?")
- [ ] Wire committee link into deal navigation sidebar

### Medium-term
- [ ] Add bank policy retrieval as second pgvector store
- [ ] Replace snippet quotes with real doc/page citations once OCR spans exist
- [ ] Add "Memo section" generator reusing same retrieval core
- [ ] Implement multi-turn conversation with follow-up questions

### Long-term
- [ ] Cross-deal retrieval ("How did we handle similar risks in past deals?")
- [ ] Auto-suggest questions based on deal characteristics
- [ ] Export committee Q&A to PDF for credit memo

## Related Documentation
- **PACK_INTEGRATION_COMPLETE.md** - Document chunking strategy
- **CONDITIONS_README.md** - Deterministic underwriting rules
- **BUDDY_BUILD_RULES.md** - Coding conventions

---

**Ship fast, stay grounded.** This system proves AI can be both powerful and trustworthy when every answer traces back to real evidence.
