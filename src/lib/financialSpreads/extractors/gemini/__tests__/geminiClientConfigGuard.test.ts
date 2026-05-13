/**
 * SPEC-GEMINI-EXTRACTION-CONFIG-FIX-1 §3.3 — source-grep guard.
 *
 * Verifies geminiClient.ts configures Gemini 3 Flash with the explicit
 * controls needed to avoid silent empty-response failures on multi-page
 * tax-return PDFs: maxOutputTokens, thinkingConfig.thinkingLevel,
 * mediaResolution (PDF-gated), and finishReason capture on empty responses.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const FILE = resolve(
  process.cwd(),
  "src/lib/financialSpreads/extractors/gemini/geminiClient.ts",
);
const SRC = readFileSync(FILE, "utf8");

test("[gemini-3] geminiClient sets maxOutputTokens", () => {
  assert.match(SRC, /maxOutputTokens:\s*\d+/);
});

test("[gemini-4] geminiClient sets thinkingConfig.thinkingLevel for Gemini 3 models", () => {
  // Accept both object-literal (`thinkingConfig: { ... }`) and
  // property-assignment (`generationConfig.thinkingConfig = { ... }`) syntax —
  // the spec's §2.2 reference impl uses property assignment.
  assert.match(
    SRC,
    /thinkingConfig\s*[:=]\s*\{\s*thinkingLevel:\s*"(?:minimal|low|medium|high)"/,
  );
});

test("[gemini-5] geminiClient sets mediaResolution for PDF input", () => {
  // The mediaResolution assignment must be gated on args.pdfBase64.
  // Accept both object-literal colon (`mediaResolution: "..."`) and
  // property-assignment (`generationConfig.mediaResolution = "..."`) syntax —
  // the spec's risk register noted that source-grep tests must not reject
  // valid implementations that use a different but semantically equivalent
  // pattern. The spec's §2.2 reference impl uses property assignment.
  const region = SRC.slice(
    SRC.indexOf("isGemini3Model(GEMINI_MODEL)"),
    SRC.indexOf("isGemini3Model(GEMINI_MODEL)") + 800,
  );
  assert.match(region, /pdfBase64/);
  assert.match(region, /mediaResolution\s*[:=]\s*"MEDIA_RESOLUTION_HIGH"/);
});

test("[gemini-6] geminiClient captures finishReason on empty response", () => {
  // finishReason should be read from the candidate object
  assert.match(SRC, /finishReason[\s\S]{0,80}candidate\?\.finishReason/);
});

test("[gemini-7] geminiClient tags empty_response failureReason with finishReason suffix when present", () => {
  // The failureReason string should be `empty_response:${finishReason}` when finishReason exists
  assert.match(
    SRC,
    /finishReason[\s\S]{0,100}`empty_response:\$\{finishReason\}`/,
  );
});

test("[gemini-8] geminiClient does NOT change the model string", () => {
  // GEMINI_MODEL must still derive from MODEL_EXTRACTION (no hardcoded model string change)
  assert.match(SRC, /const\s+GEMINI_MODEL\s*=\s*MODEL_EXTRACTION/);
  // No hardcoded "gemini-3.1-flash-lite" or other model swap
  assert.doesNotMatch(SRC, /"gemini-3\.1-flash-lite"/);
});
