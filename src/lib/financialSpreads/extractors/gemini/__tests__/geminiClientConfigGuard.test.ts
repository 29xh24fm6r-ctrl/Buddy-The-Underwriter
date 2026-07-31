/**
 * SPEC-GEMINI-EXTRACTION-CONFIG-FIX-1 §3.3 — source-grep guard.
 *
 * Verifies geminiClient.ts configures Gemini 3 Flash with the explicit
 * controls needed to avoid silent empty-response failures on multi-page
 * tax-return PDFs: maxOutputTokens, thinkingLevel, mediaResolution
 * (PDF-gated), and finishReason capture on empty responses.
 *
 * SPEC-M1.1: geminiClient.ts now routes through the AI gateway
 * (runRole("generator", ...)) instead of constructing its own Vertex SDK
 * client — these fields are passed as flat RunRoleRequest properties
 * rather than nested inside a locally-built generationConfig object.
 * providers/google.ts (the gateway's Google provider adapter) is what
 * actually assembles thinkingConfig/mediaResolution into the real Gemini
 * request body now (see google.test.ts's own coverage of that).
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

test("[gemini-4] geminiClient sets thinkingLevel for Gemini 3 models", () => {
  assert.match(SRC, /thinkingLevel:\s*"(?:minimal|low|medium|high)"/);
});

test("[gemini-5] geminiClient sets mediaResolution for PDF input, gated on isGemini3Model + pdfBase64", () => {
  const region = SRC.slice(
    SRC.indexOf("mediaResolution:"),
    SRC.indexOf("mediaResolution:") + 200,
  );
  assert.match(region, /isGemini3Model\(GEMINI_MODEL\)/);
  assert.match(region, /args\.pdfBase64/);
  assert.match(region, /"MEDIA_RESOLUTION_HIGH"/);
});

test("[gemini-6] geminiClient captures finishReason on empty response", () => {
  // finishReason is now extracted from providers/google.ts's thrown
  // "empty response (finishReason: X)" error text, not read directly off
  // a candidate object.
  assert.match(SRC, /empty response\(\?: \\\(finishReason: /);
  assert.match(SRC, /finishReasonFromError\s*=\s*emptyMatch\[1\]/);
});

test("[gemini-7] geminiClient tags empty_response failureReason with finishReason suffix when present", () => {
  assert.match(
    SRC,
    /finishReasonFromError[\s\S]{0,100}`empty_response:\$\{finishReasonFromError\}`/,
  );
});

test("[gemini-8] geminiClient does NOT change the model string", () => {
  // GEMINI_MODEL must still derive from MODEL_EXTRACTION (no hardcoded model string change)
  assert.match(SRC, /const\s+GEMINI_MODEL\s*=\s*MODEL_EXTRACTION/);
  // No hardcoded "gemini-3.1-flash-lite" or other model swap
  assert.doesNotMatch(SRC, /"gemini-3\.1-flash-lite"/);
});

// SPEC-GEMINI-FLASH-LITE-MIGRATION-1 additions ──────────────────────────────

test("[gemini-9] geminiClient routes Vertex calls through the AI gateway with authMode: vertex", () => {
  // SPEC-M1.1: location resolution moved to providers/google.ts (the
  // gateway's own Google provider adapter) — this file no longer imports
  // getVertexLocation directly, it just requests Vertex auth per-call.
  assert.match(SRC, /authMode:\s*"vertex"/);
});

test("[gemini-10] geminiClient maxOutputTokens bumped to 16384", () => {
  assert.match(SRC, /maxOutputTokens:\s*16384/);
  // Must NOT still have the old 8192
  assert.doesNotMatch(SRC, /maxOutputTokens:\s*8192/);
});
