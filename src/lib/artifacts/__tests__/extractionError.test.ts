import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  isExtractionErrorPayload,
  extractErrorMessage,
} from "@/lib/artifacts/extractionError";

// ──────────────────────────────────────────────────────────────
// isExtractionErrorPayload
// ──────────────────────────────────────────────────────────────
describe("isExtractionErrorPayload", () => {
  test("detects classifyDocument error fallback shape", () => {
    assert.equal(
      isExtractionErrorPayload({ error: "Anthropic billing error" }),
      true,
    );
  });

  test("detects error payload with extra null keys", () => {
    assert.equal(
      isExtractionErrorPayload({ error: "API timeout", extra: null }),
      true,
    );
  });

  test("detects error payload with empty-string keys", () => {
    assert.equal(
      isExtractionErrorPayload({ error: "quota exceeded", detail: "" }),
      true,
    );
  });

  test("returns false for valid extraction payload", () => {
    assert.equal(
      isExtractionErrorPayload({
        doc_type: "IRS_BUSINESS",
        confidence: 0.95,
        reason: "Form 1120S visible",
      }),
      false,
    );
  });

  test("returns false for null", () => {
    assert.equal(isExtractionErrorPayload(null), false);
  });

  test("returns false for undefined", () => {
    assert.equal(isExtractionErrorPayload(undefined), false);
  });

  test("returns false for empty object", () => {
    assert.equal(isExtractionErrorPayload({}), false);
  });

  test("returns false when error coexists with real keys", () => {
    // An object that has error but also meaningful data is NOT a pure error envelope
    assert.equal(
      isExtractionErrorPayload({
        error: "partial failure",
        doc_type: "T12",
        confidence: 0.5,
      }),
      false,
    );
  });

  test("returns false for primitives", () => {
    assert.equal(isExtractionErrorPayload("string"), false);
    assert.equal(isExtractionErrorPayload(42), false);
    assert.equal(isExtractionErrorPayload(true), false);
  });

  test("returns false for arrays", () => {
    assert.equal(isExtractionErrorPayload([{ error: "x" }]), false);
  });

  test("returns false when error is empty string", () => {
    assert.equal(isExtractionErrorPayload({ error: "" }), false);
  });

  test("returns false when error is not a string", () => {
    assert.equal(isExtractionErrorPayload({ error: 42 }), false);
    assert.equal(isExtractionErrorPayload({ error: null }), false);
    assert.equal(isExtractionErrorPayload({ error: { nested: true } }), false);
  });
});

// ──────────────────────────────────────────────────────────────
// extractErrorMessage
// ──────────────────────────────────────────────────────────────
describe("extractErrorMessage", () => {
  test("extracts error string from payload", () => {
    assert.equal(
      extractErrorMessage({ error: "API billing error" }),
      "API billing error",
    );
  });

  test("returns 'unknown error' for null", () => {
    assert.equal(extractErrorMessage(null), "unknown error");
  });

  test("returns 'unknown error' for undefined", () => {
    assert.equal(extractErrorMessage(undefined), "unknown error");
  });

  test("returns JSON fallback for object without error key", () => {
    const msg = extractErrorMessage({ foo: "bar" });
    assert.ok(msg.includes("foo"));
  });

  test("truncates long error strings", () => {
    const longError = "x".repeat(3000);
    const msg = extractErrorMessage({ error: longError });
    assert.ok(msg.length <= 2000);
  });
});
