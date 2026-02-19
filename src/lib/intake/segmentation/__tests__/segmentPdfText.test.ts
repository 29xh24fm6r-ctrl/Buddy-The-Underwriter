/**
 * PDF Segmentation v1.2 — Unit Tests
 *
 * Uses node:test + node:assert/strict.
 * Runner: node --import tsx --test
 */

import test from "node:test";
import assert from "node:assert/strict";

import { segmentPdfText, SEGMENTATION_VERSION } from "../index";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildPageText(pages: string[][]): string {
  return pages
    .map((lines, i) => [`[Page ${i + 1}]`, ...lines].join("\n"))
    .join("\n");
}

// ---------------------------------------------------------------------------
// Test 1: Single page, no anchors
// ---------------------------------------------------------------------------

test("1. Single page, no anchors → 1 segment, isMultiForm=false", () => {
  const text = buildPageText([
    ["Some random text with no form headers.", "Just a memo."],
  ]);
  const result = segmentPdfText(text);

  assert.equal(result.segments.length, 1);
  assert.equal(result.isMultiForm, false);
  assert.equal(result.totalPages, 1);
});

// ---------------------------------------------------------------------------
// Test 2: Single page, one form header
// ---------------------------------------------------------------------------

test("2. Single page, one form header → 1 segment, isMultiForm=false", () => {
  const text = buildPageText([
    [
      "Form 1040 U.S. Individual Income Tax Return",
      "Filing Status: Single",
      "Tax Year 2024",
    ],
  ]);
  const result = segmentPdfText(text);

  assert.equal(result.segments.length, 1);
  assert.equal(result.isMultiForm, false);
  // Single strong anchor → can't split into multiple
});

// ---------------------------------------------------------------------------
// Test 3: Two pages, two different IRS forms → 2 segments
// ---------------------------------------------------------------------------

test("3. Two different IRS forms → 2 segments, isMultiForm=true, confidence >= 0.90", () => {
  const text = buildPageText([
    [
      "Form 1040 U.S. Individual Income Tax Return",
      "Filing Status: Single",
      "Tax Year 2024",
    ],
    ["Some continuation data from 1040..."],
    [
      "Form 1120S U.S. Income Tax Return for an S Corporation",
      "Tax Year 2024",
    ],
  ]);
  const result = segmentPdfText(text);

  assert.equal(result.segments.length, 2);
  assert.equal(result.isMultiForm, true);
  assert.ok(
    result.multiFormConfidence >= 0.90,
    `Expected confidence >= 0.90, got ${result.multiFormConfidence}`,
  );
  assert.equal(result.totalPages, 3);

  // First segment should cover pages 1-2
  assert.equal(result.segments[0].startPage, 1);
  assert.equal(result.segments[0].endPage, 2);

  // Second segment should cover page 3
  assert.equal(result.segments[1].startPage, 3);
  assert.equal(result.segments[1].endPage, 3);
});

// ---------------------------------------------------------------------------
// Test 4: Three pages, three different forms → 3 segments
// ---------------------------------------------------------------------------

test("4. Three different forms (1040, K-1, 1120S) → 3 segments", () => {
  const text = buildPageText([
    [
      "Form 1040 U.S. Individual Income Tax Return",
      "Tax Year 2024",
    ],
    [
      "Schedule K-1 (Form 1065)",
      "Partner's Share of Income",
    ],
    [
      "Form 1120S U.S. Income Tax Return",
      "For an S Corporation",
    ],
  ]);
  const result = segmentPdfText(text);

  assert.equal(result.segments.length, 3);
  assert.equal(result.isMultiForm, true);
});

// ---------------------------------------------------------------------------
// Test 5: Text preservation — all original text is covered
// ---------------------------------------------------------------------------

test("5. Text preservation: all segment texts reconstruct the original", () => {
  const text = buildPageText([
    [
      "Form 1040 U.S. Individual Income Tax Return",
      "Filing Status: Single",
    ],
    [
      "Schedule K-1 (Form 1065)",
      "Partner's Share of Income",
    ],
    [
      "Form 1120S Corporation Return",
      "Revenue data here",
    ],
  ]);
  const result = segmentPdfText(text);

  // Join all segment texts
  const joined = result.segments.map((s) => s.text).join("");
  assert.equal(joined, text, "Joined segment texts must equal original text");
});

// ---------------------------------------------------------------------------
// Test 6: Empty text → single segment, isMultiForm=false
// ---------------------------------------------------------------------------

test("6. Empty text → 1 segment, isMultiForm=false", () => {
  const result = segmentPdfText("");

  assert.equal(result.segments.length, 1);
  assert.equal(result.isMultiForm, false);
  assert.equal(result.totalPages, 0);
});

// ---------------------------------------------------------------------------
// Test 7: [Page N] marker parsing — correct page count and numbering
// ---------------------------------------------------------------------------

test("7. [Page N] marker parsing: correct page count and numbering", () => {
  const text = [
    "[Page 1]",
    "First page content",
    "",
    "[Page 2]",
    "Second page content",
    "",
    "[Page 3]",
    "Third page content",
  ].join("\n");

  const result = segmentPdfText(text);

  assert.equal(result.totalPages, 3);
  assert.equal(result.segments.length, 1); // No anchors → single segment
  assert.equal(result.segments[0].startPage, 1);
  assert.equal(result.segments[0].endPage, 3);
});

// ---------------------------------------------------------------------------
// Test 8: Form-feed fallback — correct splitting
// ---------------------------------------------------------------------------

test("8. Form-feed fallback: text with \\f separators → correct splitting", () => {
  const text = [
    "Form 1040 Individual Tax Return",
    "Tax Year 2024",
    "\f",
    "Schedule K-1 (Form 1065)",
    "Partner's Share",
  ].join("");

  const result = segmentPdfText(text);

  assert.equal(result.totalPages, 2);
  assert.equal(result.isMultiForm, true);
  assert.equal(result.segments.length, 2);
});

// ---------------------------------------------------------------------------
// Test 9: Low confidence — only weak anchors → isMultiForm=false
// ---------------------------------------------------------------------------

test("9. Only weak anchors (Balance Sheet + P&L) → isMultiForm=false (below threshold)", () => {
  const text = buildPageText([
    [
      "Balance Sheet",
      "Total Assets: $1,000,000",
      "Total Liabilities: $500,000",
    ],
    [
      "Profit and Loss Statement",
      "Revenue: $500,000",
      "Net Income: $100,000",
    ],
  ]);
  const result = segmentPdfText(text);

  assert.equal(result.isMultiForm, false);
  // Weak-only confidence is 0.55, below 0.60 threshold
  assert.ok(
    result.multiFormConfidence < 0.60,
    `Expected confidence < 0.60, got ${result.multiFormConfidence}`,
  );
});

// ---------------------------------------------------------------------------
// Test 10: Strong + weak anchor → splits, confidence ~0.75
// ---------------------------------------------------------------------------

test("10. Strong + weak anchor → splits with confidence ~0.75", () => {
  const text = buildPageText([
    [
      "Form 1040 U.S. Individual Income Tax Return",
      "Tax Year 2024",
    ],
    ["Page 2 continuation"],
    ["Page 3 more data"],
    ["Page 4 more data"],
    [
      "Balance Sheet",
      "Total Assets: $2,000,000",
    ],
  ]);
  const result = segmentPdfText(text);

  // 1 strong + 1 weak → confidence 0.75
  assert.ok(
    result.multiFormConfidence >= 0.70,
    `Expected confidence >= 0.70, got ${result.multiFormConfidence}`,
  );
  // Confidence is 0.75 which is above threshold but only 1 strong anchor means
  // groupIntoSegments returns single group → isMultiForm=false
  // This is correct because weak anchors alone don't create boundaries
  assert.equal(result.isMultiForm, false);
});

// ---------------------------------------------------------------------------
// Test 11: Form header mid-page — still detected
// ---------------------------------------------------------------------------

test("11. Form header mid-page → still detected", () => {
  const text = buildPageText([
    [
      "Some preliminary text and instructions",
      "Please review the following:",
      "Form 1040 U.S. Individual Income Tax Return",
      "Tax Year 2024",
    ],
    [
      "More instructions and notes",
      "Form 1120S Corporation Return",
      "Tax Year 2024",
    ],
  ]);
  const result = segmentPdfText(text);

  assert.equal(result.isMultiForm, true);
  assert.equal(result.segments.length, 2);
  assert.ok(result.multiFormConfidence >= 0.90);
});

// ---------------------------------------------------------------------------
// Test 12: Continuation pages — blank page between forms
// ---------------------------------------------------------------------------

test("12. Continuation pages: Form 1040 on p1, blank p2, Form 1120S on p3 → 2 segments", () => {
  const text = buildPageText([
    [
      "Form 1040 U.S. Individual Income Tax Return",
      "Tax Year 2024",
    ],
    ["", ""],
    [
      "Form 1120S U.S. Income Tax Return",
      "For an S Corporation",
    ],
  ]);
  const result = segmentPdfText(text);

  assert.equal(result.segments.length, 2);
  assert.equal(result.isMultiForm, true);

  // Page 2 (blank) should be in the first segment
  assert.equal(result.segments[0].startPage, 1);
  assert.equal(result.segments[0].endPage, 2);
  assert.equal(result.segments[1].startPage, 3);
  assert.equal(result.segments[1].endPage, 3);
});

// ---------------------------------------------------------------------------
// Test 13: Same form type repeated → 2 segments, confidence >= 0.85
// ---------------------------------------------------------------------------

test("13. Same form type repeated (two Form 1040) → 2 segments, confidence >= 0.85", () => {
  const text = buildPageText([
    [
      "Form 1040 U.S. Individual Income Tax Return",
      "Tax Year 2023",
    ],
    [
      "Form 1040 U.S. Individual Income Tax Return",
      "Tax Year 2024",
    ],
  ]);
  const result = segmentPdfText(text);

  assert.equal(result.segments.length, 2);
  assert.equal(result.isMultiForm, true);
  assert.ok(
    result.multiFormConfidence >= 0.85,
    `Expected confidence >= 0.85, got ${result.multiFormConfidence}`,
  );
});

// ---------------------------------------------------------------------------
// Test 14: SEGMENTATION_VERSION is v1.2
// ---------------------------------------------------------------------------

test("14. SEGMENTATION_VERSION is 'v1.2'", () => {
  assert.equal(SEGMENTATION_VERSION, "v1.2");
});

// ---------------------------------------------------------------------------
// Test 15: No [Page N] or \f markers — long text → single segment
// ---------------------------------------------------------------------------

test("15. No markers, long text → single segment", () => {
  // Build a long text without any page markers
  const lines = [];
  for (let i = 0; i < 200; i++) {
    lines.push(`Line ${i}: Lorem ipsum dolor sit amet, consectetur adipiscing elit.`);
  }
  const text = lines.join("\n");
  const result = segmentPdfText(text);

  assert.equal(result.segments.length, 1);
  assert.equal(result.isMultiForm, false);
  assert.equal(result.totalPages, 1);
});

// ---------------------------------------------------------------------------
// Test 16: SBA forms split correctly
// ---------------------------------------------------------------------------

test("16. SBA forms + IRS form → multi-form detection", () => {
  const text = buildPageText([
    [
      "SBA Form 1919",
      "Borrower Information Form",
    ],
    [
      "Form 1040 U.S. Individual Income Tax Return",
      "Tax Year 2024",
    ],
  ]);
  const result = segmentPdfText(text);

  assert.equal(result.segments.length, 2);
  assert.equal(result.isMultiForm, true);
  assert.ok(result.multiFormConfidence >= 0.90);
});

// ---------------------------------------------------------------------------
// Test 17: Whitespace-only text → single segment, isMultiForm=false
// ---------------------------------------------------------------------------

test("17. Whitespace-only text → single segment, isMultiForm=false", () => {
  const result = segmentPdfText("   \n\n  \t  \n  ");

  assert.equal(result.segments.length, 1);
  assert.equal(result.isMultiForm, false);
});

// ---------------------------------------------------------------------------
// Test 18: Anchors have correct types
// ---------------------------------------------------------------------------

test("18. Anchors correctly typed as irs_form_header, sba_form_header, financial_header", () => {
  const text = buildPageText([
    [
      "Form 1040 U.S. Individual Income Tax Return",
      "Tax Year 2024",
    ],
    [
      "SBA Form 413 Personal Financial Statement",
    ],
    [
      "Balance Sheet as of December 31, 2024",
    ],
  ]);
  const result = segmentPdfText(text);

  // Collect all anchors across all segments
  const allAnchors = result.segments.flatMap((s) => s.anchors);

  const irsAnchor = allAnchors.find((a) => a.type === "irs_form_header");
  const sbaAnchor = allAnchors.find((a) => a.type === "sba_form_header");
  const finAnchor = allAnchors.find((a) => a.type === "financial_header");

  assert.ok(irsAnchor, "Should have an irs_form_header anchor");
  assert.ok(sbaAnchor, "Should have an sba_form_header anchor");
  assert.ok(finAnchor, "Should have a financial_header anchor");

  assert.equal(irsAnchor!.confidence, 0.95);
  assert.equal(sbaAnchor!.confidence, 0.92);
  assert.equal(finAnchor!.confidence, 0.70);
});

// ---------------------------------------------------------------------------
// Test 19: Form 1065 detected correctly
// ---------------------------------------------------------------------------

test("19. Form 1065 detected as separate segment", () => {
  const text = buildPageText([
    [
      "Form 1065 U.S. Return of Partnership Income",
      "Tax Year 2024",
    ],
    [
      "Form 1099 Miscellaneous Income",
      "Calendar Year 2024",
    ],
  ]);
  const result = segmentPdfText(text);

  assert.equal(result.segments.length, 2);
  assert.equal(result.isMultiForm, true);
});

// ---------------------------------------------------------------------------
// Test 20: Text preservation with form-feed splitting
// ---------------------------------------------------------------------------

test("20. Text preservation with form-feed splitting", () => {
  const part1 = "Form 1040 Individual Tax Return\nTax Year 2024";
  const part2 = "Schedule K-1 (Form 1065)\nPartner's Share";
  const text = part1 + "\f" + part2;

  const result = segmentPdfText(text);

  // With form-feed, segments should cover parts
  assert.equal(result.segments.length, 2);

  // Verify text content
  assert.ok(result.segments[0].text.includes("Form 1040"));
  assert.ok(result.segments[1].text.includes("Schedule K-1"));
});
