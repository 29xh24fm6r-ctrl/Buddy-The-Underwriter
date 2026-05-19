/**
 * Source-level guard tests for SPEC-OUTBOX-ROUTING-AND-LOCATION-CENTRALIZATION-1.
 *
 * Pure source-grep — no module import (the helper imports "server-only", which
 * is a Next.js virtual module not resolvable under `node --test --import tsx`).
 * This matches the repo convention for CI guard tests on server-only modules
 * (see workerHardeningGuard.test.ts).
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = process.cwd();
const HELPER_FILE = resolve(ROOT, "src/lib/ai/vertexLocation.ts");

const CALLER_FILES = [
  "src/lib/financialSpreads/extractors/gemini/geminiClient.ts",
  "src/lib/extraction/geminiFlashStructuredAssist.ts",
  "src/lib/ocr/runGeminiOcrJob.ts",
  "src/lib/gcpAdcBootstrap.ts",
];

test("[vertex-loc-1] helper file exists at src/lib/ai/vertexLocation.ts", () => {
  assert.ok(existsSync(HELPER_FILE), "src/lib/ai/vertexLocation.ts must exist");
});

test("[vertex-loc-2] helper default is 'us-central1' (last in fallback chain)", () => {
  const src = readFileSync(HELPER_FILE, "utf8");
  assert.match(
    src,
    /process\.env\.GOOGLE_CLOUD_LOCATION\s*\|\|\s*process\.env\.GOOGLE_CLOUD_REGION\s*\|\|\s*["']us-central1["']/,
    "vertexLocation.ts must default to 'us-central1' as last fallback",
  );
});

test("[vertex-loc-3] helper reads GOOGLE_CLOUD_LOCATION first", () => {
  const src = readFileSync(HELPER_FILE, "utf8");
  const locIdx = src.indexOf("GOOGLE_CLOUD_LOCATION");
  const regionIdx = src.indexOf("GOOGLE_CLOUD_REGION");
  assert.ok(locIdx > 0, "must reference GOOGLE_CLOUD_LOCATION");
  assert.ok(regionIdx > 0, "must reference GOOGLE_CLOUD_REGION");
  assert.ok(locIdx < regionIdx, "GOOGLE_CLOUD_LOCATION must take precedence");
});

test("[vertex-loc-4] helper exports getVertexLocation function", () => {
  const src = readFileSync(HELPER_FILE, "utf8");
  assert.match(
    src,
    /export\s+function\s+getVertexLocation\s*\(/,
    "must export getVertexLocation",
  );
});

test("[vertex-loc-5] no caller defines its own getGoogleLocation helper", () => {
  for (const rel of CALLER_FILES) {
    const abs = resolve(ROOT, rel);
    const src = readFileSync(abs, "utf8");
    assert.doesNotMatch(
      src,
      /function\s+getGoogleLocation\s*\(\s*\)\s*:\s*string\s*\{/,
      `${rel} still defines a local getGoogleLocation() — must import getVertexLocation from @/lib/ai/vertexLocation`,
    );
  }
});

test("[vertex-loc-6] all callers import getVertexLocation from the central helper", () => {
  for (const rel of CALLER_FILES) {
    const abs = resolve(ROOT, rel);
    const src = readFileSync(abs, "utf8");
    assert.match(
      src,
      /import\s+\{[^}]*\bgetVertexLocation\b[^}]*\}\s+from\s+["']@\/lib\/ai\/vertexLocation["']/,
      `${rel} must import getVertexLocation from @/lib/ai/vertexLocation`,
    );
  }
});

test("[vertex-loc-7] no caller hardcodes 'us-central1' as a default", () => {
  for (const rel of CALLER_FILES) {
    const abs = resolve(ROOT, rel);
    const src = readFileSync(abs, "utf8");
    assert.doesNotMatch(
      src,
      /GOOGLE_CLOUD_LOCATION[\s\S]{0,200}\|\|\s*["']us-central1["']/,
      `${rel} still has a 'us-central1' fallback — must use getVertexLocation()`,
    );
  }
});
