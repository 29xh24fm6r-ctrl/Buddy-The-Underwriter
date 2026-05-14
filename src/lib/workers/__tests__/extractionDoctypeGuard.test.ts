/**
 * Runtime + source-level guards for SPEC-VERTEX-SDK-MIGRATION-1.
 *
 * sdkResponseGuard.ts is a pure module (no server-only) per the precedent
 * set by failureCodes.ts ("safe for CI guard imports"). That lets these
 * tests exercise the actual classifySdkError function at runtime.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { classifySdkError } from "@/lib/extraction/sdkResponseGuard";

test("[doctype-1] classifySdkError flags raw <!DOCTYPE message", () => {
  const err = new Error(`Unexpected token '<', "<!DOCTYPE "... is not valid JSON`);
  const c = classifySdkError(err);
  assert.equal(c.code, "SDK_HTML_RESPONSE");
  assert.equal(c.isHtmlResponse, true);
});

test("[doctype-2] classifySdkError flags errors wrapped via cause chain", () => {
  const inner = new Error(`<!doctype html><html><body>...`);
  const wrapped = new Error("OCR failed", { cause: inner });
  const c = classifySdkError(wrapped);
  assert.equal(c.isHtmlResponse, true);
  assert.equal(c.code, "SDK_HTML_RESPONSE");
});

test("[doctype-3] classifySdkError leaves unrelated errors UNCLASSIFIED", () => {
  const err = new Error("Request timed out after 45000ms");
  const c = classifySdkError(err);
  assert.equal(c.code, "UNCLASSIFIED");
  assert.equal(c.isHtmlResponse, false);
});

test("[doctype-4] classifySdkError handles null/undefined/empty safely", () => {
  assert.equal(classifySdkError(null).code, "UNCLASSIFIED");
  assert.equal(classifySdkError(undefined).code, "UNCLASSIFIED");
  assert.equal(classifySdkError("").code, "UNCLASSIFIED");
});

test("[doctype-5] processDocExtractionOutbox imports classifySdkError", () => {
  const src = readFileSync(
    resolve(process.cwd(), "src/lib/workers/processDocExtractionOutbox.ts"),
    "utf8",
  );
  assert.match(
    src,
    /import\s+\{\s*classifySdkError\s*\}\s+from\s+["']@\/lib\/extraction\/sdkResponseGuard["']/,
    "doc-extraction worker must import classifySdkError from sdkResponseGuard",
  );
});

test("[doctype-6] doc-extraction worker prefixes last_error with SDK_HTML_RESPONSE on match", () => {
  const src = readFileSync(
    resolve(process.cwd(), "src/lib/workers/processDocExtractionOutbox.ts"),
    "utf8",
  );
  // Match: `SDK_HTML_RESPONSE: ${rawMessage}` interpolation pattern
  assert.match(
    src,
    /SDK_HTML_RESPONSE:\s*\$\{rawMessage\}/,
    "doc-extraction worker must record SDK_HTML_RESPONSE prefix in last_error",
  );
});

test("[doctype-7] failureCodes.ts registers SDK_HTML_RESPONSE", () => {
  const src = readFileSync(
    resolve(process.cwd(), "src/lib/extraction/failureCodes.ts"),
    "utf8",
  );
  assert.match(
    src,
    /SDK_HTML_RESPONSE:\s*["']SDK_HTML_RESPONSE["']/,
    "failureCodes.ts must register SDK_HTML_RESPONSE",
  );
});

test("[doctype-8] sdkResponseGuard helper is a pure module (no server-only)", () => {
  const src = readFileSync(
    resolve(process.cwd(), "src/lib/extraction/sdkResponseGuard.ts"),
    "utf8",
  );
  assert.doesNotMatch(
    src,
    /import\s+["']server-only["']/,
    "sdkResponseGuard.ts must be pure (no server-only) so CI guards can import it",
  );
  assert.match(src, /export\s+function\s+classifySdkError/);
});
