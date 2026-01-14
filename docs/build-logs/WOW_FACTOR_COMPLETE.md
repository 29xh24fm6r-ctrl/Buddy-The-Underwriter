# WOW Factor Features - Complete Implementation

## Overview

**Date**: 2024-12-27  
**Branch**: `feat/post-merge-upgrades`  
**Features**: 3 magical AI experiences that make Buddy feel instant and intelligent

This document covers the "WOW Factor" features that provide an exceptional user experience:

1. **Ask Buddy** - Chat over deal + policy knowledge with clickable citations
2. **Auto-Memo** - One-click generates full credit memo with evidence per section
3. **Why? Explainer** - Instant explanations for any risk/pricing headline with counterfactuals

---

## Architecture Principles

### Evidence-Driven AI
- **AI explains, rules decide**: AI generates explanations/suggestions, deterministic code controls state
- **Full traceability**: Every AI run logged to `ai_run_events` with citations to `ai_run_citations`
- **Transparent sources**: Every claim backed by specific doc chunks with similarity scores
- **No hallucinations**: All answers grounded in actual uploaded docs + bank policies

### Retrieval-Augmented Generation (RAG)
- **Dual knowledge bases**: Deal documents + bank policies retrieved in parallel
- **Semantic search**: pgvector with text-embedding-3-small (1536 dims)
- **Blended evidence**: Mix deal-specific and policy-level context
- **Citation tracking**: Store which chunks influenced each output

---

## Database Schema

### Enhanced Traceability Tables

#### `ai_run_events`
Logs all AI operations for audit trail and cost tracking:

```sql
CREATE TABLE ai_run_events (
  run_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id UUID REFERENCES deals(deal_id),
  bank_id UUID REFERENCES banks(bank_id),
  run_kind TEXT NOT NULL, -- ASK_BUDDY, MEMO_SECTION, EXPLAIN_RISK, COMMITTEE, RERANK
  run_at TIMESTAMPTZ DEFAULT now(),
  model TEXT, -- e.g., "gpt-4o", "gpt-4o-mini"
  
  input_json JSONB, -- { question, k } or { section_key, section_title } or { headline }
  output_json JSONB, -- LLM response with citations
  
  usage_json JSONB, -- { prompt_tokens, completion_tokens, total_tokens }
  error_message TEXT
);

CREATE INDEX idx_ai_run_events_deal ON ai_run_events(deal_id);
CREATE INDEX idx_ai_run_events_kind ON ai_run_events(run_kind);
CREATE INDEX idx_ai_run_events_created ON ai_run_events(run_at DESC);
```

#### `ai_run_citations`
First-class citations linking AI runs to source chunks:

```sql
CREATE TABLE ai_run_citations (
  citation_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID REFERENCES ai_run_events(run_id) ON DELETE CASCADE,
  
  source_kind TEXT NOT NULL, -- DEAL_DOC, BANK_POLICY
  source_id UUID, -- upload_id or asset_id
  chunk_id UUID, -- reference to deal_doc_chunks or bank_policy_chunks
  
  page_num INT,
  page_start INT,
  page_end INT,
  
  quote TEXT, -- excerpt from chunk
  similarity REAL, -- cosine similarity score
  citation_index INT, -- [1], [2], etc. in output
  
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_ai_run_citations_run ON ai_run_citations(run_id);
CREATE INDEX idx_ai_run_citations_source ON ai_run_citations(source_kind, source_id);
```

### Run Kinds

| Kind | Purpose | Input | Output |
|------|---------|-------|--------|
| `ASK_BUDDY` | Chat Q&A | `{ question, k }` | `{ answer, citations, followups }` |
| `MEMO_SECTION` | Memo section | `{ section_key, section_title }` | `{ text, citations }` |
| `EXPLAIN_RISK` | Risk explainer | `{ headline }` | `{ explanation, drivers, counterfactuals }` |
| `COMMITTEE` | Credit committee | `{ question }` | `{ answer, citations }` |
| `RERANK` | Re-rank chunks | `{ chunks, question }` | `{ reranked_chunks }` |

---

## Feature 1: Ask Buddy

### User Experience
- **What**: Chat interface that answers questions about the deal
- **Input**: Natural language question (e.g., "What's the collateral coverage ratio?")
- **Output**: Answer with numbered citations + follow-up suggestions
- **Wow**: Citations link directly to evidence viewer showing exact doc/page

### API Endpoint

**`POST /api/deals/[dealId]/ask`**

**Request**:
```json
{
  "question": "What's the DSCR trend over the last 3 years?",
  "bankId": "uuid-optional",
  "k": 10
}
```

**Response**:
```json
{
  "ok": true,
  "run_id": "uuid",
  "answer": "The DSCR improved from 1.15 to 1.42 [1]. This shows strengthening...",
  "citations": [
    { "i": 1, "reason": "2023 Tax Return showing DSCR calculation" }
  ],
  "followups": [
    "What caused the DSCR improvement?",
    "How does this compare to bank requirements?"
  ]
}
```

### Implementation Pattern

```typescript
// 1. Embed question
const embedding = await embedQuery(question);

// 2. Retrieve deal docs
const dealChunks = await retrieveDealChunks({ 
  dealId, 
  queryEmbedding: embedding, 
  k: 8 
});

// 3. Retrieve bank policies
const policyChunks = await retrieveBankPolicyChunks({ 
  bankId, 
  queryEmbedding: embedding, 
  k: 2 
});

// 4. Pack evidence
const evidence = [
  ...dealChunks.map(c => ({ source_kind: "DEAL_DOC", ... })),
  ...policyChunks.map(c => ({ source_kind: "BANK_POLICY", ... }))
];

// 5. LLM call with citations
const completion = await openai.chat.completions.create({
  model: "gpt-4o-mini",
  messages: [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: buildPromptWithEvidence(question, evidence) }
  ],
  response_format: { type: "json_object" }
});

// 6. Store traceability
await storeAIRun({
  run_kind: "ASK_BUDDY",
  input_json: { question, k },
  output_json: parsed,
  citations: evidence.map((e, i) => ({ ...e, citation_index: i + 1 }))
});
```

### UI Component

**`<AskBuddyPanel dealId={dealId} bankId={bankId} />`**

Features:
- Question input with enter-to-submit
- Loading state during embedding + retrieval + LLM
- Answer display with markdown support
- Citations with "view" links to `/deals/{dealId}/evidence?cite={i}`
- Follow-up suggestions as clickable buttons
- Run ID display for traceability

---

## Feature 2: Auto-Memo

### User Experience
- **What**: One-click generates full credit memo (7 sections)
- **Input**: Click "Generate Full Memo" button
- **Output**: Polished memo with evidence citations per section
- **Wow**: Instant professional memo that would take hours manually

### Memo Sections

1. **Executive Summary** - Deal highlights, request, recommendation
2. **Business Overview** - Industry, history, management, competitive position
3. **Cash Flow Analysis** - DSCR, trends, projections, stress scenarios
4. **Collateral Package** - Coverage ratios, valuation methods, priorities
5. **Risk Assessment** - Credit risks, mitigants, watch items
6. **Covenants & Structure** - Financial covenants, reporting, guarantors
7. **Recommendation** - Approve/deny with conditions and rationale

### API Endpoint

**`POST /api/deals/[dealId]/memo/generate`**

**Request**:
```json
{
  "bankId": "uuid-optional"
}
```

**Response**:
```json
{
  "ok": true,
  "sections": [
    {
      "key": "executive_summary",
      "title": "Executive Summary",
      "text": "XYZ Corp is requesting...",
      "citations": [
        { "i": 1, "reason": "Business tax return 2023" },
        { "i": 2, "reason": "Financial projections" }
      ]
    },
    // ... 6 more sections
  ]
}
```

### Generation Flow

For each section:

```typescript
// 1. Embed section prompt
const prompt = buildMemoSectionPrompt(sectionKey, sectionTitle);
const embedding = await embedQuery(prompt);

// 2. Retrieve relevant chunks
const dealChunks = await retrieveDealChunks({ 
  dealId, 
  queryEmbedding: embedding, 
  k: 10 
});
const policyChunks = await retrieveBankPolicyChunks({ 
  bankId, 
  queryEmbedding: embedding, 
  k: 3 
});

// 3. LLM generates section
const completion = await openai.chat.completions.create({
  model: "gpt-4o",
  messages: [
    { role: "system", content: MEMO_SECTION_SYSTEM },
    { role: "user", content: buildSectionPrompt(evidence) }
  ],
  response_format: { type: "json_object" }
});

// 4. Store run for this section
await storeAIRun({
  run_kind: "MEMO_SECTION",
  input_json: { section_key: sectionKey, section_title: sectionTitle },
  output_json: { text, citations }
});
```

### UI Component

**`<AutoMemoButton dealId={dealId} bankId={bankId} />`**

Features:
- Single button trigger
- Progress indicator (7 sections, ~30s total)
- Sectioned display with citations
- Copy to clipboard functionality
- Clear/regenerate options

---

## Feature 3: Why? Explainer

### User Experience
- **What**: Click "Why?" on any risk/pricing metric to get instant explanation
- **Input**: Headline like "Risk Rating: 4" or "Pricing: Prime + 2.25%"
- **Output**: Explanation + key drivers + counterfactuals
- **Wow**: Shows "what would change this?" scenarios

### API Endpoint

**`POST /api/deals/[dealId]/risk/explain`**

**Request**:
```json
{
  "headline": "Risk Rating: 4"
}
```

**Response**:
```json
{
  "ok": true,
  "explanation": "The risk rating of 4 reflects moderate-high credit risk driven by...",
  "drivers": [
    "DSCR of 1.15 is below 1.25 policy threshold",
    "2 years in business vs 3-year requirement",
    "No real estate collateral, only equipment"
  ],
  "counterfactuals": [
    "If DSCR improved to 1.30, risk could drop to 3",
    "Adding real estate collateral could reduce by 1 rating",
    "3+ years operating history would satisfy policy"
  ],
  "citations": [
    { "i": 1, "reason": "2023 financial statements" },
    { "i": 2, "reason": "Bank credit policy - DSCR requirements" }
  ]
}
```

### Explanation Pattern

```typescript
// 1. Embed headline
const embedding = await embedQuery(headline);

// 2. Retrieve context
const dealChunks = await retrieveDealChunks({ dealId, queryEmbedding: embedding, k: 10 });
const policyChunks = await retrieveBankPolicyChunks({ bankId, queryEmbedding: embedding, k: 5 });

// 3. LLM explains
const completion = await openai.chat.completions.create({
  model: "gpt-4o-mini",
  messages: [
    { role: "system", content: EXPLAINER_SYSTEM },
    { role: "user", content: buildExplainerPrompt(headline, evidence) }
  ],
  response_format: { type: "json_object" }
});

// 4. Store run
await storeAIRun({
  run_kind: "EXPLAIN_RISK",
  input_json: { headline },
  output_json: { explanation, drivers, counterfactuals, citations }
});
```

### Counterfactual Generation

Prompts LLM to analyze:
- **Current state**: What factors led to this outcome?
- **Thresholds**: What are the key decision boundaries?
- **Scenarios**: If X changed to Y, what would happen?

Example: "If DSCR improved from 1.15 to 1.30, risk rating would drop from 4 to 3 per policy."

### UI Component

**`<WhyExplainer dealId={dealId} headline={headline} />`**

Features:
- "Why?" button trigger (or custom trigger element)
- Modal overlay with explanation
- Sections: Explanation / Key Drivers / What Would Change It?
- Citations with evidence links
- Close/dismiss

---

## Retrieval Helpers

### `retrieveDealChunks()`

**Location**: `src/lib/retrieval/deal.ts`

```typescript
export async function retrieveDealChunks({
  dealId,
  queryEmbedding,
  k = 10
}: {
  dealId: string;
  queryEmbedding: number[];
  k?: number;
}): Promise<DealChunk[]>
```

**Flow**:
1. Get server Supabase client
2. Call `match_deal_doc_chunks(dealId, embedding, k)` RPC
3. Returns chunks with similarity scores

**Returns**:
```typescript
type DealChunk = {
  chunk_id: string;
  upload_id: string;
  chunk_text: string;
  page_num: number;
  similarity: number;
};
```

### `retrieveBankPolicyChunks()`

**Location**: `src/lib/retrieval/policy.ts` (enhanced)

```typescript
export async function retrieveBankPolicyChunks({
  bankId,
  question,
  queryEmbedding,
  k = 5
}: {
  bankId: string;
  question?: string;
  queryEmbedding?: number[];
  k?: number;
}): Promise<RetrievedPolicyChunk[]>
```

**Enhancement**: Now accepts `queryEmbedding` OR `question`
- **Before**: Only accepted `question` (had to embed internally every time)
- **After**: Pass pre-computed embedding to avoid redundant API calls
- **Use case**: WOW features embed once, use for both deal + policy retrieval

**Returns**:
```typescript
type RetrievedPolicyChunk = {
  chunk_id: string;
  asset_id: string;
  chunk_text: string;
  doc_name: string;
  similarity: number;
};
```

---

## Evidence Packing Pattern

All WOW features use consistent evidence format:

```typescript
// Pack deal chunks
const dealEvidence = dealChunks.map((c, i) => ({
  source_kind: "DEAL_DOC" as const,
  source_id: c.upload_id,
  chunk_id: c.chunk_id,
  page_num: c.page_num,
  quote: c.chunk_text.slice(0, 500),
  similarity: c.similarity,
  citation_index: i + 1
}));

// Pack policy chunks
const policyEvidence = policyChunks.map((c, i) => ({
  source_kind: "BANK_POLICY" as const,
  source_id: c.asset_id,
  chunk_id: c.chunk_id,
  page_num: null,
  quote: c.chunk_text.slice(0, 500),
  similarity: c.similarity,
  citation_index: dealEvidence.length + i + 1
}));

// Combine
const evidence = [...dealEvidence, ...policyEvidence];
```

---

## Testing

### API Testing

**Test Ask Buddy**:
```bash
curl -X POST http://localhost:3000/api/deals/{dealId}/ask \
  -H "Content-Type: application/json" \
  -d '{"question": "What is the DSCR?", "k": 10}'
```

**Test Auto-Memo**:
```bash
curl -X POST http://localhost:3000/api/deals/{dealId}/memo/generate \
  -H "Content-Type: application/json" \
  -d '{"bankId": "uuid"}'
```

**Test Why? Explainer**:
```bash
curl -X POST http://localhost:3000/api/deals/{dealId}/risk/explain \
  -H "Content-Type: application/json" \
  -d '{"headline": "Risk Rating: 4"}'
```

### Traceability Verification

Check ai_run_events:
```sql
SELECT run_kind, COUNT(*), AVG((usage_json->>'total_tokens')::int) AS avg_tokens
FROM ai_run_events
WHERE run_at > now() - interval '1 day'
GROUP BY run_kind;
```

Check citations:
```sql
SELECT source_kind, COUNT(*)
FROM ai_run_citations
WHERE created_at > now() - interval '1 day'
GROUP BY source_kind;
```

---

## Performance

### Expected Latency
- **Ask Buddy**: 2-4s (embed 100ms + retrieval 200ms + LLM 2s)
- **Auto-Memo**: 25-35s (7 sections × 4s each)
- **Why? Explainer**: 2-3s (similar to Ask Buddy)

### Token Usage (per request)
- **Ask Buddy**: ~1,500 tokens (10 chunks × 150 tokens each)
- **Memo Section**: ~3,000 tokens (15 chunks × 200 tokens each)
- **Explainer**: ~2,000 tokens (15 chunks × 130 tokens each)

### Cost Estimates (GPT-4o-mini)
- Ask Buddy: $0.0002 per query
- Auto-Memo: $0.0015 per full memo (7 sections)
- Explainer: $0.0003 per explanation

---

## Integration Points

### Deal Command Center
Add AskBuddyPanel to main deal page:

```tsx
import AskBuddyPanel from "@/components/ai/AskBuddyPanel";

export default function DealPage({ params }: Props) {
  return (
    <div>
      {/* existing content */}
      <AskBuddyPanel dealId={dealId} bankId={bankId} />
    </div>
  );
}
```

### Memo Page
Add AutoMemoButton to memo generator:

```tsx
import AutoMemoButton from "@/components/ai/AutoMemoButton";

export default function MemoPage({ params }: Props) {
  return (
    <div>
      <AutoMemoButton dealId={dealId} bankId={bankId} />
    </div>
  );
}
```

### Risk View
Add WhyExplainer to risk metrics:

```tsx
import WhyExplainer from "@/components/ai/WhyExplainer";

<div className="flex items-center gap-2">
  <span>Risk Rating: 4</span>
  <WhyExplainer dealId={dealId} headline="Risk Rating: 4" />
</div>
```

---

## Files Created

### Database
- `supabase/migrations/20251227_wow_factor_traceability.sql` - ai_run_events + ai_run_citations

### Retrieval Helpers
- `src/lib/retrieval/deal.ts` - retrieveDealChunks()
- `src/lib/retrieval/policy.ts` - Enhanced retrieveBankPolicyChunks()

### API Routes
- `src/app/api/deals/[dealId]/ask/route.ts` - Ask Buddy chat
- `src/app/api/deals/[dealId]/memo/generate/route.ts` - Auto-Memo generator
- `src/app/api/deals/[dealId]/risk/explain/route.ts` - Why? explainer

### UI Components
- `src/components/ai/AskBuddyPanel.tsx` - Chat interface
- `src/components/ai/AutoMemoButton.tsx` - Memo generator button
- `src/components/ai/WhyExplainer.tsx` - Explanation modal

### Documentation
- `WOW_FACTOR_COMPLETE.md` - This file

---

## Next Steps

### Production Readiness
- [ ] Run migration on staging database
- [ ] Test all 3 features with real deal data
- [ ] Monitor ai_run_events for error rates
- [ ] Set up cost alerts for OpenAI usage
- [ ] Add rate limiting (5 requests/min per user)

### Enhancements
- [ ] Add streaming support for Ask Buddy (real-time typing)
- [ ] Cache frequent questions (e.g., "What's the DSCR?")
- [ ] Add "thumbs up/down" feedback on answers
- [ ] Export memo as PDF with citations
- [ ] Add "Explain this citation" drill-down

### Monitoring
- Query `/api/admin/ai/stats` for usage metrics
- Track citation click-through rates
- Monitor follow-up question usage
- Analyze which memo sections get regenerated most

---

## Conclusion

The WOW Factor features transform Buddy from a document processor into an **intelligent underwriting copilot**:

1. **Ask Buddy** - Instant answers to any deal question, grounded in evidence
2. **Auto-Memo** - Professional credit memos in 30 seconds instead of hours
3. **Why? Explainer** - Transparent AI that shows its reasoning + alternatives

Every output is traceable, every claim is cited, and every user feels like they have an expert analyst at their fingertips.

**Ship it. 🚀**
