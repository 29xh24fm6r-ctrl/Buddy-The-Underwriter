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

// Originally 6 production callers in src/ that previously imported
// @google-cloud/vertexai (scope was expanded beyond the spec's 3-file list
// at implementation time — grep found these additional callers; user
// approved the expansion).
//
// SPEC-M1.1: these 6 files are exactly SPEC-M1.1's remaining Vertex-auth
// migration targets — each is being routed onto the AI gateway
// (runRole/runRoleStream with authMode: "vertex"), which owns the Vertex
// REST call itself (src/lib/ai/providers/google.ts — raw fetch, no SDK
// import at all; SPEC-GATEWAY-CAPABILITY-EXPANSION-1 §1) rather than each
// caller constructing its own GoogleGenAI client. Entries are removed from
// this list as each call site migrates — remove-only, same convention as
// scripts/guards/ai-gateway-only-allowlist.txt. Once this list is empty,
// [sdk-4]/[sdk-5] are vacuously true (no remaining direct-SDK callers);
// [sdk-1]/[sdk-2]/[sdk-7] still hold because gcpAdcBootstrap.ts's WIF auth
// helper (used by providers/google.ts) keeps its own real @google/genai
// dynamic import for auth resolution.
const PROD_CALL_SITES: string[] = [];

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

test("[sdk-4] all remaining production call sites import GoogleGenAI", () => {
  for (const rel of PROD_CALL_SITES) {
    const src = readFileSync(resolve(ROOT, rel), "utf8");
    assert.match(
      src,
      /import\s+\{[^}]*\bGoogleGenAI\b[^}]*\}\s+from\s+["']@google\/genai["']/,
      `${rel} must import GoogleGenAI from @google/genai`,
    );
  }
});

test("[sdk-5] all remaining production call sites construct the client with vertexai:true", () => {
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
