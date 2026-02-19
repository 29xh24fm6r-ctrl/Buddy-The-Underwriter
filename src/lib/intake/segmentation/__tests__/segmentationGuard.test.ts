/**
 * Segmentation Engine — CI-Blocking Governance Invariants (Phase A)
 *
 * 9 guards that protect core segmentation safety properties:
 *   1. Form W-2 is a STRONG anchor (detected as strong via behavior)
 *   2. Distinct strong forms (1040 + 1120) → isMultiForm=true, confidence ≥ 0.85
 *   3. Weak-only anchors (P&L + Balance Sheet) → isMultiForm=false (never auto-split)
 *   4. 1 strong + 1 weak → isMultiForm=false (single boundary → single group)
 *   5. Single-form PDF → isMultiForm=false
 *   6. Page coverage invariant: sum(segment pages) === totalPages
 *   7. SEGMENTATION_VERSION === "v1.2"
 *   8. segmentPdfText is idempotent (pure function invariant)
 *   9. isSegmentationEngineEnabled() → false when env var absent
 *
 * Pure function tests — no DB, no IO, no server-only imports.
 * Imports only from segmentPdfText.ts, types.ts, and flags/segmentationEngine.ts.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { segmentPdfText } from "../segmentPdfText";
import { SEGMENTATION_VERSION } from "../types";
import { isSegmentationEngineEnabled } from "../../../flags/segmentationEngine";

// ---------------------------------------------------------------------------
// Helpers — build [Page N] marker text
// ---------------------------------------------------------------------------

function page(n: number, content: string): string {
  return `[Page ${n}]\n${content}\n`;
}

// ---------------------------------------------------------------------------
// Guard 1: Form W-2 is treated as a STRONG anchor (confidence ≥ 0.90)
//          Verified by behavior: "Form 1040" + "Form W-2" on separate pages
//          produce isMultiForm=true with multiFormConfidence ≥ 0.85
// ---------------------------------------------------------------------------

test("Guard 1: Form W-2 is a STRONG anchor — 1040+W-2 bundle detected as multi-form", () => {
  const text =
    page(1, "Form 1040 U.S. Individual Income Tax Return\nTaxable income 50000") +
    page(2, "Form W-2 Wage and Tax Statement\nWages 80000 Federal income tax withheld 12000");

  const result = segmentPdfText(text);

  assert.ok(
    result.isMultiForm,
    "1040 + W-2 on separate pages must detect as multi-form",
  );
  assert.ok(
    result.multiFormConfidence >= 0.85,
    `W-2 is STRONG anchor — confidence must be ≥ 0.85, got ${result.multiFormConfidence}`,
  );

  const allAnchors = result.segments.flatMap((s) => s.anchors);
  const w2Anchor = allAnchors.find(
    (a) =>
      a.matchedText.match(/W-?2/i) &&
      a.confidence >= 0.90,
  );
  assert.ok(
    w2Anchor !== undefined,
    "W-2 anchor must be detected with confidence ≥ 0.90",
  );

  console.log(
    `[segmentationGuard] Guard 1: W-2 STRONG anchor detected (confidence=${w2Anchor.confidence}) ✓`,
  );
});

// ---------------------------------------------------------------------------
// Guard 2: Distinct strong forms (Form 1040 + Form 1120) → isMultiForm=true,
//          multiFormConfidence ≥ 0.85 (the physical split threshold)
// ---------------------------------------------------------------------------

test("Guard 2: Form 1040 + Form 1120 on separate pages → isMultiForm=true, confidence ≥ 0.85", () => {
  const text =
    page(1, "Form 1040 U.S. Individual Income Tax Return\nAdjusted gross income 95000") +
    page(2, "Form 1120 U.S. Corporation Income Tax Return\nTotal assets 500000 Net income 75000");

  const result = segmentPdfText(text);

  assert.ok(
    result.isMultiForm,
    "Form 1040 + Form 1120 must be detected as multi-form",
  );
  assert.ok(
    result.multiFormConfidence >= 0.85,
    `Confidence must be ≥ 0.85 for physical split eligibility, got ${result.multiFormConfidence}`,
  );
  assert.strictEqual(result.segments.length, 2, "Must produce exactly 2 segments");
  assert.strictEqual(result.totalPages, 2, "Total pages must be 2");

  console.log(
    `[segmentationGuard] Guard 2: 1040+1120 multi-form detected (confidence=${result.multiFormConfidence}, segments=${result.segments.length}) ✓`,
  );
});

// ---------------------------------------------------------------------------
// Guard 3: P&L + Balance Sheet (WEAK anchors only) → isMultiForm=false
//          Financial statements are structurally coupled — MUST NEVER auto-split.
//          This is CI-blocking: a regression here means financial data could be
//          incorrectly fragmented.
// ---------------------------------------------------------------------------

test("Guard 3: P&L + Balance Sheet (WEAK only) → isMultiForm=false (no split)", () => {
  const text =
    page(1, "Profit and Loss Statement\nRevenue 1000000 Expenses 750000 Net Income 250000") +
    page(2, "Balance Sheet\nTotal Assets 2000000 Total Liabilities 1200000 Equity 800000");

  const result = segmentPdfText(text);

  assert.strictEqual(
    result.isMultiForm,
    false,
    "P&L + Balance Sheet (WEAK anchors) must NEVER trigger multi-form detection",
  );
  assert.ok(
    result.multiFormConfidence < 0.85,
    `Confidence must be below 0.85, got ${result.multiFormConfidence}`,
  );

  console.log(
    `[segmentationGuard] Guard 3: P&L+BS WEAK-only → isMultiForm=false (confidence=${result.multiFormConfidence}) ✓`,
  );
});

// ---------------------------------------------------------------------------
// Guard 4: 1 strong anchor + 1 weak anchor → isMultiForm=false
//          Single strong boundary → single group, no split possible.
//          Confidence may be ≥ MULTI_FORM_THRESHOLD but groups=1 → safe.
// ---------------------------------------------------------------------------

test("Guard 4: 1 strong anchor (Form 1040) + 1 weak anchor (Balance Sheet) → isMultiForm=false", () => {
  const text =
    page(1, "Form 1040 U.S. Individual Income Tax Return\nTotal income 85000") +
    page(2, "Balance Sheet\nTotal Assets 500000 Total Equity 300000");

  const result = segmentPdfText(text);

  assert.strictEqual(
    result.isMultiForm,
    false,
    "1 strong + 1 weak: single strong boundary → groups=1 → isMultiForm=false",
  );
  assert.strictEqual(
    result.segments.length,
    1,
    "Single group must produce exactly 1 segment",
  );

  console.log(
    `[segmentationGuard] Guard 4: 1 strong + 1 weak → single group, isMultiForm=false ✓`,
  );
});

// ---------------------------------------------------------------------------
// Guard 5: Single-form PDF → isMultiForm=false
// ---------------------------------------------------------------------------

test("Guard 5: Single-form PDF → isMultiForm=false", () => {
  const text =
    page(1, "Form 1040 U.S. Individual Income Tax Return") +
    page(2, "Schedule A Itemized Deductions\nMedical expenses 5000") +
    page(3, "Schedule B Interest and Ordinary Dividends\nDividends received 2500");

  const result = segmentPdfText(text);

  assert.strictEqual(
    result.isMultiForm,
    false,
    "Single-form PDF (1040 with schedules, no second form boundary) must not be multi-form",
  );
  assert.strictEqual(result.segments.length, 1, "Single-form must produce exactly 1 segment");

  console.log(`[segmentationGuard] Guard 5: Single-form → isMultiForm=false ✓`);
});

// ---------------------------------------------------------------------------
// Guard 6: Page coverage invariant
//          Sum of (endPage - startPage + 1) across all segments === totalPages
// ---------------------------------------------------------------------------

test("Guard 6: Page coverage invariant — sum of segment page counts equals totalPages", () => {
  const text =
    page(1, "Form 1040 U.S. Individual Income Tax Return\nAdjusted gross income 70000") +
    page(2, "Continuation of Form 1040\nAdditional schedules") +
    page(3, "Form 1120 U.S. Corporation Income Tax Return\nTotal assets 800000") +
    page(4, "Continuation of Form 1120\nDeductions schedule");

  const result = segmentPdfText(text);

  assert.ok(result.isMultiForm, "4-page 1040+1120 bundle must be multi-form");

  let sumPages = 0;
  for (const seg of result.segments) {
    sumPages += seg.endPage - seg.startPage + 1;
  }

  assert.strictEqual(
    sumPages,
    result.totalPages,
    `Page coverage gap: sumPages=${sumPages} but totalPages=${result.totalPages}`,
  );

  console.log(
    `[segmentationGuard] Guard 6: Page coverage invariant holds (${sumPages}/${result.totalPages}) ✓`,
  );
});

// ---------------------------------------------------------------------------
// Guard 7: SEGMENTATION_VERSION === "v1.2"
// ---------------------------------------------------------------------------

test("Guard 7: SEGMENTATION_VERSION === \"v1.2\"", () => {
  assert.strictEqual(
    SEGMENTATION_VERSION,
    "v1.2",
    `SEGMENTATION_VERSION must be "v1.2", got "${SEGMENTATION_VERSION}"`,
  );

  console.log(`[segmentationGuard] Guard 7: SEGMENTATION_VERSION="${SEGMENTATION_VERSION}" ✓`);
});

// ---------------------------------------------------------------------------
// Guard 8: segmentPdfText is idempotent — calling it twice on the same input
//          produces structurally identical results (pure function invariant).
// ---------------------------------------------------------------------------

test("Guard 8: segmentPdfText is idempotent — identical input → identical output", () => {
  const text =
    page(1, "Form 1065 U.S. Return of Partnership Income\nPartner distributions 120000") +
    page(2, "Schedule K-1 Partner's Share of Income\nOrdinary income 40000");

  const r1 = segmentPdfText(text);
  const r2 = segmentPdfText(text);

  assert.strictEqual(
    r1.isMultiForm,
    r2.isMultiForm,
    "isMultiForm must be identical on second call",
  );
  assert.strictEqual(
    r1.multiFormConfidence,
    r2.multiFormConfidence,
    "multiFormConfidence must be identical on second call",
  );
  assert.strictEqual(
    r1.segments.length,
    r2.segments.length,
    "segment count must be identical on second call",
  );
  assert.strictEqual(
    r1.totalPages,
    r2.totalPages,
    "totalPages must be identical on second call",
  );

  for (let i = 0; i < r1.segments.length; i++) {
    assert.strictEqual(r1.segments[i].startPage, r2.segments[i].startPage);
    assert.strictEqual(r1.segments[i].endPage, r2.segments[i].endPage);
    assert.strictEqual(r1.segments[i].text, r2.segments[i].text);
  }

  console.log(
    `[segmentationGuard] Guard 8: segmentPdfText idempotent (isMultiForm=${r1.isMultiForm}, segments=${r1.segments.length}) ✓`,
  );
});

// ---------------------------------------------------------------------------
// Guard 9: isSegmentationEngineEnabled() → false when env var absent/off
//          Physical splitting must NEVER activate without explicit opt-in.
// ---------------------------------------------------------------------------

test("Guard 9: ENABLE_SEGMENTATION_ENGINE absent/off → isSegmentationEngineEnabled()=false", () => {
  const originalVal = process.env.ENABLE_SEGMENTATION_ENGINE;

  // Test: env var absent
  delete process.env.ENABLE_SEGMENTATION_ENGINE;
  assert.strictEqual(
    isSegmentationEngineEnabled(),
    false,
    "Flag must be false when ENABLE_SEGMENTATION_ENGINE is not set",
  );

  // Test: env var set to "false"
  process.env.ENABLE_SEGMENTATION_ENGINE = "false";
  assert.strictEqual(
    isSegmentationEngineEnabled(),
    false,
    "Flag must be false when ENABLE_SEGMENTATION_ENGINE=false",
  );

  // Test: env var set to "0"
  process.env.ENABLE_SEGMENTATION_ENGINE = "0";
  assert.strictEqual(
    isSegmentationEngineEnabled(),
    false,
    "Flag must be false when ENABLE_SEGMENTATION_ENGINE=0",
  );

  // Test: env var set to "true" (must be true)
  process.env.ENABLE_SEGMENTATION_ENGINE = "true";
  assert.strictEqual(
    isSegmentationEngineEnabled(),
    true,
    "Flag must be true when ENABLE_SEGMENTATION_ENGINE=true",
  );

  // Restore original value
  if (originalVal === undefined) {
    delete process.env.ENABLE_SEGMENTATION_ENGINE;
  } else {
    process.env.ENABLE_SEGMENTATION_ENGINE = originalVal;
  }

  console.log(`[segmentationGuard] Guard 9: Feature flag correctly gated ✓`);
});
