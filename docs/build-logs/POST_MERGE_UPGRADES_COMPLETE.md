# Post-Merge Upgrades - Complete ✅

## Overview
Four major enhancements to the Committee Q&A system that add production-grade traceability, real document citations, memo generation, and bank policy integration.

## 1️⃣ Traceability: AI Events + Citations

### What Changed
Every Committee/Memo/Policy run now creates audit records in `ai_events` and `ai_run_citations` tables.

### Database Schema

**ai_run_citations**
```sql
create table ai_run_citations (
  id uuid primary key,
  ai_event_id uuid references ai_events(id),
  deal_id uuid null,
  bank_id uuid null,
  
  -- Source tracking
  source_kind text check (source_kind in ('deal_doc_chunk','bank_policy_chunk')),
  chunk_id uuid not null,
  
  -- Deal chunk fields
  upload_id uuid null,
  chunk_index int null,
  page_start int null,
  page_end int null,
  
  -- OCR span fields (richer citations)
  document_id uuid null,
  page_number int null,
  bbox jsonb null, -- {x,y,w,h} normalized coords
  
  excerpt text not null,
  similarity numeric null,
  created_at timestamptz default now()
);
```

### New Helper: `src/lib/ai/trace.ts`

```typescript
// Insert AI event
const aiEventId = await insertAiEvent({
  deal_id: dealId,
  kind: "committee.answer",
  model: "gpt-4o",
  input: { question, dealId },
  output: result,
  meta: { retrieved_k: 20 },
});

// Insert citations
await insertAiCitations([
  {
    ai_event_id: aiEventId,
    deal_id: dealId,
    source_kind: "deal_doc_chunk",
    chunk_id: "uuid",
    excerpt: "quoted text",
    similarity: 0.87,
    ...
  }
]);
```

### Usage in Routes
- `POST /api/deals/:dealId/committee` - Logs every Q&A run
- `POST /api/deals/:dealId/memo/section` - Logs memo generation
- `POST /api/banks/:bankId/policy/query` - Logs policy queries
- `POST /api/deals/:dealId/committee/blended` - Logs blended retrieval

### Query Audit Trail
```sql
-- See all AI runs
select kind, created_at, model, input->>'question' as question
from ai_events
where deal_id = '<dealId>'
order by created_at desc;

-- See which chunks were cited
select source_kind, count(*), avg(similarity)
from ai_run_citations
where deal_id = '<dealId>'
group by source_kind;
```

---

## 2️⃣ Real Doc/Page Citations: OCR Spans

### What Changed
Citations can now include document ID, page number, and bounding box coordinates (when OCR span data exists).

### Database Schema

**deal_doc_chunk_spans**
```sql
create table deal_doc_chunk_spans (
  id uuid primary key,
  deal_id uuid not null,
  chunk_id uuid references deal_doc_chunks(id),
  
  document_id uuid null,
  upload_id uuid null,
  page_number int not null, -- 1-based
  bbox jsonb not null, -- {x,y,w,h} normalized 0..1
  text_excerpt text null,
  
  created_at timestamptz default now()
);
```

### New Helper: `src/lib/retrieval/spans.ts`

```typescript
const span = await lookupBestSpanForChunk({ 
  dealId, 
  chunkId 
});

// Returns: { document_id, upload_id, page_number, bbox, text_excerpt }
```

### Updated Citation Type

```typescript
export type Citation = {
  chunk_id: string;
  upload_id: string;
  
  // Old fields (chunk-level)
  page_start?: number | null;
  page_end?: number | null;
  
  // NEW: OCR span fields (precise location)
  document_id?: string | null;
  page_number?: number | null;
  bbox?: any | null; // {x,y,w,h} normalized coords
  
  snippet: string;
  similarity?: number;
};
```

### Evidence Viewer Enhancement

[src/app/deals/[dealId]/evidence/page.tsx](src/app/deals/[dealId]/evidence/page.tsx) now shows OCR span info:

```tsx
{span ? (
  <div className="bg-yellow-50 p-2 rounded font-mono text-xs">
    OCR Span: document_id={span.document_id} · page={span.page_number} · bbox={JSON.stringify(span.bbox)}
  </div>
) : null}
```

### Future Integration
When you wire the real PDF viewer with overlay:
1. Use `bbox` to draw highlight rectangles on the page
2. Jump to specific `page_number` in PDF
3. Link to `document_id` for source document

---

## 3️⃣ Memo Section Generator

### What Changed
Underwriters can generate credit memo sections using the same retrieval+rerank+citations pipeline.

### New API: `POST /api/deals/:dealId/memo/section`

**Request:**
```json
{
  "section_key": "risks",
  "prompt": "Optional: specific constraints or focus"
}
```

**Response:**
```json
{
  "draft_id": "uuid",
  "section_key": "risks",
  "content": "• Risk 1: ...\n• Risk 2: ...",
  "citations": [...],
  "ai_event_id": "uuid"
}
```

### Database Schema

**deal_memo_section_drafts**
```sql
create table deal_memo_section_drafts (
  id uuid primary key,
  deal_id uuid not null,
  section_key text not null, -- "risks", "mitigants", "summary", etc
  prompt text not null,
  content text not null,
  ai_event_id uuid references ai_events(id),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
```

### UI: `/deals/:dealId/memo`

[src/app/deals/[dealId]/memo/page.tsx](src/app/deals/[dealId]/memo/page.tsx)

**Features:**
- Section tabs: summary, risks, mitigants, cash_flow, collateral, structure, covenants
- Optional prompt for constraints (tone, format, focus)
- Generate button (calls API)
- Displays content + clickable citations
- Citations link to evidence viewer

**How It Works:**
1. Retrieves top 30 chunks semantically related to section topic
2. Rerankswith LLM to select best chunks
3. Generates memo-style content (bullets, concise) with citations
4. Saves draft to `deal_memo_section_drafts`
5. Logs to `ai_events` + `ai_run_citations`

### Example Usage
```bash
curl -X POST http://localhost:3000/api/deals/3d5f.../memo/section \
  -H "content-type: application/json" \
  -d '{"section_key": "risks", "prompt": "Focus on credit risk, be concise"}'
```

---

## 4️⃣ Bank Policy Retrieval: Second Vector Store

### What Changed
Added bank policy chunks as a second pgvector store with blended retrieval (deal evidence + bank policies).

### Database Schema

**bank_policy_chunks** (enhanced)
```sql
alter table bank_policy_chunks
  add column if not exists embedding vector(1536);

create index bank_policy_chunks_embedding_idx
  on bank_policy_chunks using ivfflat (embedding vector_cosine_ops);
```

**RPC: match_bank_policy_chunks**
```sql
create function match_bank_policy_chunks(
  in_bank_id uuid,
  in_query_embedding vector(1536),
  in_match_count int
) returns table (
  chunk_id uuid,
  bank_id uuid,
  content text,
  source_label text,
  similarity float
);
```

### New Helper: `src/lib/retrieval/policy.ts`

```typescript
// Retrieve policy chunks
const policyChunks = await retrieveBankPolicyChunks({
  bankId,
  question: "What is the maximum LTV for CRE?",
  k: 12
});

// Blend deal + policy chunks
const blended = blendEvidence({
  deal: dealChunks,
  policy: policyChunks,
  maxDeal: 10,
  maxPolicy: 8
});
```

### New APIs

**1. Policy Query: `POST /api/banks/:bankId/policy/query`**
```json
{
  "question": "What is the maximum LTV for CRE loans?"
}
```

Returns answer grounded in bank policy chunks only.

**2. Blended Committee: `POST /api/deals/:dealId/committee/blended`**
```json
{
  "question": "Does this deal comply with our CRE policy?",
  "bank_id": "uuid"
}
```

Returns answer using BOTH deal evidence and bank policy chunks. Citations tagged with `source_kind`:
- `deal_doc_chunk` - From uploaded deal documents
- `bank_policy_chunk` - From bank policy library

### Embedding Script

[scripts/retrieval/embedBankPolicy.ts](scripts/retrieval/embedBankPolicy.ts)

```bash
# Embed all bank policy chunks for a bank
npx tsx scripts/retrieval/embedBankPolicy.ts <bank_uuid>
```

Uses OpenAI `text-embedding-3-small` (1536 dims), rate-limited to 4 concurrent requests.

### Use Cases

**Policy-only queries:**
- "What is our concentration limit?"
- "What documents are required for CRE loans?"
- "What is the minimum DSCR threshold?"

**Blended queries (deal + policy):**
- "Does this deal comply with our industry concentration limits?"
- "Are we missing any required documents per policy?"
- "Does the DSCR meet our minimum threshold?"

---

## Architecture Diagram

```
User Question
     ↓
┌─────────────────────────────────────┐
│ Committee Q&A (with traceability)   │
├─────────────────────────────────────┤
│ 1. Retrieve top-K chunks            │
│    - Deal docs (pgvector)           │
│    - Bank policies (pgvector)       │◄── NEW: Dual store
│                                     │
│ 2. Rerank with LLM                  │
│    - Select best 1-8 chunks         │
│                                     │
│ 3. Answer with citations            │
│    - LLM generates answer           │
│    - Must cite chunk_id + quote     │
│                                     │
│ 4. Lookup OCR spans ◄────────────── NEW: Real page+bbox
│    - Enrich with doc_id/page/bbox   │
│                                     │
│ 5. Persist audit trail ◄─────────── NEW: ai_events + citations
│    - Log ai_event                   │
│    - Log ai_run_citations           │
└─────────────────────────────────────┘
     ↓
Answer + Citations (with spans) + ai_event_id
```

---

## File Structure

### New Files Created

**Core Libraries:**
- `src/lib/ai/trace.ts` - AI event + citation persistence
- `src/lib/retrieval/spans.ts` - OCR span lookups
- `src/lib/retrieval/policy.ts` - Bank policy retrieval + blending

**API Routes:**
- `src/app/api/deals/[dealId]/memo/section/route.ts` - Memo generator
- `src/app/api/banks/[bankId]/policy/query/route.ts` - Policy Q&A
- `src/app/api/deals/[dealId]/committee/blended/route.ts` - Blended retrieval

**UI Pages:**
- `src/app/deals/[dealId]/memo/page.tsx` - Memo section generator UI

**Scripts:**
- `scripts/retrieval/embedBankPolicy.ts` - Embed bank policy chunks

**Migrations:**
- `supabase/migrations/20251227_post_merge_upgrades.sql` - All schema changes

### Updated Files
- `src/app/api/deals/[dealId]/committee/route.ts` - Added traceability
- `src/app/deals/[dealId]/evidence/page.tsx` - Shows OCR spans
- `src/lib/retrieval/committee.ts` - Span lookups in citations
- `src/lib/retrieval/types.ts` - Extended Citation type

---

## Testing

### 1. Committee with Traceability
```bash
curl -X POST http://localhost:3000/api/deals/3d5f.../committee \
  -H "content-type: application/json" \
  -d '{"question": "What are the risks?"}'
```

Verify in DB:
```sql
select * from ai_events where kind = 'committee.answer' order by created_at desc limit 1;
select * from ai_run_citations where ai_event_id = '<above_id>';
```

### 2. Memo Section Generator
```bash
# Visit UI
open http://localhost:3000/deals/3d5f.../memo

# Or API
curl -X POST http://localhost:3000/api/deals/3d5f.../memo/section \
  -d '{"section_key":"risks"}'
```

Verify draft saved:
```sql
select * from deal_memo_section_drafts where deal_id = '<dealId>';
```

### 3. Bank Policy Query
```bash
# First embed policies
npx tsx scripts/retrieval/embedBankPolicy.ts <bank_uuid>

# Then query
curl -X POST http://localhost:3000/api/banks/<bankId>/policy/query \
  -d '{"question":"What is the maximum LTV?"}'
```

### 4. Blended Retrieval
```bash
curl -X POST http://localhost:3000/api/deals/3d5f.../committee/blended \
  -d '{"question":"Does this comply with policy?", "bank_id":"<uuid>"}'
```

Check citations include both sources:
```sql
select source_kind, count(*) 
from ai_run_citations 
where ai_event_id = '<id>' 
group by source_kind;
```

---

## Environment Variables

No new env vars required. Uses existing:
- `OPENAI_API_KEY` - For embeddings + chat
- `OPENAI_EMBEDDING_MODEL` - Default: `text-embedding-3-small`
- `OPENAI_CHAT_MODEL` - Default: `gpt-4o`
- `NEXT_PUBLIC_SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

---

## Migration Checklist

- [ ] Run migration in Supabase SQL Editor:
  ```bash
  # Copy contents of supabase/migrations/20251227_post_merge_upgrades.sql
  # Paste into Supabase SQL Editor and execute
  ```

- [ ] Verify tables created:
  ```sql
  \dt ai_run_citations
  \dt deal_doc_chunk_spans
  \dt deal_memo_section_drafts
  \d+ bank_policy_chunks -- check embedding column exists
  ```

- [ ] Embed bank policy chunks:
  ```bash
  npx tsx scripts/retrieval/embedBankPolicy.ts <bank_uuid>
  ```

- [ ] Test committee endpoint logs ai_events
- [ ] Test memo generator saves drafts
- [ ] Test policy query returns citations
- [ ] Test blended retrieval mixes sources

---

## Key Benefits

### 1️⃣ Traceability
- **Auditability**: Every AI decision logged with input/output
- **Citations DB**: Trace which chunks influenced each answer
- **Debugging**: See retrieval quality over time
- **Compliance**: Full audit trail for regulatory review

### 2️⃣ Real Citations
- **Precision**: Exact page + bbox instead of "page 1-3"
- **PDF Overlay**: Ready for highlight drawing
- **Evidence Viewer**: Shows OCR span metadata
- **Future-proof**: Wire to real PDF viewer when ready

### 3️⃣ Memo Generator
- **Product Feature**: Underwriters generate sections on-demand
- **Saved Drafts**: Persist for revision/approval workflow
- **Same Quality**: Reuses proven retrieval+rerank pipeline
- **Citations**: Every statement backed by evidence

### 4️⃣ Bank Policies
- **Second Brain**: Policies become queryable knowledge base
- **Blended Mode**: Compare deal vs policy in single query
- **Compliance**: "Does this deal comply?" answered with evidence
- **Scalable**: Each bank has isolated policy store

---

## Future Enhancements

### Short-term
- [ ] UI for browsing ai_events (audit log viewer)
- [ ] PDF overlay with bbox highlights (use existing PdfEvidenceSpansViewer)
- [ ] Memo export to PDF with citations
- [ ] Policy management UI (upload/chunk/embed policies)

### Medium-term
- [ ] Multi-turn conversations (store conversation_id in ai_events)
- [ ] Citation quality scoring (which chunks were actually useful?)
- [ ] Auto-suggest questions based on deal type
- [ ] Batch memo generation (all sections at once)

### Long-term
- [ ] Cross-deal retrieval ("similar deals that had this risk")
- [ ] Policy version control (track policy changes over time)
- [ ] Predictive analytics (which questions predict approval?)
- [ ] ML reranking (fine-tune on human feedback)

---

## Related Documentation
- **COMMITTEE_QA_COMPLETE.md** - Original Committee Q&A system
- **PACK_INTEGRATION_COMPLETE.md** - Document chunking strategy
- **CONDITIONS_README.md** - Deterministic underwriting rules
- **BUDDY_BUILD_RULES.md** - Coding conventions

---

**Production-ready traceability. Real citations. Memo generation. Policy integration.** 🚀

This upgrade transforms Committee Q&A from a demo feature into a production underwriting tool.
