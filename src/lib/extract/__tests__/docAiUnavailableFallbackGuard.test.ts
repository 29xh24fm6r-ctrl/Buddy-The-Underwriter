/**
 * CI Guard — DocAI Unavailable Fallback
 *
 * When DocAI is enabled but unavailable (permission, auth, processor not found),
 * the pipeline must fall back to Gemini OCR explicitly — never dead-stop.
 *
 * Fallback is visible, measurable, and never claims DocAI succeeded.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// ── Re-implement isDocAiUnavailableError inline for unit testing ────────
// (Cannot import from extractByDocType.ts — server-only transitive dep)

function isDocAiUnavailableError(err: unknown): boolean {
  const e: any = err;
  const msg = String(e?.message || e?.details || e || "").toLowerCase();
  const code = String(e?.code ?? "").toLowerCase();

  if (msg.includes("missing_processor_id")) return true;
  if (msg.includes("processor_not_found")) return true;
  if (msg.includes("permission_denied") || msg.includes("permission denied")) return true;
  if (msg.includes("unauthenticated")) return true;
  if (msg.includes("not_found") || msg.includes("not found")) return true;
  if (msg.includes("403") || msg.includes("401") || msg.includes("404")) return true;
  if (code === "7" || code.includes("permission_denied")) return true;
  if (code === "16" || code.includes("unauthenticated")) return true;
  if (code === "5" || code.includes("not_found")) return true;
  if (msg.includes("wif auth failed")) return true;
  if (msg.includes("docai_process_failed")) return true;

  return false;
}

// ── Source file readers ──────────────────────────────────────────────────

function readRouter(): string {
  return fs.readFileSync(
    path.join(process.cwd(), "src/lib/extract/router/extractByDocType.ts"),
    "utf8",
  );
}

function readDocAiExtractor(): string {
  return fs.readFileSync(
    path.join(process.cwd(), "src/lib/extract/googleDocAi/extractWithGoogleDocAi.ts"),
    "utf8",
  );
}

// ── Predicate Tests ─────────────────────────────────────────────────────

describe("isDocAiUnavailableError predicate", () => {
  test("detects missing_processor_id", () => {
    const err = new Error("missing_processor_id:TAX_PROCESSOR:env=GOOGLE_DOCAI_TAX_PROCESSOR_ID");
    assert.equal(isDocAiUnavailableError(err), true);
  });

  test("detects permission_denied", () => {
    const err = new Error("7 PERMISSION_DENIED: The caller does not have permission");
    assert.equal(isDocAiUnavailableError(err), true);
  });

  test("detects UNAUTHENTICATED", () => {
    const err = new Error("16 UNAUTHENTICATED: Request had invalid authentication credentials");
    assert.equal(isDocAiUnavailableError(err), true);
  });

  test("detects NOT_FOUND (processor not found)", () => {
    const err = new Error("5 NOT_FOUND: Resource projects/xxx/locations/us/processors/yyy not found");
    assert.equal(isDocAiUnavailableError(err), true);
  });

  test("detects gRPC code 7 (permission_denied)", () => {
    const err = Object.assign(new Error("some error"), { code: "7" });
    assert.equal(isDocAiUnavailableError(err), true);
  });

  test("detects gRPC code 16 (unauthenticated)", () => {
    const err = Object.assign(new Error("some error"), { code: "16" });
    assert.equal(isDocAiUnavailableError(err), true);
  });

  test("detects WIF auth failure", () => {
    const err = new Error("DocAI WIF auth failed: token exchange error");
    assert.equal(isDocAiUnavailableError(err), true);
  });

  test("detects docai_process_failed wrapper", () => {
    const err = new Error("docai_process_failed:TAX_PROCESSOR:us:abc123:connection reset");
    assert.equal(isDocAiUnavailableError(err), true);
  });

  test("detects HTTP 403 embedded in message", () => {
    const err = new Error("Request failed with status 403");
    assert.equal(isDocAiUnavailableError(err), true);
  });

  test("does NOT match page limit error", () => {
    const err = new Error("3 INVALID_ARGUMENT: Document pages exceed the limit: 30 got 42");
    assert.equal(isDocAiUnavailableError(err), false);
  });

  test("does NOT match quota exceeded", () => {
    const err = new Error("RESOURCE_EXHAUSTED: quota exceeded");
    assert.equal(isDocAiUnavailableError(err), false);
  });

  test("handles undefined/null/empty gracefully", () => {
    assert.equal(isDocAiUnavailableError(undefined), false);
    assert.equal(isDocAiUnavailableError(null), false);
    assert.equal(isDocAiUnavailableError(""), false);
    assert.equal(isDocAiUnavailableError({}), false);
  });
});

// ── Static Source Guards ────────────────────────────────────────────────

describe("DocAI Unavailable Fallback CI Guards", () => {
  // Guard 1: Router exports/contains isDocAiUnavailableError
  test("[guard-1] Router exports isDocAiUnavailableError", () => {
    const src = readRouter();
    assert.ok(
      src.includes("export function isDocAiUnavailableError"),
      "isDocAiUnavailableError must be exported from extractByDocType.ts",
    );
  });

  // Guard 2: Router contains ledger event key
  test("[guard-2] Router emits extract.docai_unavailable_fallback ledger event", () => {
    const src = readRouter();
    assert.ok(
      src.includes("extract.docai_unavailable_fallback"),
      "Must log extract.docai_unavailable_fallback event on DocAI unavailable",
    );
  });

  // Guard 3: Router contains fallback metadata keys
  test("[guard-3] Router includes fallback provenance (fallback_from + fallback_reason: UNAVAILABLE)", () => {
    const src = readRouter();
    assert.ok(src.includes('fallback_from: "DOC_AI"'), "Must include fallback_from: DOC_AI");
    assert.ok(src.includes('fallback_reason: "UNAVAILABLE"'), "Must include fallback_reason: UNAVAILABLE");
  });

  // Guard 4: Router calls Gemini extraction in unavailable fallback branch
  test("[guard-4] Router calls extractWithGeminiOcr after isDocAiUnavailableError check", () => {
    const src = readRouter();
    const predicateIdx = src.indexOf("isDocAiUnavailableError(error)");
    const fallbackIdx = src.indexOf("extractWithGeminiOcr(doc)", predicateIdx);
    assert.ok(
      predicateIdx > 0 && fallbackIdx > predicateIdx,
      "extractWithGeminiOcr must be called after isDocAiUnavailableError check in catch block",
    );
  });

  // Guard 5: DocAI extractor throws missing_processor_id when env missing
  test("[guard-5] DocAI extractor throws missing_processor_id with typed context", () => {
    const src = readDocAiExtractor();
    assert.ok(
      src.includes("missing_processor_id:"),
      "DocAI extractor must throw missing_processor_id: with processor type and env key",
    );
    assert.ok(
      src.includes("docai_process_failed:"),
      "DocAI extractor must wrap processDocument errors with docai_process_failed: context",
    );
  });
});
