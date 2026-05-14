/**
 * Source-level guard tests for SPEC-VERTEX-SDK-MIGRATION-1.
 *
 * Repo convention: source-grep over server-only modules (see
 * vertexLocationGuard.test.ts and workerHardeningGuard.test.ts).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { execSync } from "node:child_process";

const ROOT = process.cwd();

// All 6 production callers in src/ that previously imported @google-cloud/vertexai.
// Scope was expanded beyond the spec's 3-file list at implementation time —
// grep found these additional callers; user approved the expansion.
const PROD_CALL_SITES = [
  "src/lib/financialSpreads/extractors/gemini/geminiClient.ts",
  "src/lib/extraction/geminiFlashStructuredAssist.ts",
  "src/lib/ocr/runGeminiOcrJob.ts",
  "src/buddy/brain/geminiAdapter.ts",
  "src/lib/artifacts/classifyDocument.ts",
  "src/lib/classification/tier3LLM.ts",
];

test("[sdk-1] @google-cloud/vertexai is NOT in package.json", () => {
  const pkg = readFileSync(resolve(ROOT, "package.json"), "utf8");
  assert.doesNotMatch(
    pkg,
    /"@google-cloud\/vertexai"\s*:/,
    "deprecated @google-cloud/vertexai dependency must be removed; use @google/genai",
  );
});

test("[sdk-2] @google/genai IS in package.json", () => {
  const pkg = readFileSync(resolve(ROOT, "package.json"), "utf8");
  assert.match(
    pkg,
    /"@google\/genai"\s*:/,
    "@google/genai must be in dependencies",
  );
});

test("[sdk-3] no file in src/ imports from the deprecated SDK", () => {
  // Exclude __tests__ so this guard's own grep string doesn't self-match.
  let grepOutput = "";
  try {
    grepOutput = execSync(
      `grep -rn --exclude-dir=__tests__ 'from "@google-cloud/vertexai"' src/ || true`,
      { cwd: ROOT, encoding: "utf8" },
    );
  } catch {
    grepOutput = "";
  }
  assert.equal(
    grepOutput.trim(),
    "",
    `unexpected imports from @google-cloud/vertexai:\n${grepOutput}`,
  );
});

test("[sdk-4] all 6 production call sites import GoogleGenAI", () => {
  for (const rel of PROD_CALL_SITES) {
    const src = readFileSync(resolve(ROOT, rel), "utf8");
    assert.match(
      src,
      /import\s+\{[^}]*\bGoogleGenAI\b[^}]*\}\s+from\s+["']@google\/genai["']/,
      `${rel} must import GoogleGenAI from @google/genai`,
    );
  }
});

test("[sdk-5] all 6 production call sites construct the client with vertexai:true", () => {
  for (const rel of PROD_CALL_SITES) {
    const src = readFileSync(resolve(ROOT, rel), "utf8");
    assert.match(
      src,
      /new\s+GoogleGenAI\s*\(\s*\{[\s\S]*?vertexai:\s*true/,
      `${rel} must construct GoogleGenAI with vertexai:true (we use Vertex backend, not API key)`,
    );
  }
});

test("[sdk-6] no file in src/ uses the legacy vertexAI.getGenerativeModel call shape", () => {
  // Match only call sites (`.getGenerativeModel(`), not arbitrary string
  // references in tests/comments. Exclude the __tests__ directory so the
  // guard itself doesn't self-match.
  let grepOutput = "";
  try {
    grepOutput = execSync(
      `grep -rn --exclude-dir=__tests__ '\\.getGenerativeModel(' src/ || true`,
      { cwd: ROOT, encoding: "utf8" },
    );
  } catch {
    grepOutput = "";
  }
  assert.equal(
    grepOutput.trim(),
    "",
    `unexpected getGenerativeModel calls (legacy SDK shape):\n${grepOutput}`,
  );
});

test("[sdk-7] dynamic import in gcpAdcBootstrap targets the new SDK", () => {
  const src = readFileSync(
    resolve(ROOT, "src/lib/gcpAdcBootstrap.ts"),
    "utf8",
  );
  assert.match(
    src,
    /await\s+import\(["']@google\/genai["']\)/,
    "gcpAdcBootstrap.ts dynamic import must target @google/genai",
  );
  assert.doesNotMatch(
    src,
    /await\s+import\(["']@google-cloud\/vertexai["']\)/,
    "gcpAdcBootstrap.ts must not reference the deprecated SDK",
  );
});
