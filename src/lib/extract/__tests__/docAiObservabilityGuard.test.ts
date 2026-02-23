/**
 * DocAI Observability Guard
 *
 * CI guards verifying that the extraction router emits proper observability
 * events when Document AI is unavailable or fails.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// ── Guard 1: extractByDocType emits extract.docai_unavailable event ──────────

test("Guard 1: extractByDocType contains extract.docai_unavailable event emission", () => {
  const routerSource = fs.readFileSync(
    path.resolve(__dirname, "../router/extractByDocType.ts"),
    "utf8",
  );

  assert.ok(
    routerSource.includes("extract.docai_unavailable"),
    "extractByDocType.ts must emit 'extract.docai_unavailable' when DocAI route falls back",
  );
});

// ── Guard 2: extractByDocType emits extract.docai_failed event ──────────────

test("Guard 2: extractByDocType contains extract.docai_failed event emission", () => {
  const routerSource = fs.readFileSync(
    path.resolve(__dirname, "../router/extractByDocType.ts"),
    "utf8",
  );

  assert.ok(
    routerSource.includes("extract.docai_failed"),
    "extractByDocType.ts must emit 'extract.docai_failed' when DocAI call fails",
  );
});

// ── Guard 3: fallbackReason is always set when wouldUseDocAi && !docAiEnabled ─

test("Guard 3: DocAI fallback includes fallbackReason in routing meta", () => {
  const routerSource = fs.readFileSync(
    path.resolve(__dirname, "../router/extractByDocType.ts"),
    "utf8",
  );

  // The router must compute fallbackReason when DocAI is disabled
  assert.ok(
    routerSource.includes('fallbackReason: "docai_disabled"'),
    "Router must set fallbackReason to 'docai_disabled' when DocAI route is forced to Gemini",
  );
});

// ── Guard 4: DocAI auth failure already emits docai.auth.failed ─────────────

test("Guard 4: extractWithGoogleDocAi emits docai.auth.failed on auth error", () => {
  const docAiSource = fs.readFileSync(
    path.resolve(__dirname, "../googleDocAi/extractWithGoogleDocAi.ts"),
    "utf8",
  );

  assert.ok(
    docAiSource.includes("docai.auth.failed"),
    "extractWithGoogleDocAi.ts must emit 'docai.auth.failed' on authentication failure",
  );
});

// ── Guard 5: extract.routed event always includes route decision ────────────

test("Guard 5: extractByDocType always emits extract.routed event", () => {
  const routerSource = fs.readFileSync(
    path.resolve(__dirname, "../router/extractByDocType.ts"),
    "utf8",
  );

  assert.ok(
    routerSource.includes("extract.routed"),
    "extractByDocType.ts must always emit 'extract.routed' event with routing decision",
  );
});
