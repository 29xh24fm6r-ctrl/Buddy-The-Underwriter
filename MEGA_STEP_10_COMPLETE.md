# MEGA STEP 10: Automated Condition Reconciliation Engine ✅

**Status**: Complete  
**Date**: December 18, 2024  
**Files Created**: 4 (1 engine + 2 integrations + 1 endpoint)

## Overview

Automatically mark conditions as satisfied when matching documents are uploaded and processed via OCR/classify. **Zero manual intervention** - conditions reconcile in real-time as documents flow through the pipeline.

## Architecture Philosophy

**Self-Healing System**:
- **Upload → OCR → Classify → Reconcile** (fully automated)
- Rules engine matches doc_type to condition_type
- Evidence appends to condition audit trail
- Draft requests cancel automatically (no need to ask for uploaded docs)
- Next Best Action recomputes (priority shifts dynamically)

## Core Engine

### File: `src/lib/conditions/reconcileConditions.ts`

**Function**: `reconcileConditionsFromOcrResult()`

**Parameters**:
```typescript
{
  sb: SupabaseAdmin,          // Supabase client (any type)
  dealId: string,             // deals.id
  jobId: string,              // document_jobs.id
  payload: {                  // OCR/classify result
    classification?: {
      doc_type: string,       // "BANK_STATEMENT", "TAX_RETURN", etc.
      confidence: number,     // 0.0-1.0
      reasons?: string[]      // ["found account numbers", ...]
    },
    file_id?: string,
    stored_name?: string,
    ...                       // Any additional OCR metadata
  },
  source: "ocr" | "classify"  // Job type
}
```

**Returns**: `{ matched: number, satisfied: number }`

**Flow**:
1. Extract `doc_type` + `confidence` from payload (normalize to UPPERCASE)
2. Query `condition_match_rules` WHERE `enabled=true` AND `doc_type=X` ORDER BY `priority ASC`
3. Filter rules by confidence threshold (confidence >= min_confidence)
4. If no matching rules, recompute Next Action and return
5. Query `conditions_to_close` for deal (all conditions)
6. Group conditions by `condition_type` (for fast lookup)
7. For each applicable rule:
   - Find unsatisfied conditions matching `rule.condition_key`
   - Mark as satisfied with evidence
   - Append evidence entry: `{ source, job_id, doc_type, confidence, reasons, file_id, happened_at }`
8. If any conditions satisfied, cancel unsent draft messages (via `cancelUnsentDrafts()`)
9. Recompute Next Best Action (via `recomputeNextAction()`)
10. Return count of matched rules + satisfied conditions

## Integration Points

### 1. OCR Processor
**File**: `src/lib/jobs/processors/ocrProcessor.ts`

**Wired After**: OCR result stored in `document_ocr_results`  
**Wired Before**: Job marked `SUCCEEDED`

```typescript
// MEGA STEP 10: Reconcile conditions (auto-satisfy matching conditions)
try {
  const sb = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
  
  await reconcileConditionsFromOcrResult({
    sb,
    dealId: job.deal_id,
    jobId: jobId,
    payload: {
      file_id: attachment.id,
      stored_name: attachment.stored_name,
      extracted_text: extractedText,
      ...rawData,
    },
    source: "ocr",
  });
} catch (reconErr) {
  // Non-fatal - log but don't fail job
  console.error("Condition reconciliation failed (non-fatal):", reconErr);
}
```

**Error Handling**: Non-fatal (logs error, doesn't fail job)  
**Impact**: If reconciliation fails, condition will reconcile on next classify job

### 2. Classify Processor
**File**: `src/lib/jobs/processors/classifyProcessor.ts`

**Wired After**: Classification stored in `document_classifications`  
**Wired Before**: Job marked `SUCCEEDED`

```typescript
// MEGA STEP 10: Reconcile conditions (auto-satisfy matching conditions)
try {
  const sb = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
  
  await reconcileConditionsFromOcrResult({
    sb,
    dealId: job.deal_id,
    jobId: jobId,
    payload: {
      classification: {
        doc_type: classifyResult.doc_type,
        confidence: classifyResult.confidence,
        reasons: classifyResult.reasons,
      },
      file_id: job.attachment_id,
    },
    source: "classify",
  });
} catch (reconErr) {
  // Non-fatal - log but don't fail job
  console.error("Condition reconciliation failed (non-fatal):", reconErr);
}
```

**Error Handling**: Non-fatal (logs error, doesn't fail job)  
**Preference**: Classify integration is primary (more accurate doc_type)

### 3. Manual Reconcile Endpoint
**File**: `src/app/api/deals/[dealId]/conditions/reconcile/route.ts`

**Endpoint**: `POST /api/deals/{dealId}/conditions/reconcile`

**Purpose**: Testing + debugging + live demos

**Request Body**:
```json
{
  "doc_type": "BANK_STATEMENT",
  "confidence": 0.95,
  "reasons": ["found account numbers", "detected monthly transactions"]
}
```

**Response**:
```json
{
  "ok": true,
  "matched": 2,
  "satisfied": 1,
  "message": "Matched 2 rule(s), satisfied 1 condition(s)"
}
```

**Security**: Requires underwriter access (via `requireUnderwriterOnDeal()`)

**Use Cases**:
- Test condition match rules without uploading files
- Debug why conditions aren't auto-satisfying
- Demo auto-reconciliation in sales calls
- Trigger manual reconciliation after rule changes

## Helper Functions

### `cancelUnsentDrafts()`
**Purpose**: Cancel pending draft messages when conditions auto-satisfy

**Logic**:
```sql
UPDATE deal_message_drafts
SET status = 'canceled', updated_at = now()
WHERE deal_id = $1
  AND status IN ('draft', 'pending_approval')
```

**Why**: Prevents sending "missing doc" requests for already-uploaded documents  
**Impact**: User experience improvement (no stale notifications)

### `recomputeNextAction()`
**Purpose**: Update `deals.next_action_json` based on remaining conditions

**Logic**:
1. Count unsatisfied conditions for deal
2. If remaining > 0: `{ kind: "REQUEST_MISSING_DOCS", title: "Request missing documents", evidence: ["X open"] }`
3. If remaining = 0: `{ kind: "UNDERWRITER_REVIEW", title: "Send for underwriting review", evidence: ["All satisfied"] }`

**Why**: Next Best Action UI shows current priority (shifts dynamically)  
**Impact**: Underwriter always sees correct next step

## Database Schema Requirements

### Table: `condition_match_rules`
**Must exist with**:
```sql
CREATE TABLE condition_match_rules (
  id UUID PRIMARY KEY,
  condition_key TEXT NOT NULL,        -- matches conditions_to_close.condition_type
  doc_type TEXT NOT NULL,             -- "BANK_STATEMENT", "TAX_RETURN", etc.
  min_confidence NUMERIC DEFAULT 0.7, -- threshold (0.0-1.0)
  enabled BOOLEAN DEFAULT true,
  priority INTEGER DEFAULT 100,       -- lower = higher priority
  matcher JSONB,                      -- future: advanced matching logic
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_condition_match_rules_doc_type ON condition_match_rules(doc_type) WHERE enabled = true;
```

**Example Rules**:
```sql
INSERT INTO condition_match_rules (condition_key, doc_type, min_confidence, priority) VALUES
  ('BANK_STATEMENTS_6MO', 'BANK_STATEMENT', 0.7, 10),
  ('TAX_RETURNS_3YR', 'TAX_RETURN', 0.8, 20),
  ('PERSONAL_FINANCIAL_STATEMENT', 'PFS', 0.75, 30),
  ('BUSINESS_FINANCIAL_STATEMENTS', 'FINANCIAL_STATEMENT', 0.7, 40);
```

### Table: `conditions_to_close`
**Must have fields**:
```sql
CREATE TABLE conditions_to_close (
  id UUID PRIMARY KEY,
  deal_id UUID REFERENCES deals(id),
  condition_type TEXT,               -- matches condition_match_rules.condition_key
  satisfied BOOLEAN DEFAULT false,
  satisfied_at TIMESTAMPTZ,
  satisfied_by TEXT,                 -- "auto:ocr" or user_id
  evidence JSONB DEFAULT '[]'::jsonb, -- evidence array
  updated_at TIMESTAMPTZ DEFAULT now()
);
```

**Evidence Array Format**:
```json
[
  {
    "source": "classify",
    "job_id": "550e8400-e29b-41d4-a716-446655440000",
    "doc_type": "BANK_STATEMENT",
    "confidence": 0.95,
    "reasons": ["found account numbers", "detected monthly transactions"],
    "file_id": "abc123",
    "stored_name": "chase_oct_2024.pdf",
    "happened_at": "2024-12-18T10:30:00Z"
  },
  ...
]
```

### Table: `deal_message_drafts` (optional)
**If exists, reconciliation cancels pending drafts**:
```sql
CREATE TABLE deal_message_drafts (
  id UUID PRIMARY KEY,
  deal_id UUID REFERENCES deals(id),
  status TEXT, -- 'draft', 'pending_approval', 'sent', 'canceled'
  ...
);
```

### Table: `deals` (optional)
**If `next_action_json` column exists, reconciliation updates it**:
```sql
ALTER TABLE deals ADD COLUMN next_action_json JSONB;
```

## Reconciliation Examples

### Example 1: Bank Statement Upload
**Flow**:
1. Borrower uploads `chase_oct_2024.pdf`
2. OCR extracts text (job_type='OCR')
3. Classify identifies doc_type='BANK_STATEMENT', confidence=0.95
4. Reconciliation engine:
   - Queries `condition_match_rules` WHERE `doc_type='BANK_STATEMENT'` AND `enabled=true`
   - Finds rule: `{ condition_key: 'BANK_STATEMENTS_6MO', min_confidence: 0.7 }`
   - 0.95 >= 0.7 → rule applicable
   - Queries `conditions_to_close` WHERE `condition_type='BANK_STATEMENTS_6MO'` AND `satisfied=false`
   - Finds condition: `{ id: '...', satisfied: false }`
   - Marks satisfied:
     ```sql
     UPDATE conditions_to_close
     SET satisfied = true,
         satisfied_at = now(),
         satisfied_by = 'auto:ocr',
         evidence = evidence || '[{"source":"classify",...}]'
     WHERE id = '...'
     ```
5. Cancels pending draft messages (borrower won't get stale "missing bank statement" request)
6. Recomputes Next Best Action (shifts from "Request bank statements" to next priority)

**Result**: Condition automatically satisfied, Next Action updated, borrower experience seamless

### Example 2: Tax Return (Multiple Years)
**Flow**:
1. Borrower uploads `2022_tax_return.pdf`, `2023_tax_return.pdf`, `2024_tax_return.pdf`
2. Each classified as doc_type='TAX_RETURN', confidence=0.9
3. Condition: `TAX_RETURNS_3YR` (requires 3 years)
4. Reconciliation:
   - First upload satisfies condition (evidence array grows)
   - Second upload adds to evidence (already satisfied, no action)
   - Third upload adds to evidence
5. Underwriter reviews evidence array, sees 3 tax returns

**Note**: Current implementation marks condition satisfied on *first match*. Future enhancement: count-based matching (require N uploads before satisfaction).

### Example 3: Low Confidence (No Match)
**Flow**:
1. Borrower uploads blurry scan
2. Classify identifies doc_type='BANK_STATEMENT', confidence=0.4
3. Rule exists: min_confidence=0.7
4. 0.4 < 0.7 → rule not applicable
5. Reconciliation returns `{ matched: 0, satisfied: 0 }`
6. Condition remains unsatisfied (underwriter must manually review)

**Result**: Low confidence = no auto-satisfaction (prevents false positives)

## Configuration

### Setting Confidence Thresholds
**Recommendation**:
- **Bank Statements**: 0.7 (high variability in formats)
- **Tax Returns**: 0.8 (IRS forms are consistent)
- **PFS (SBA Form 413)**: 0.75 (structured form)
- **Leases**: 0.6 (high variability)

**Tuning**:
1. Monitor false positives (conditions satisfied incorrectly)
2. If too many false positives → increase `min_confidence`
3. If too many false negatives → decrease `min_confidence`
4. Track via analytics: `SELECT doc_type, AVG(confidence) FROM document_classifications WHERE ...`

### Priority Ordering
**Lower priority = matched first**

**Example**:
```sql
-- Specific matches first
(10, 'BANK_STATEMENTS_BUSINESS_6MO', 'BANK_STATEMENT')
(20, 'BANK_STATEMENTS_PERSONAL_2MO', 'BANK_STATEMENT')

-- Catch-all match last
(100, 'BANK_STATEMENTS_ANY', 'BANK_STATEMENT')
```

**Why**: Allows specific conditions to match before generic ones

## Monitoring & Analytics

### Reconciliation Success Rate
```sql
SELECT 
  source,
  COUNT(*) AS total_reconciliations,
  SUM(CASE WHEN satisfied > 0 THEN 1 ELSE 0 END) AS successful_reconciliations,
  SUM(CASE WHEN satisfied > 0 THEN 1 ELSE 0 END) * 100.0 / COUNT(*) AS success_rate_pct
FROM (
  SELECT 
    jsonb_array_elements(evidence)->>'source' AS source,
    COUNT(*) AS satisfied
  FROM conditions_to_close
  WHERE satisfied = true
  GROUP BY jsonb_array_elements(evidence)->>'source'
) AS reconciliation_events
GROUP BY source;
```

### Most Common Doc Types Matched
```sql
SELECT 
  jsonb_array_elements(evidence)->>'doc_type' AS doc_type,
  COUNT(*) AS match_count
FROM conditions_to_close
WHERE satisfied = true
  AND satisfied_by = 'auto:ocr'
GROUP BY doc_type
ORDER BY match_count DESC
LIMIT 10;
```

### Average Confidence by Doc Type
```sql
SELECT 
  jsonb_array_elements(evidence)->>'doc_type' AS doc_type,
  AVG((jsonb_array_elements(evidence)->>'confidence')::numeric) AS avg_confidence,
  MIN((jsonb_array_elements(evidence)->>'confidence')::numeric) AS min_confidence,
  MAX((jsonb_array_elements(evidence)->>'confidence')::numeric) AS max_confidence
FROM conditions_to_close
WHERE satisfied = true
GROUP BY doc_type;
```

### Conditions Satisfied per Deal
```sql
SELECT 
  d.id AS deal_id,
  d.name AS deal_name,
  COUNT(c.id) AS total_conditions,
  SUM(CASE WHEN c.satisfied THEN 1 ELSE 0 END) AS satisfied_count,
  SUM(CASE WHEN c.satisfied AND c.satisfied_by = 'auto:ocr' THEN 1 ELSE 0 END) AS auto_satisfied_count
FROM deals d
LEFT JOIN conditions_to_close c ON c.deal_id = d.id
GROUP BY d.id, d.name
ORDER BY auto_satisfied_count DESC;
```

## Error Handling

### Non-Fatal Errors
**Reconciliation failures are non-fatal** (logged, don't fail job)

**Why**:
- OCR job should succeed even if reconciliation fails
- Condition can reconcile on next classify job
- Prevents cascading failures

**Error Scenarios**:
1. `condition_match_rules` table doesn't exist → log error, return `{ matched: 0, satisfied: 0 }`
2. Network timeout querying Supabase → log error, job continues
3. Invalid payload format → log error, return early
4. UPDATE fails (optimistic locking) → log error, next job will retry

### Fatal Errors
**Only database connection failures are fatal**

**Handling**:
- Retry with exponential backoff (already in processor)
- Max 3 attempts → mark job FAILED
- Underwriter sees failed job in UI

## Testing

### Unit Test: Basic Reconciliation
```typescript
const result = await reconcileConditionsFromOcrResult({
  sb: mockSupabase,
  dealId: "deal-123",
  jobId: "job-456",
  payload: {
    classification: {
      doc_type: "BANK_STATEMENT",
      confidence: 0.95,
      reasons: ["found account numbers"],
    },
  },
  source: "classify",
});

expect(result.matched).toBe(1);
expect(result.satisfied).toBe(1);
```

### Integration Test: Full Pipeline
```typescript
// 1. Upload file
const upload = await uploadFile(dealId, "chase_oct.pdf");

// 2. Enqueue OCR
await enqueueOcrJob(dealId, upload.id);

// 3. Process OCR (mocked)
await processOcrJob(job.id, "test-worker");

// 4. Process classify (mocked)
await processClassifyJob(classifyJob.id, "test-worker");

// 5. Verify condition satisfied
const condition = await getCondition(dealId, "BANK_STATEMENTS_6MO");
expect(condition.satisfied).toBe(true);
expect(condition.satisfied_by).toBe("auto:ocr");
expect(condition.evidence).toHaveLength(1);
```

### Manual Test: Reconcile Endpoint
```bash
curl -X POST http://localhost:3000/api/deals/{dealId}/conditions/reconcile \
  -H "Content-Type: application/json" \
  -d '{
    "doc_type": "BANK_STATEMENT",
    "confidence": 0.95,
    "reasons": ["found account numbers"]
  }'
```

**Expected Response**:
```json
{
  "ok": true,
  "matched": 2,
  "satisfied": 1,
  "message": "Matched 2 rule(s), satisfied 1 condition(s)"
}
```

## Future Enhancements

### 1. Count-Based Matching
**Problem**: Tax returns need 3 years, but first upload satisfies condition

**Solution**:
```sql
ALTER TABLE condition_match_rules
ADD COLUMN required_count INTEGER DEFAULT 1;

-- Rule: TAX_RETURNS_3YR requires 3 matches
UPDATE condition_match_rules
SET required_count = 3
WHERE condition_key = 'TAX_RETURNS_3YR';
```

**Logic**: Only mark satisfied when `evidence.length >= required_count`

### 2. Date Range Matching
**Problem**: Bank statements need "last 6 months"

**Solution**:
```sql
ALTER TABLE condition_match_rules
ADD COLUMN matcher JSONB;

-- Rule: BANK_STATEMENTS_6MO requires dates within 6 months
UPDATE condition_match_rules
SET matcher = '{"date_range":{"months":6,"from":"statement_date"}}'::jsonb
WHERE condition_key = 'BANK_STATEMENTS_6MO';
```

**Logic**: Extract `statement_date` from OCR, verify within range

### 3. Multi-Document Conditions
**Problem**: "Business + Personal Tax Returns" are separate uploads

**Solution**:
```sql
ALTER TABLE condition_match_rules
ADD COLUMN sub_rules JSONB;

-- Rule: TAX_RETURNS_COMPLETE requires both business + personal
UPDATE condition_match_rules
SET sub_rules = '[
  {"doc_type":"TAX_RETURN_BUSINESS","required_count":3},
  {"doc_type":"TAX_RETURN_PERSONAL","required_count":2}
]'::jsonb
WHERE condition_key = 'TAX_RETURNS_COMPLETE';
```

**Logic**: All sub-rules must be satisfied before parent condition satisfied

### 4. Confidence Decay
**Problem**: Old OCR results may be less reliable

**Solution**: Reduce confidence for evidence older than X days
```typescript
const decayFactor = Math.max(0.5, 1 - (daysSinceUpload / 365));
const adjustedConfidence = originalConfidence * decayFactor;
```

### 5. Manual Override
**Problem**: Underwriter wants to un-satisfy auto-satisfied condition

**Solution**:
```sql
-- Add override flag
ALTER TABLE conditions_to_close
ADD COLUMN manual_override BOOLEAN DEFAULT false,
ADD COLUMN override_reason TEXT;

-- Respect manual overrides in reconciliation
WHERE satisfied = false OR manual_override = true
```

---

## Files Summary

**Created**:
1. `src/lib/conditions/reconcileConditions.ts` (200 lines) - Core engine
2. `src/lib/jobs/processors/ocrProcessor.ts` (updated) - OCR integration
3. `src/lib/jobs/processors/classifyProcessor.ts` (updated) - Classify integration
4. `src/app/api/deals/[dealId]/conditions/reconcile/route.ts` (90 lines) - Manual endpoint

**Total Impact**: ~290 lines of code

**Dependencies**:
- `@supabase/supabase-js` (already installed)
- `condition_match_rules` table (must exist)
- `conditions_to_close` table (must exist)

**Optional Tables**:
- `deal_message_drafts` (for draft cancellation)
- `deals.next_action_json` (for Next Action updates)

---

**MEGA STEP 10: COMPLETE** ✅  
**Self-healing conditions system active** 🔄  
**Zero manual intervention required** 🤖
