# AAR — Phase 84 T-02 — Document classifier output truncation

**Date:** 2026-04-20
**Ticket:** T-02 (Wave 1 — Stop the bleeding)
**Scope:** Diagnose + fix `DOC_GATEKEEPER_CLASSIFY_FAILED` events mislabeled as `NO_OCR_OR_IMAGE`
**Commits (chronological):**
- `a52538fd` — observability on 8 classifier null-return exit points
- `7f260337` — fix: maxOutputTokens 512→2048 + thinkingLevel=low + success-path finishReason warn
- `be2bef43` — add diagnostic scripts to repo (reclassify-probe + preload-shim)
- `404a25b2` — migration: add `PERSONAL_FINANCIAL_STATEMENT` to `gatekeeper_doc_type` CHECK
- `e68c9aa8` — fix `stampDocument` silent-write on constraint violations
- `e473a506` — update spec T-02 section with actual root cause

Completion event: `buddy_system_events` (pending — written after this AAR lands).

---

## 1. Investigation trail

Initial v1 audit theory: classifier failing because `USE_GEMINI_OCR=false` or Gemini API key missing. Every failed event carried `reasons: ["Gemini classifier returned null on text path"]` and `review_reason_code: NO_OCR_OR_IMAGE`. Naive reading: "OCR isn't reaching the classifier."

Pre-work showed this was wrong. Document `15b77208-ae2c-4c20-8d48-af500dd996dd` (Ellmann PTR 2023) had `document_ocr_results.extracted_text IS NOT NULL` with `length = 23,886`, and the row was stamped UNKNOWN / NO_OCR_OR_IMAGE on 2026-04-15. OCR was present; the label lied about it.

The classifier had four null-return exit points (missing key, non-ok HTTP, parseGeminiResult null, thrown exception) with zero observability. Any of them produced the same user-facing label. First commit (`a52538fd`) added `console.warn` at each of the eight exit points across text + vision paths, plus `rawTextPreview` so we could see what the model actually returned.

End-to-end reclassify probe against production (`scripts/phase-84-t02-reclassify-probe.ts`, run with server-only shim) immediately surfaced the real cause:

```
[GeminiClassifier][text] parseGeminiResult returned null {
  finishReason: 'MAX_TOKENS',
  rawTextPreview: '{
    "doc_type": "PERSONAL_TAX_RETURN",
    "confidence": 1.0,
    "tax_year": 2023,
    "reasons": [
      "Form 1040 U.S. Individual Income Tax Return is clearly visible",
      "Includes Schedule A (Itemized Deductions) and Schedule D (Capital Gains and Losses)",
      "Taxpayer names are individuals (Kevin T & Martina D Ellmann)"
    ],',
  ocrTextLength: 23886
}
```

Gemini had classified the doc correctly. The response truncated mid-JSON at the end of the `reasons` array, before `detected_signals` and the closing `}`. `JSON.parse` threw → `parseGeminiResult` returned null → upstream mislabeled as NO_OCR_OR_IMAGE.

---

## 2. Root cause (three bugs compounding)

### Bug A — Output-token truncation (primary)

`classifyWithGeminiText` and `classifyWithGeminiVision` set `generationConfig.maxOutputTokens: 512`. Verified this number was inherited directly from the Phase 24 OpenAI classifier (`src/lib/gatekeeper/classifyWithOpenAI.ts:197` and `:248`, same value, two sites). OpenAI tolerated 512 because `zodResponseFormat` enforces schema server-side — the response is guaranteed to fit. Gemini returns raw JSON text; any cap-induced truncation breaks `JSON.parse` and the classifier silently returns null.

### Bug B — Silent-write swallowing (why Bug C was invisible)

`stampDocument` in `runGatekeeper.ts` awaited `.update()` without destructuring the `{ error }` property of the Supabase response. Supabase JS returns CHECK constraint violations, RLS blocks, and permission errors in-band on the response object — **`.update()` does not throw**. The `try/catch` therefore only caught network-level errors. Any row-level rejection was silently discarded, and the caller received a phantom "success." This was the root cause of Bug C being invisible for weeks.

### Bug C — Enum drift on `gatekeeper_doc_type` CHECK

`GatekeeperDocType` in `src/lib/gatekeeper/types.ts` lists 12 types including `PERSONAL_FINANCIAL_STATEMENT`. The DB CHECK constraint `deal_documents_gatekeeper_doc_type_check` had only 11 — missing PFS. Someone added PFS support in code without the accompanying migration. Every PFS classification was rejected at the DB, silently discarded by Bug B, and left the doc stamped with its prior state.

---

## 3. Deterministic, not transient

v2 spec outcome #1 asserted "44 April 15 failures were transient." This was wrong, and the revised spec (commit `e473a506`) reflects the correction.

Evidence the bug was deterministic:
- 89 distinct failed docs spanned **2026-04-01 15:57** through **2026-04-15 22:10** — not a single burst.
- All 85 failures re-run through the fixed classifier resolved to non-UNKNOWN types; the remaining 4 are legitimate `UNKNOWN_DOC_TYPE` (model genuinely uncertain), not the broken `NO_OCR_OR_IMAGE` path.
- The Apr 15 burst was a big batch upload of long/complex docs whose classification responses exceeded 512 tokens. Quiet days between bursts had only short docs whose responses fit. The failure rate tracked response length, not time.

Upload behavior, not Gemini uptime, determined the failure distribution.

---

## 4. Fix

### Observability (commit `a52538fd`)

8 `console.warn` sites added across `classifyWithGeminiText` + `classifyWithGeminiVision`:
- Missing `GEMINI_API_KEY`
- Non-ok HTTP response (with `status`, `statusText`, `bodyPreview`, `model`)
- `parseGeminiResult` returns null (with `finishReason`, `rawTextPreview`, `ocrTextLength`)
- Thrown exception (with `error.name`, `error.message`)

Plus a success-path `finishReason !== "STOP"` warning so future `MAX_TOKENS` / `SAFETY` / `RECITATION` surfaces surface even when the truncated JSON happens to parse.

### Token + thinking cap (commit `7f260337`)

```typescript
generationConfig: {
  responseMimeType: "application/json",
  temperature: 0.0,
  maxOutputTokens: 2048,            // was 512
  thinkingConfig: { thinkingLevel: "low" },
},
```

2048 gives ~4× headroom for expected classification responses. `thinkingLevel: "low"` caps Gemini 3's reasoning tokens (which count against output budget) for strict-schema tasks. Applied to both text and vision paths.

### Schema migration (commit `404a25b2`)

```sql
ALTER TABLE public.deal_documents
  DROP CONSTRAINT IF EXISTS deal_documents_gatekeeper_doc_type_check;
ALTER TABLE public.deal_documents
  ADD CONSTRAINT deal_documents_gatekeeper_doc_type_check
  CHECK (gatekeeper_doc_type IS NULL OR gatekeeper_doc_type = ANY (ARRAY[
    'BUSINESS_TAX_RETURN','PERSONAL_TAX_RETURN','W2','FORM_1099','K1',
    'BANK_STATEMENT','FINANCIAL_STATEMENT','PERSONAL_FINANCIAL_STATEMENT',
    'DRIVERS_LICENSE','VOIDED_CHECK','OTHER','UNKNOWN'
  ]));
```

### stampDocument error handling (commit `e68c9aa8`)

```typescript
const { error } = await (sb as any).from("deal_documents").update({...}).eq("id", input.documentId);
if (error) {
  console.error("[Gatekeeper] stampDocument write failed", {
    documentId: input.documentId, docType: result.doc_type,
    errorCode: error.code, errorMessage: error.message, errorHint: error.hint,
  });
  throw new Error(`stampDocument failed for ${input.documentId}: ${error.code} ${error.message}`);
}
```

Re-throws in the outer catch so `runGatekeeperForDocument`'s fail-closed path (line ~271) catches and converts to NEEDS_REVIEW. The three existing `.catch(() => {})` call sites for fail-path stamps remain — they intentionally swallow double-failure at the boundary, which is correct for UNKNOWN stamping.

---

## 5. Verification (verbatim)

### Probe against original failed doc (post-fix)

```json
{
  "doc_type": "PERSONAL_TAX_RETURN",
  "confidence": 1,
  "tax_year": 2023,
  "reasons": ["Form 1040 U.S. Individual Income Tax Return clearly visible", ...],
  "detected_signals": {"form_numbers": ["1040","1040-V","Schedule A","Schedule 3","Schedule D"], "has_ein": false, "has_ssn": true},
  "model": "gemini-3-flash-preview",
  "route": "GOOGLE_DOC_AI_CORE",
  "needs_review": false,
  "reviewReasonCode": null,
  "input_path": "text",
  "latency_ms": 1962
}
```

No observability warnings fired. Latency 1962ms (down from 3906ms pre-fix where the failure path incurred additional overhead).

### Batch re-run summary (final)

```
BUSINESS_TAX_RETURN: 32
PERSONAL_TAX_RETURN: 22
FINANCIAL_STATEMENT: 14
PERSONAL_FINANCIAL_STATEMENT: 9
OTHER: 8
UNKNOWN: 4
```

Total resolved: 85 / 89 ever-failed docs = **95.5% resolution**. Remaining 4 UNKNOWNs all have `reviewReasonCode: UNKNOWN_DOC_TYPE` (legitimate — classifier ran, model said UNKNOWN) rather than the broken `NO_OCR_OR_IMAGE` label.

### Originally-failed docs final state (verbatim)

```sql
WITH failed_docs AS (
  SELECT DISTINCT payload->'input'->>'document_id' as doc_id
  FROM deal_events WHERE kind = 'DOC_GATEKEEPER_CLASSIFY_FAILED'
)
SELECT COUNT(*) FILTER (WHERE dd.gatekeeper_doc_type = 'UNKNOWN') as still_unknown,
       COUNT(*) FILTER (WHERE dd.gatekeeper_doc_type = 'PERSONAL_FINANCIAL_STATEMENT') as pfs_resolved,
       COUNT(*) FILTER (WHERE dd.gatekeeper_doc_type NOT IN ('UNKNOWN') AND dd.gatekeeper_doc_type IS NOT NULL) as total_resolved,
       COUNT(*) as total_ever_failed
FROM failed_docs fd LEFT JOIN deal_documents dd ON dd.id::text = fd.doc_id;
```

Result:
```
still_unknown:      4
pfs_resolved:       9
total_resolved:    85
total_ever_failed: 89
```

### Event delta

In the 15 minutes following the batch re-run: 89 `DOC_GATEKEEPER_CLASSIFIED`, 4 `DOC_ROUTED_TO_REVIEW` (the legit UNKNOWNs), 31 `DOC_ROUTED_TO_STANDARD`, 54 `DOC_ROUTED_TO_GOOGLE_DOCAI`, **0 `DOC_GATEKEEPER_CLASSIFY_FAILED`** — the "< 5% of attempts" acceptance criterion is satisfied at 0%.

---

## 6. Spec deviations

1. **v1 root-cause theory was wrong.** v1 said the cause was missing `USE_GEMINI_OCR` or OCR absent. Pre-work confirmed OCR was present (23,886 chars on the canary doc); the label `NO_OCR_OR_IMAGE` was a misleading fallback stamp from the classifier null-return path. Actual cause: `maxOutputTokens: 512` truncation. Spec commit `e473a506` corrects this.
2. **v2 playbook outcome #1 ("44 failures were transient") was wrong.** The bug was deterministic — triggered whenever the classification response exceeded 512 tokens. Scope grew from the 44-doc Apr 15 burst to 89 distinct docs spanning Apr 1 → Apr 20. Spec correction in `e473a506`.
3. **Scope expanded in-flight to Bug B (silent-write) and Bug C (CHECK drift).** Only discoverable by actually running the batch reclassify — 9 `PERSONAL_FINANCIAL_STATEMENT` classifications reported as "success" by the batch but absent from the DB afterward. Migrations + code fixes added as commits `404a25b2` and `e68c9aa8`. Kept in T-02 scope because the 9 PFS docs could not be resolved without them; leaving the silent-write shape in place would mask every future similar drift.
4. **v1 `src/lib/classification/` path was wrong.** The real classifier lives in `src/lib/gatekeeper/`. Spec correction in `e473a506` references the correct path.
5. **Acceptance criterion #2 ("DOC_GATEKEEPER_CLASSIFY_FAILED drops to < 5% over 24h") requires live traffic to validate.** Substituted offline equivalent: batch reclassify of every ever-failed doc resolves ≥ 95% to non-UNKNOWN types, and the 15 minutes post-batch had 0 new `DOC_GATEKEEPER_CLASSIFY_FAILED` events. Live-traffic criterion still formally valid; simply not measurable within T-02's window.

---

## 7. Phase 84.1 follow-ups

1. **Audit all other `gatekeeper_*` and `canonical_*` CHECK constraints vs code enums.** Verified during T-02: `gatekeeper_route` matches code, `gatekeeper_confidence` is a numeric range. But `canonical_type`, `routing_class`, `spine_tier`, and other columns on `deal_documents` and elsewhere may have similar drift. Grep all CHECK constraints on tables with enum-like columns and cross-reference the TypeScript types.
2. **Audit all other `sb.from(...).update(...)` / `.insert(...)` / `.delete(...)` call sites for the in-band-error swallowing pattern.** Grep for `sb.from(.*)\.update(` and look for sites that don't destructure `{ error }`. Same shape bug as Bug B — any constraint violation or RLS block at those sites is currently invisible.
3. **Delete `classifyWithOpenAI.ts`.** Marked for removal 30 days after Phase 24 shipped. Contains the same `max_tokens: 512` pattern twice (lines 197, 248); dormant since Phase 24 switched primary to Gemini but is the original source of Bug A.
4. **Monitor `[GeminiClassifier] unexpected finishReason on success path` warnings over 7 days.** If any fire with `MAX_TOKENS`, bump the cap to 4096. This is the forward-looking surface that catches future schema growth (e.g., if the prompt ever asks for more `reasons`).
5. **Consider adding `PERSONAL_FINANCIAL_STATEMENT` to `gatekeeper_route` resolution + downstream extractors if not already supported.** PFS docs now route correctly at the gatekeeper layer but downstream spread extraction may have similar drift.

---

## Next

T-10 Part B (test-data flagging — `is_test` column on `deals`) is next per the phase execution order, followed by the T-04/T-05/T-06 parallel wave.
