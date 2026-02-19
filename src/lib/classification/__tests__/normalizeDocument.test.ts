import test from "node:test";
import assert from "node:assert/strict";
import { normalizeDocument } from "../normalizeDocument";

// ─── Page count estimation ──────────────────────────────────────────────────

test("normalizeDocument: page count via form-feed characters", () => {
  const text = "Page 1 content\fPage 2 content\fPage 3 content";
  const doc = normalizeDocument("art-1", text, "test.pdf", "application/pdf");
  assert.equal(doc.pageCount, 3);
});

test("normalizeDocument: page count fallback to char-length heuristic", () => {
  const text = "x".repeat(9000); // ~3 pages at 3000 chars/page
  const doc = normalizeDocument("art-2", text, "test.pdf", null);
  assert.equal(doc.pageCount, 3);
});

test("normalizeDocument: minimum 1 page for short text", () => {
  const doc = normalizeDocument("art-3", "short", "test.txt", null);
  assert.equal(doc.pageCount, 1);
});

// ─── Text extraction ────────────────────────────────────────────────────────

test("normalizeDocument: firstPageText uses form-feed boundary", () => {
  const page1 = "Page 1 " + "a".repeat(2000);
  const page2 = "Page 2 " + "b".repeat(2000);
  const text = page1 + "\f" + page2;
  const doc = normalizeDocument("art-4", text, "test.pdf", null);
  assert.ok(doc.firstPageText.startsWith("Page 1"));
  assert.ok(!doc.firstPageText.includes("Page 2"));
});

test("normalizeDocument: firstTwoPagesText caps at ~6000 chars", () => {
  const text = "x".repeat(20000);
  const doc = normalizeDocument("art-5", text, "test.pdf", null);
  assert.ok(doc.firstTwoPagesText.length <= 6000);
});

// ─── Year detection ─────────────────────────────────────────────────────────

test("normalizeDocument: detectedYears from text", () => {
  const text = "Tax Year 2022\nAmended for 2023";
  const doc = normalizeDocument("art-6", text, "test.pdf", null);
  assert.ok(doc.detectedYears.includes(2022));
  assert.ok(doc.detectedYears.includes(2023));
});

// ─── Table structure detection ──────────────────────────────────────────────

test("normalizeDocument: detects tab-delimited table structure", () => {
  const lines = Array.from({ length: 10 }, (_, i) =>
    `Tenant ${i}\t1000\t$2000\t12/31/2024`,
  ).join("\n");
  const doc = normalizeDocument("art-7", lines, "rentroll.xlsx", null);
  assert.equal(doc.hasTableLikeStructure, true);
});

test("normalizeDocument: no table structure in plain prose", () => {
  const text = "This is a simple text document with no tabular data whatsoever.";
  const doc = normalizeDocument("art-8", text, "letter.pdf", null);
  assert.equal(doc.hasTableLikeStructure, false);
});
