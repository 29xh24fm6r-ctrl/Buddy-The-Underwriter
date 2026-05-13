/**
 * SPEC-GEMINI-FLASH-LITE-MIGRATION-1 §3.3 — structured assist location guard.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const FILE = resolve(
  process.cwd(),
  "src/lib/extraction/geminiFlashStructuredAssist.ts",
);
const SRC = readFileSync(FILE, "utf8");

test("[structured-assist-loc-1] location default is `us` multi-region", () => {
  const fnMatch = SRC.match(/function\s+getGoogleLocation[\s\S]*?\n\}/);
  assert.ok(fnMatch, "getGoogleLocation function not found");
  const body = fnMatch[0];
  assert.match(body, /\|\|\s*["']us["']/);
  assert.doesNotMatch(body, /\|\|\s*["']us-central1["']/);
});
