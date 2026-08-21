import test from "node:test";
import assert from "node:assert/strict";

import { collapseDuplicateDocuments } from "@/lib/documents/collapseDuplicateDocuments";

/** The six real rows on deal b296dec2 — every one with sha256 NULL. */
const SIX_COPIES = [
  { id: "5c26ffa0", filename: "2025_TaxReturn.pdf", sizeBytes: 1013618, sha256: null, uploadedAt: "2026-08-21T16:04:55Z" },
  { id: "1e3ca468", filename: "2025_TaxReturn.pdf", sizeBytes: 1013618, sha256: null, uploadedAt: "2026-08-20T18:52:19Z" },
  { id: "7797e52e", filename: "2025_TaxReturn.pdf", sizeBytes: 1013618, sha256: null, uploadedAt: "2026-08-20T17:23:52Z" },
  { id: "496dc9dd", filename: "2025_TaxReturn.pdf", sizeBytes: 1013618, sha256: null, uploadedAt: "2026-08-20T16:14:39Z" },
  { id: "c2f714bb", filename: "2025_TaxReturn.pdf", sizeBytes: 1013618, sha256: null, uploadedAt: "2026-08-20T15:43:10Z" },
  { id: "65a6814a", filename: "2025_TaxReturn.pdf", sizeBytes: 1013618, sha256: null, uploadedAt: "2026-08-20T14:57:24Z" },
];

test("REGRESSION b296dec2: six sha-less copies collapse to one entry", () => {
  const collapsed = collapseDuplicateDocuments(SIX_COPIES);
  assert.equal(collapsed.length, 1);
  assert.equal(collapsed[0].copies, 6);
  assert.equal(collapsed[0].duplicateIds.length, 5);
});

test("the newest copy is the one kept", () => {
  const collapsed = collapseDuplicateDocuments(SIX_COPIES);
  assert.equal(collapsed[0].id, "5c26ffa0");
  assert.equal(collapsed[0].duplicateIds.includes("5c26ffa0"), false);
});

test("nothing is dropped — every input id is still accounted for", () => {
  const collapsed = collapseDuplicateDocuments(SIX_COPIES);
  const accounted = new Set(collapsed.flatMap((d) => [d.id, ...d.duplicateIds]));
  assert.equal(accounted.size, SIX_COPIES.length);
});

test("a real sha256 beats the filename+size heuristic", () => {
  // Same name, same size, DIFFERENT content — a corrected re-upload. Two
  // hashes that disagree are two documents, whatever the filename says.
  const collapsed = collapseDuplicateDocuments([
    { id: "a", filename: "return.pdf", sizeBytes: 100, sha256: "aaa", uploadedAt: "2026-08-02T00:00:00Z" },
    { id: "b", filename: "return.pdf", sizeBytes: 100, sha256: "bbb", uploadedAt: "2026-08-01T00:00:00Z" },
  ]);
  assert.equal(collapsed.length, 2);
});

test("identical hashes collapse even when the filenames differ", () => {
  const collapsed = collapseDuplicateDocuments([
    { id: "a", filename: "return.pdf", sizeBytes: 100, sha256: "aaa", uploadedAt: "2026-08-02T00:00:00Z" },
    { id: "b", filename: "return-copy.pdf", sizeBytes: 100, sha256: "aaa", uploadedAt: "2026-08-01T00:00:00Z" },
  ]);
  assert.equal(collapsed.length, 1);
  assert.equal(collapsed[0].copies, 2);
});

test("same name, different size stays separate", () => {
  const collapsed = collapseDuplicateDocuments([
    { id: "a", filename: "statement.pdf", sizeBytes: 100, sha256: null, uploadedAt: null },
    { id: "b", filename: "statement.pdf", sizeBytes: 200, sha256: null, uploadedAt: null },
  ]);
  assert.equal(collapsed.length, 2);
});

test("rows missing a filename or size are never collapsed into anything", () => {
  // Uncertainty means show it. Hiding a document the borrower did send is
  // far worse than showing one twice.
  const collapsed = collapseDuplicateDocuments([
    { id: "a", filename: null, sizeBytes: null, sha256: null, uploadedAt: null },
    { id: "b", filename: null, sizeBytes: null, sha256: null, uploadedAt: null },
    { id: "c", filename: "x.pdf", sizeBytes: 0, sha256: null, uploadedAt: null },
    { id: "d", filename: "x.pdf", sizeBytes: 0, sha256: null, uploadedAt: null },
  ]);
  assert.equal(collapsed.length, 4);
  assert.deepEqual(collapsed.map((d) => d.copies), [1, 1, 1, 1]);
});

test("filename matching ignores case and surrounding whitespace", () => {
  const collapsed = collapseDuplicateDocuments([
    { id: "a", filename: "Return.PDF", sizeBytes: 10, sha256: null, uploadedAt: null },
    { id: "b", filename: " return.pdf ", sizeBytes: 10, sha256: null, uploadedAt: null },
  ]);
  assert.equal(collapsed.length, 1);
  assert.equal(collapsed[0].copies, 2);
});

test("distinct documents keep their input order", () => {
  const collapsed = collapseDuplicateDocuments([
    { id: "a", filename: "one.pdf", sizeBytes: 1, sha256: null, uploadedAt: null },
    { id: "b", filename: "two.pdf", sizeBytes: 2, sha256: null, uploadedAt: null },
    { id: "c", filename: "three.pdf", sizeBytes: 3, sha256: null, uploadedAt: null },
  ]);
  assert.deepEqual(collapsed.map((d) => d.id), ["a", "b", "c"]);
});

test("an empty list collapses to an empty list", () => {
  assert.deepEqual(collapseDuplicateDocuments([]), []);
});

test("extra fields on the kept row survive the collapse", () => {
  const collapsed = collapseDuplicateDocuments([
    { id: "a", filename: "x.pdf", sizeBytes: 1, sha256: null, uploadedAt: "2026-08-02T00:00:00Z", label: "Newest", removable: true },
    { id: "b", filename: "x.pdf", sizeBytes: 1, sha256: null, uploadedAt: "2026-08-01T00:00:00Z", label: "Older", removable: false },
  ]);
  assert.equal(collapsed[0].label, "Newest");
  assert.equal(collapsed[0].removable, true);
});
