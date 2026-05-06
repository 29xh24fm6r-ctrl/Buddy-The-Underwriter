# SPEC-01 — Text-Layer-First OCR Routing

**Owner:** Matt
**Author:** Claude (architectural review)
**Hand-off:** Claude Code
**Status:** Ready to build
**Estimated effort:** 1.5–2 days
**Depends on:** None (zero new deps; uses installed `pdf-parse@^2.4.5`)
**Blocks:** SPEC-03 (real table extractor), SPEC-05 (shadow measurement)

---

## PIV (Problem · Impact · Verdict)

### Problem
Every PDF in the Buddy pipeline goes to Gemini OCR via `runGeminiOcrJob` regardless of whether the file already has a clean, machine-readable text layer. `runOcrJob.ts` hard-throws if `USE_GEMINI_OCR !== "true"` and unconditionally calls Gemini. The router (`extractByDocType.ts`) calls `extractWithGeminiOcr` as Step 1 with no upstream branching.

The helper `src/lib/extraction/detectMachineReadabilitySignals.ts` exists but is **post-OCR** — it consumes `hasOcrText` and `ocrTextLength`, so it can only describe a doc *after* OCR has already run. It cannot be used to skip OCR. There is no pre-OCR text-layer probe today.

### Impact
- **Cost:** Banker-uploaded PDFs (tax returns from accounting software, bank-generated statements, lender-exported credit memos) are 60–80% of inbound volume and almost always have a clean text layer. We are paying Gemini OCR per page on documents whose text could have been extracted in milliseconds with `pdf-parse`. At ~$0.0025/page (router's own estimate) and tens of thousands of pages/month at scale, this is real money.
- **Latency:** Gemini OCR has a 120s per-attempt timeout. `pdf-parse` on a clean text-layer PDF returns in 50–500ms. Slow OCR is the single largest visible delay in the banker journey.
- **Quality:** Gemini OCR introduces transcription errors (digit confusion, decimal placement, line-ordering churn) on docs whose original text layer is byte-perfect. Downstream extractors then regex against degraded text. This is a measurable accuracy floor we can lift by skipping OCR on machine-readable docs.

### Verdict
Add a **pre-OCR text-layer probe** as the first step inside `extractByDocType`. When the probe says the PDF has a usable text layer, skip Gemini OCR entirely and feed the extracted text directly to downstream classification and structured assist. When the probe says scanned/image-only, run Gemini OCR as today. Persist the routing decision to `document_extracts.provider_metrics.text_extraction_method` and emit a ledger event for traceability.

This is a pure-additive change behind a feature flag. Worst case (flag off) → identical behavior to today.

---

## Scope

### In scope
1. **New module** `src/lib/extract/textLayer/probePdfTextLayer.ts` — pure async helper, takes file bytes, returns `{ usable: boolean; text: string | null; pageCount: number; reason: string; metrics: TextLayerMetrics }`.
2. **New module** `src/lib/extract/textLayer/scoreTextLayer.ts` — pure function, takes `TextLayerMetrics`, returns `{ usable: boolean; score: number; reasons: string[] }`. CI-locked thresholds.
3. **Wire into `extractByDocType.ts`** as Step 0.5 (after dedup cache miss, before `extractWithGeminiOcr`). Behind feature flag `TEXT_LAYER_FIRST_ENABLED` (default off until rollout SLO met).
4. **Persist** `text_extraction_method` to `document_extracts.provider_metrics`. Values: `text_layer | ocr_gemini | text_layer_then_ocr_fallback`.
5. **Ledger event** `extract.text_layer.probe` with `usable`, `score`, `reasons`, `pageCount`, `latencyMs`.
6. **Aegis finding** `TEXT_LAYER_REJECTED_HIGH_CONFIDENCE` when probe rejects with high confidence on a doc that downstream Gemini OCR returns substantially more text from (>2× ratio) — sign