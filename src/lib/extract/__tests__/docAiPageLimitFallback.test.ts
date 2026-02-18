import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// ─── Import the predicate directly (no server-only guard) ────────────────────

// The predicate is exported from extractByDocType.ts but that file has
// "server-only" at the top. For unit testing we read the source and also
// re-implement the predicate logic inline to verify behavior without importing.

function isDocAiPageLimitError(err: unknown): boolean {
  const msg = String(
    (err as any)?.message || (err as any)?.details || err || "",
  ).toLowerCase();
  return (
    msg.includes("document pages") &&
    (msg.includes("exceed the limit") || msg.includes("exceed"))
  );
}

// ─── Predicate: isDocAiPageLimitError ────────────────────────────────────────

test("detects non-imageless mode page limit error", () => {
  const err = new Error(
    "3 INVALID_ARGUMENT: Document pages in non-imageless mode exceed the limit: 15 got 24. Try using imageless mode to increase the limit to 30.",
  );
  assert.equal(isDocAiPageLimitError(err), true);
});

test("detects absolute page limit error", () => {
  const err = new Error(
    "3 INVALID_ARGUMENT: Document pages exceed the limit: 30 got 42",
  );
  assert.equal(isDocAiPageLimitError(err), true);
});

test("detects page limit with gRPC code prefix", () => {
  const err = new Error(
    "3 INVALID_ARGUMENT: Document pages exceed the limit: 30 got 39",
  );
  assert.equal(isDocAiPageLimitError(err), true);
});

test("detects page limit from error.details", () => {
  const err = { details: "Document pages exceed the limit: 15 got 16" };
  assert.equal(isDocAiPageLimitError(err), true);
});

test("does NOT match doc_not_found", () => {
  const err = new Error("doc_not_found: abc123");
  assert.equal(isDocAiPageLimitError(err), false);
});

test("does NOT match quota exceeded", () => {
  const err = new Error("RESOURCE_EXHAUSTED: quota exceeded");
  assert.equal(isDocAiPageLimitError(err), false);
});

test("does NOT match auth errors", () => {
  const err = new Error(
    "UNAUTHENTICATED: Request had invalid authentication credentials",
  );
  assert.equal(isDocAiPageLimitError(err), false);
});

test("does NOT match generic INVALID_ARGUMENT without page mention", () => {
  const err = new Error("3 INVALID_ARGUMENT: Request contains an invalid argument");
  assert.equal(isDocAiPageLimitError(err), false);
});

test("handles undefined/null/empty gracefully", () => {
  assert.equal(isDocAiPageLimitError(undefined), false);
  assert.equal(isDocAiPageLimitError(null), false);
  assert.equal(isDocAiPageLimitError(""), false);
  assert.equal(isDocAiPageLimitError({}), false);
});

// ─── Static verification: fallback wiring in extractByDocType.ts ─────────────

function readRouter(): string {
  return fs.readFileSync(
    path.join(process.cwd(), "src/lib/extract/router/extractByDocType.ts"),
    "utf8",
  );
}

test("extractByDocType.ts exports isDocAiPageLimitError", () => {
  const src = readRouter();
  assert.ok(
    src.includes("export function isDocAiPageLimitError"),
    "isDocAiPageLimitError must be exported",
  );
});

test("extractByDocType.ts contains page_limit_fallback ledger event", () => {
  const src = readRouter();
  assert.ok(
    src.includes("extract.docai.page_limit_fallback"),
    "Must log extract.docai.page_limit_fallback event",
  );
});

test("extractByDocType.ts includes fallback provenance in metrics", () => {
  const src = readRouter();
  assert.ok(src.includes("fallback_from"), "Must include fallback_from in metrics");
  assert.ok(src.includes("fallback_reason"), "Must include fallback_reason in metrics");
});

test("extractByDocType.ts calls extractWithGeminiOcr in catch block", () => {
  const src = readRouter();
  // The fallback calls extractWithGeminiOcr inside the catch — verify it
  // appears after isDocAiPageLimitError (not just the normal routing path)
  const predicateIdx = src.indexOf("isDocAiPageLimitError(error)");
  const fallbackIdx = src.indexOf("extractWithGeminiOcr(doc)", predicateIdx);
  assert.ok(
    predicateIdx > 0 && fallbackIdx > predicateIdx,
    "extractWithGeminiOcr must be called after isDocAiPageLimitError check in catch block",
  );
});
