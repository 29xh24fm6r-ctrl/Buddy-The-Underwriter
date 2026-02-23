/**
 * CI Guard — DocAI Preflight Limits + Chunked Processing
 *
 * Document AI has hard limits: 15 pages sync max, 20 MB per request.
 * The preflight gate prevents doomed requests. Chunking handles multi-page docs.
 * When limits are hit and chunking can't help, the router falls back to Gemini OCR
 * with fallback_reason: "LIMITS" — distinct from "UNAVAILABLE" and "PAGE_LIMIT".
 *
 * These are expected constraints, not outages.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// ── Re-implement isDocAiLimitsError inline for unit testing ──────────────
// (Cannot import from extractByDocType.ts — server-only transitive dep)

function isDocAiLimitsError(err: unknown): boolean {
  const msg = String((err as any)?.message || err || "").toLowerCase();
  return msg.includes("docai_limits_exceeded");
}

// ── Source file readers ──────────────────────────────────────────────────

function readExtractor(): string {
  return fs.readFileSync(
    path.join(process.cwd(), "src/lib/extract/googleDocAi/extractWithGoogleDocAi.ts"),
    "utf8",
  );
}

function readRouter(): string {
  return fs.readFileSync(
    path.join(process.cwd(), "src/lib/extract/router/extractByDocType.ts"),
    "utf8",
  );
}

// ── Predicate Tests ─────────────────────────────────────────────────────

describe("isDocAiLimitsError predicate", () => {
  test("detects byte limit exceeded", () => {
    const err = new Error("docai_limits_exceeded:bytes=25000000:max_bytes=20971520:pages=8");
    assert.equal(isDocAiLimitsError(err), true);
  });

  test("detects chunk byte limit exceeded", () => {
    const err = new Error("docai_limits_exceeded:chunk=2:bytes=22000000:max_bytes=20971520");
    assert.equal(isDocAiLimitsError(err), true);
  });

  test("detects max chunks exceeded", () => {
    const err = new Error("docai_limits_exceeded:chunks_required=12:max_chunks=10:pages=175");
    assert.equal(isDocAiLimitsError(err), true);
  });

  test("does NOT match page limit errors from GCP", () => {
    const err = new Error("3 INVALID_ARGUMENT: Document pages exceed the limit: 30 got 42");
    assert.equal(isDocAiLimitsError(err), false);
  });

  test("does NOT match unavailable errors", () => {
    const err = new Error("7 PERMISSION_DENIED: The caller does not have permission");
    assert.equal(isDocAiLimitsError(err), false);
  });

  test("does NOT match missing processor errors", () => {
    const err = new Error("missing_processor_id:TAX_PROCESSOR:env=GOOGLE_DOCAI_TAX_PROCESSOR_ID");
    assert.equal(isDocAiLimitsError(err), false);
  });

  test("does NOT match auth errors", () => {
    const err = new Error("DocAI WIF auth failed: token exchange error");
    assert.equal(isDocAiLimitsError(err), false);
  });

  test("handles undefined/null/empty gracefully", () => {
    assert.equal(isDocAiLimitsError(undefined), false);
    assert.equal(isDocAiLimitsError(null), false);
    assert.equal(isDocAiLimitsError(""), false);
    assert.equal(isDocAiLimitsError({}), false);
  });
});

// ── Extractor Source Guards ─────────────────────────────────────────────

describe("DocAI Limits Extractor CI Guards", () => {
  // Guard 1: DOCAI_SYNC_MAX_PAGES = 15
  test("[guard-1] Extractor exports DOCAI_SYNC_MAX_PAGES = 15", () => {
    const src = readExtractor();
    assert.ok(
      src.includes("export const DOCAI_SYNC_MAX_PAGES = 15"),
      "DOCAI_SYNC_MAX_PAGES must be exported as 15",
    );
  });

  // Guard 2: DOCAI_SYNC_MAX_BYTES = 20 MB
  test("[guard-2] Extractor exports DOCAI_SYNC_MAX_BYTES = 20 MB", () => {
    const src = readExtractor();
    assert.ok(
      src.includes("export const DOCAI_SYNC_MAX_BYTES = 20 * 1024 * 1024"),
      "DOCAI_SYNC_MAX_BYTES must be exported as 20 * 1024 * 1024",
    );
  });

  // Guard 3: Extractor contains splitPdfIntoChunks function
  test("[guard-3] Extractor contains splitPdfIntoChunks function", () => {
    const src = readExtractor();
    assert.ok(
      src.includes("async function splitPdfIntoChunks("),
      "splitPdfIntoChunks must exist in extractor",
    );
  });

  // Guard 4: Extractor contains processDocAiChunked function
  test("[guard-4] Extractor contains processDocAiChunked function", () => {
    const src = readExtractor();
    assert.ok(
      src.includes("async function processDocAiChunked("),
      "processDocAiChunked must exist in extractor",
    );
  });

  // Guard 5: Extractor throws docai_limits_exceeded
  test("[guard-5] Extractor throws docai_limits_exceeded error", () => {
    const src = readExtractor();
    assert.ok(
      src.includes("docai_limits_exceeded:"),
      "Extractor must throw docai_limits_exceeded when limits exceeded",
    );
  });

  // Guard 6: Extractor emits extract.docai_skipped_limits ledger event
  test("[guard-6] Extractor emits extract.docai_skipped_limits ledger event", () => {
    const src = readExtractor();
    assert.ok(
      src.includes('"extract.docai_skipped_limits"'),
      "Extractor must emit extract.docai_skipped_limits ledger event",
    );
  });

  // Guard 7: Extractor uses pdf-lib for page counting (preflight)
  test("[guard-7] Extractor uses pdf-lib for preflight page count", () => {
    const src = readExtractor();
    // Must dynamically import pdf-lib in the preflight section
    assert.ok(
      src.includes('await import("pdf-lib")'),
      "Extractor must use pdf-lib (dynamic import) for page counting",
    );
  });

  // Guard 8: Extractor checks DOCAI_SYNC_MAX_PAGES before calling ProcessDocument in main fn
  test("[guard-8] Preflight check uses DOCAI_SYNC_MAX_PAGES before ProcessDocument call", () => {
    const src = readExtractor();
    // Scope to main export function (not processDocAiChunked which also calls processDocument)
    const mainFnIdx = src.indexOf("export async function extractWithGoogleDocAi");
    assert.ok(mainFnIdx > 0, "Main export function must exist");

    const mainFnSrc = src.slice(mainFnIdx);
    const preflightIdx = mainFnSrc.indexOf("pdfPageCount > DOCAI_SYNC_MAX_PAGES");
    const processIdx = mainFnSrc.indexOf("client.processDocument(");
    assert.ok(
      preflightIdx > 0 && processIdx > preflightIdx,
      "DOCAI_SYNC_MAX_PAGES check must appear before processDocument call in main function",
    );
  });

  // Guard 9: Chunked path uses DOCAI_SYNC_MAX_BYTES to validate chunks
  test("[guard-9] Chunked path validates chunk byte sizes", () => {
    const src = readExtractor();
    assert.ok(
      src.includes("chunk.bytes.length > DOCAI_SYNC_MAX_BYTES"),
      "Chunked path must validate each chunk against DOCAI_SYNC_MAX_BYTES",
    );
  });

  // Guard 10: ProviderMetrics includes chunks field
  test("[guard-10] ProviderMetrics type includes chunks field", () => {
    const src = readExtractor();
    assert.ok(
      src.includes("chunks?: number"),
      "ProviderMetrics must include chunks field for chunked extraction tracking",
    );
  });

  // Guard 10a: DOCAI_MAX_CHUNKS exported
  test("[guard-10a] Extractor exports DOCAI_MAX_CHUNKS = 10", () => {
    const src = readExtractor();
    assert.ok(
      src.includes("export const DOCAI_MAX_CHUNKS = 10"),
      "DOCAI_MAX_CHUNKS must be exported as 10",
    );
  });

  // Guard 10b: Max chunks check before splitPdfIntoChunks
  test("[guard-10b] processDocAiChunked checks MAX_CHUNKS before splitting", () => {
    const src = readExtractor();
    const fnIdx = src.indexOf("async function processDocAiChunked(");
    assert.ok(fnIdx > 0, "processDocAiChunked must exist");
    const fnSrc = src.slice(fnIdx);

    const maxChunksCheckIdx = fnSrc.indexOf("chunksRequired > DOCAI_MAX_CHUNKS");
    const splitIdx = fnSrc.indexOf("splitPdfIntoChunks(");
    assert.ok(
      maxChunksCheckIdx > 0 && splitIdx > maxChunksCheckIdx,
      "DOCAI_MAX_CHUNKS check must appear BEFORE splitPdfIntoChunks call",
    );
  });

  // Guard 10c: Per-chunk byte limit emits distinct event
  test("[guard-10c] Per-chunk byte limit emits extract.docai_chunk_skipped_limits event", () => {
    const src = readExtractor();
    assert.ok(
      src.includes('"extract.docai_chunk_skipped_limits"'),
      "Per-chunk byte limit must emit extract.docai_chunk_skipped_limits (distinct from extract.docai_skipped_limits)",
    );
  });

  // Guard 10d: Chunk merge includes _pageOffset for evidence correction
  test("[guard-10d] Chunked JSON merge includes _pageOffset for evidence page correction", () => {
    const src = readExtractor();
    const fnIdx = src.indexOf("async function processDocAiChunked(");
    assert.ok(fnIdx > 0, "processDocAiChunked must exist");
    const fnSrc = src.slice(fnIdx);

    assert.ok(
      fnSrc.includes("_pageOffset"),
      "Chunked JSON merge must include _pageOffset field for evidence page correction",
    );
    assert.ok(
      fnSrc.includes("_chunkIndex"),
      "Chunked JSON merge must include _chunkIndex field",
    );
    assert.ok(
      fnSrc.includes("_startPage"),
      "Chunked JSON merge must include _startPage field",
    );
    assert.ok(
      fnSrc.includes("_endPage"),
      "Chunked JSON merge must include _endPage field",
    );
  });

  // Guard 10e: Evidence offset uses startPage - 1 (0-indexed offset for page correction)
  test("[guard-10e] _pageOffset computed as startPage - 1 (0-indexed for page correction)", () => {
    const src = readExtractor();
    assert.ok(
      src.includes("_pageOffset: chunks[i].startPage - 1"),
      "_pageOffset must be chunks[i].startPage - 1 (0-indexed offset for evidence correction)",
    );
  });

  // Guard 10f: processDocAiChunked calls applyPageOffsetToDocAiJson for producer normalization
  test("[guard-10f] processDocAiChunked calls applyPageOffsetToDocAiJson before merge", () => {
    const src = readExtractor();
    const fnIdx = src.indexOf("async function processDocAiChunked(");
    assert.ok(fnIdx > 0, "processDocAiChunked must exist");
    const fnSrc = src.slice(fnIdx);

    assert.ok(
      fnSrc.includes("applyPageOffsetToDocAiJson("),
      "processDocAiChunked must call applyPageOffsetToDocAiJson for producer-side normalization",
    );
  });

  // Guard 10g: Extractor imports applyPageOffsetToDocAiJson
  test("[guard-10g] Extractor imports applyPageOffsetToDocAiJson", () => {
    const src = readExtractor();
    assert.ok(
      src.includes('import { applyPageOffsetToDocAiJson } from "./applyPageOffsetToDocAiJson"'),
      "Extractor must import applyPageOffsetToDocAiJson from sibling module",
    );
  });

  // Guard 10h: Merged JSON has document.pages (single-document structure, not array of chunk wrappers)
  test("[guard-10h] Merged JSON uses single-document structure with document.pages", () => {
    const src = readExtractor();
    const fnIdx = src.indexOf("async function processDocAiChunked(");
    assert.ok(fnIdx > 0, "processDocAiChunked must exist");
    const fnSrc = src.slice(fnIdx);

    // Must merge into document.pages (single response), not an array of chunk wrappers
    assert.ok(
      fnSrc.includes("mergedPages"),
      "Chunked merge must build mergedPages array for single-document output",
    );
    assert.ok(
      fnSrc.includes("pages: mergedPages"),
      "Merged JSON must use pages: mergedPages (not per-chunk wrappers)",
    );
  });

  // Guard 10i: Cumulative text offset tracking across chunks
  test("[guard-10i] processDocAiChunked tracks cumulativeTextOffset for text anchor correction", () => {
    const src = readExtractor();
    const fnIdx = src.indexOf("async function processDocAiChunked(");
    assert.ok(fnIdx > 0, "processDocAiChunked must exist");
    const fnSrc = src.slice(fnIdx);

    assert.ok(
      fnSrc.includes("cumulativeTextOffset"),
      "processDocAiChunked must track cumulativeTextOffset for text anchor normalization",
    );
  });
});

// ── applyPageOffsetToDocAiJson Unit Tests ────────────────────────────────

// Direct import — pure function, no server-only deps
import { applyPageOffsetToDocAiJson } from "../googleDocAi/applyPageOffsetToDocAiJson";

describe("applyPageOffsetToDocAiJson correctness", () => {
  test("chunk 2 with pageOffset=15 normalizes pageNumber 1→16", () => {
    const fakeChunk2 = {
      document: {
        text: "chunk2 text here",
        pages: [
          { pageNumber: 1, dimension: { width: 612, height: 792 } },
          { pageNumber: 2, dimension: { width: 612, height: 792 } },
        ],
      },
    };

    const normalized = applyPageOffsetToDocAiJson(fakeChunk2, 15, 0);

    assert.equal(normalized.document.pages[0].pageNumber, 16);
    assert.equal(normalized.document.pages[1].pageNumber, 17);
  });

  test("pageRefs[].page (0-based) is offset-corrected", () => {
    const fakeChunk = {
      document: {
        entities: [
          {
            type: "tax_form",
            pageAnchor: {
              pageRefs: [
                { page: 0, confidence: 0.99 },
                { page: 2, confidence: 0.95 },
              ],
            },
          },
        ],
      },
    };

    const normalized = applyPageOffsetToDocAiJson(fakeChunk, 15, 0);

    assert.equal(normalized.document.entities[0].pageAnchor.pageRefs[0].page, 15);
    assert.equal(normalized.document.entities[0].pageAnchor.pageRefs[1].page, 17);
  });

  test("pageRefs[].page with omitted page (protobuf default 0) is offset-corrected", () => {
    const fakeChunk = {
      document: {
        entities: [
          {
            pageAnchor: {
              pageRefs: [{ confidence: 0.99 }], // page omitted = 0 (protobuf default)
            },
          },
        ],
      },
    };

    const normalized = applyPageOffsetToDocAiJson(fakeChunk, 10, 0);

    assert.equal(normalized.document.entities[0].pageAnchor.pageRefs[0].page, 10);
  });

  test("textAnchor.textSegments startIndex/endIndex are text-offset-corrected", () => {
    const fakeChunk = {
      document: {
        entities: [
          {
            textAnchor: {
              textSegments: [
                { startIndex: "100", endIndex: "200" },
                { startIndex: "500", endIndex: "700" },
              ],
            },
          },
        ],
      },
    };

    const normalized = applyPageOffsetToDocAiJson(fakeChunk, 0, 5000);

    assert.equal(normalized.document.entities[0].textAnchor.textSegments[0].startIndex, "5100");
    assert.equal(normalized.document.entities[0].textAnchor.textSegments[0].endIndex, "5200");
    assert.equal(normalized.document.entities[0].textAnchor.textSegments[1].startIndex, "5500");
    assert.equal(normalized.document.entities[0].textAnchor.textSegments[1].endIndex, "5700");
  });

  test("textSegments with omitted startIndex (protobuf default 0) is offset-corrected", () => {
    const fakeChunk = {
      document: {
        entities: [
          {
            textAnchor: {
              textSegments: [{ endIndex: "50" }], // startIndex omitted = 0
            },
          },
        ],
      },
    };

    const normalized = applyPageOffsetToDocAiJson(fakeChunk, 0, 3000);

    assert.equal(normalized.document.entities[0].textAnchor.textSegments[0].startIndex, "3000");
    assert.equal(normalized.document.entities[0].textAnchor.textSegments[0].endIndex, "3050");
  });

  test("pageSpan.pageStart/pageEnd (1-based) is offset-corrected", () => {
    const fakeChunk = {
      document: {
        documentLayout: {
          blocks: [
            { pageSpan: { pageStart: 1, pageEnd: 3 } },
            { pageSpan: { pageStart: 4, pageEnd: 5 } },
          ],
        },
      },
    };

    const normalized = applyPageOffsetToDocAiJson(fakeChunk, 15, 0);

    assert.equal(normalized.document.documentLayout.blocks[0].pageSpan.pageStart, 16);
    assert.equal(normalized.document.documentLayout.blocks[0].pageSpan.pageEnd, 18);
    assert.equal(normalized.document.documentLayout.blocks[1].pageSpan.pageStart, 19);
    assert.equal(normalized.document.documentLayout.blocks[1].pageSpan.pageEnd, 20);
  });

  test("returns input unchanged when both offsets are 0", () => {
    const input = { document: { pages: [{ pageNumber: 1 }] } };
    const result = applyPageOffsetToDocAiJson(input, 0, 0);
    assert.deepEqual(result, input);
    assert.equal(result, input); // Same reference — no clone needed
  });

  test("does not mutate the original input", () => {
    const input = { document: { pages: [{ pageNumber: 1 }] } };
    const result = applyPageOffsetToDocAiJson(input, 10, 0);
    assert.equal(input.document.pages[0].pageNumber, 1); // Original unchanged
    assert.equal(result.document.pages[0].pageNumber, 11); // Copy modified
  });

  test("handles null/undefined input gracefully", () => {
    assert.equal(applyPageOffsetToDocAiJson(null, 10, 0), null);
    assert.equal(applyPageOffsetToDocAiJson(undefined, 10, 0), undefined);
  });

  test("combined page + text offset for realistic chunk scenario", () => {
    // Simulates chunk 2 (pages 16-30) with preceding text of 12000 chars + 1 separator
    const fakeChunk2 = {
      document: {
        text: "Second chunk text",
        pages: [
          { pageNumber: 1, dimension: { width: 612, height: 792 } },
        ],
        entities: [
          {
            type: "income",
            textAnchor: {
              textSegments: [{ startIndex: "0", endIndex: "17" }],
            },
            pageAnchor: {
              pageRefs: [{ page: 0, confidence: 0.98 }],
            },
          },
        ],
      },
    };

    const normalized = applyPageOffsetToDocAiJson(fakeChunk2, 15, 12001);

    // Page references normalized to global coordinates
    assert.equal(normalized.document.pages[0].pageNumber, 16);
    assert.equal(normalized.document.entities[0].pageAnchor.pageRefs[0].page, 15);

    // Text anchors normalized to global coordinates
    assert.equal(normalized.document.entities[0].textAnchor.textSegments[0].startIndex, "12001");
    assert.equal(normalized.document.entities[0].textAnchor.textSegments[0].endIndex, "12018");
  });
});

// ── Router Source Guards ─────────────────────────────────────────────────

describe("DocAI Limits Router CI Guards", () => {
  // Guard 11: Router exports isDocAiLimitsError
  test("[guard-11] Router exports isDocAiLimitsError", () => {
    const src = readRouter();
    assert.ok(
      src.includes("export function isDocAiLimitsError"),
      "isDocAiLimitsError must be exported from extractByDocType.ts",
    );
  });

  // Guard 12: Router contains extract.docai_skipped_limits event
  test("[guard-12] Router emits extract.docai_skipped_limits ledger event", () => {
    const src = readRouter();
    assert.ok(
      src.includes('"extract.docai_skipped_limits"'),
      "Router must emit extract.docai_skipped_limits event on limits fallback",
    );
  });

  // Guard 13: Router has LIMITS fallback reason (distinct from UNAVAILABLE and PAGE_LIMIT)
  test("[guard-13] Router includes fallback_reason LIMITS (distinct from UNAVAILABLE)", () => {
    const src = readRouter();
    assert.ok(
      src.includes('fallback_reason: "LIMITS"'),
      'Must include fallback_reason: "LIMITS"',
    );
    assert.ok(
      src.includes('fallback_reason: "UNAVAILABLE"'),
      'Must still include fallback_reason: "UNAVAILABLE" for availability errors',
    );
    assert.ok(
      src.includes('fallback_reason: "PAGE_LIMIT"'),
      'Must still include fallback_reason: "PAGE_LIMIT" as safety net',
    );
  });

  // Guard 14: Router calls extractWithGeminiOcr after isDocAiLimitsError check
  test("[guard-14] Router calls extractWithGeminiOcr after isDocAiLimitsError check", () => {
    const src = readRouter();
    const predicateIdx = src.indexOf("isDocAiLimitsError(error)");
    const fallbackIdx = src.indexOf("extractWithGeminiOcr(doc)", predicateIdx);
    assert.ok(
      predicateIdx > 0 && fallbackIdx > predicateIdx,
      "extractWithGeminiOcr must be called after isDocAiLimitsError check in catch block",
    );
  });

  // Guard 15: Limits check appears before page-limit check in catch block
  test("[guard-15] Limits check appears before page-limit check in catch ordering", () => {
    const src = readRouter();
    const limitsIdx = src.indexOf("isDocAiLimitsError(error)");
    const pageLimitIdx = src.indexOf("isDocAiPageLimitError(error)");
    assert.ok(
      limitsIdx > 0 && pageLimitIdx > limitsIdx,
      "isDocAiLimitsError must be checked BEFORE isDocAiPageLimitError in catch block",
    );
  });

  // Guard 16: Limits fallback does NOT mark availability cache
  test("[guard-16] Limits fallback does NOT mark DocAI as unavailable", () => {
    const src = readRouter();
    // Find the limits catch block and verify markDocAiUnavailable is NOT in it
    const limitsIdx = src.indexOf("isDocAiLimitsError(error)");
    const nextCatchIdx = src.indexOf("isDocAiPageLimitError(error)", limitsIdx);
    const limitsBlock = src.slice(limitsIdx, nextCatchIdx);
    assert.ok(
      !limitsBlock.includes("markDocAiUnavailable"),
      "Limits fallback must NOT call markDocAiUnavailable — limits are expected constraints, not outages",
    );
  });
});
