/**
 * SPEC-GEMINI-FLASH-LITE-MIGRATION-1 §3.3 — structured assist location guard.
 *
 * SPEC-M1.1: geminiFlashStructuredAssist.ts no longer constructs its own
 * Vertex endpoint/location — it now calls runRole("generator", { authMode:
 * "vertex", ... }), and src/lib/ai/providers/google.ts (the gateway's own
 * Google provider adapter) is the sole remaining caller of getVertexLocation()
 * for this path. The original invariant (never hardcode "us" multi-region;
 * always go through the centralized helper) still holds — it's just enforced
 * one layer down now, at the gateway's provider adapter instead of at each
 * caller.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const SRC = readFileSync(
  resolve(process.cwd(), "src/lib/extraction/geminiFlashStructuredAssist.ts"),
  "utf8",
);
const GOOGLE_PROVIDER_SRC = readFileSync(
  resolve(process.cwd(), "src/lib/ai/providers/google.ts"),
  "utf8",
);

test("[structured-assist-loc-1] routes Vertex calls through the AI gateway with authMode: vertex", () => {
  assert.match(SRC, /authMode:\s*"vertex"/);
});

test("[structured-assist-loc-2] the gateway's Google provider adapter uses the centralized getVertexLocation() helper, not a hardcoded region", () => {
  assert.match(GOOGLE_PROVIDER_SRC, /getVertexLocation\(\)/);
  assert.doesNotMatch(GOOGLE_PROVIDER_SRC, /["']us["']\s*\|\|/); // no hardcoded "us" multi-region fallback
});
