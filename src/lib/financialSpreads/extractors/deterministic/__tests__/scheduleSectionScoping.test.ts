import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { extractScheduleM1, sliceScheduleSection } from "../scheduleM1Deterministic";
import { extractK1 } from "../k1Deterministic";

const args = (ocrText: string) =>
  ({ dealId: "d", bankId: "b", documentId: "x", ocrText, structuredJson: null, docYear: 2025 }) as any;

// Shape of the Gemini OCR for a full 1120-S package: page-1 lines, Schedule K
// cross-reference tables, then the M-1 / M-2 pages.
const PACKAGE = `[Page 1]
Form 1120-S
| 1c Balance | 3 | 997,082 |
| 13 Interest (see instructions) | 13 | 1,004 |
Schedule K, Line 2 ... amortization schedule 2025
| Income (loss) reconciliation (Schedule K, Line 18) | 115,533 |
Schedule L
| Assets | 63,354 | 112,327 | Schedule M-1 | 115,533 |
[Page 7]
Schedule M-1 Reconciliation of Income (Loss) per Books With Income (Loss) per Return
| 1 Net income (loss) per books | 1 | 106,319 |
| 2 Income included on Schedule K, lines 1, 2, 3c, 4, 5a, 6, 7, 8a, 9, and 10, not recorded on books this year | 2 |   |
| a Depreciation | 3a | 11,267 |
| 8 Income (loss) (Schedule K, line 18). Line 4 less line 7 | 8 | 115,533 |
Schedule M-2 Analysis of Accumulated Adjustments Account
| 1 Balance at beginning of tax year | 1 | 41,511 |
| 7 Distributions | 7 | 150,749 |
| 8 Balance at end of tax year | 8 | 51,075 |
[Page 8]
Filing instructions: amortization 2025`;

describe("sliceScheduleSection", () => {
  it("skips cross-reference mentions and returns the schedule body", () => {
    const m1 = sliceScheduleSection(PACKAGE, "M-1");
    assert.ok(m1);
    assert.ok(m1.includes("Net income (loss) per books"));
    assert.ok(!m1.includes("Balance at beginning"), "M-1 slice must stop at the M-2 heading");
    assert.ok(!m1.includes("1c Balance"), "M-1 slice must not include page 1");
    const m2 = sliceScheduleSection(PACKAGE, "M-2");
    assert.ok(m2);
    assert.ok(m2.includes("Distributions"));
    assert.ok(!m2.includes("Filing instructions"), "M-2 slice must stop at the page break");
  });

  it("returns null when the document has no such schedule", () => {
    assert.equal(sliceScheduleSection("Form 1040\nWages | 47,267", "M-1"), null);
  });
});

describe("extractScheduleM1 on a full package", () => {
  it("does not latch onto page-1 lines or filing instructions", () => {
    const r = extractScheduleM1(args(PACKAGE));
    const byKey = new Map(r.items.map((i) => [i.key, i.value]));
    assert.equal(byKey.get("M1_BOOK_INCOME"), 106_319);
    assert.equal(byKey.get("M1_DEPR_BOOK_TAX_DIFF"), 11_267);
    assert.equal(byKey.get("M2_RETAINED_EARNINGS_BEGIN"), 41_511);
    assert.equal(byKey.get("M2_DISTRIBUTIONS"), 150_749);
    assert.equal(byKey.get("M2_RETAINED_EARNINGS_END"), 51_075);
    // Previously: "line 2" → 997,082 (page-1 total income), amortization → 2025.
    assert.notEqual(byKey.get("M1_FEDERAL_TAX_BOOK"), 997_082);
    assert.notEqual(byKey.get("M1_AMORT_BOOK_TAX_DIFF"), 2025);
  });

  it("still works on a single-schedule fixture without headings", () => {
    const r = extractScheduleM1(args("Net income per books 155,811\nDistributions 119,241"));
    const byKey = new Map(r.items.map((i) => [i.key, i.value]));
    assert.equal(byKey.get("M1_BOOK_INCOME"), 155_811);
    assert.equal(byKey.get("M2_DISTRIBUTIONS"), 119_241);
  });
});

describe("extractK1 with blank boxes", () => {
  it("does not report the box number as the box value", () => {
    const k1 = `Schedule K-1 (Form 1120-S) 2025
|  Ordinary business income (loss) | 1 | 133,679  |
|  Net rental real estate income (loss) | 2 |   |
|  Other net rental income (loss) | 3 |   |
|  Interest income | 4 |   |
|  Royalties | 6 |   |
|  Net section 1231 gain (loss) | 9 |   |
|  Section 179 deduction | 11 |   |
|  Distributions | 16 | 150,749  |`;
    const r = extractK1(args(k1));
    const keys = new Set(r.items.map((i) => i.key));
    assert.equal(r.items.find((i) => i.key === "K1_ORDINARY_INCOME")?.value, 133_679);
    assert.equal(r.items.find((i) => i.key === "K1_CASH_DISTRIBUTIONS")?.value, 150_749);
    for (const blank of ["K1_RENTAL_RE_INCOME", "K1_OTHER_RENTAL", "K1_INTEREST_INCOME", "K1_ROYALTIES", "K1_1231_GAIN", "K1_SEC179_DEDUCTION"]) {
      assert.ok(!keys.has(blank), `${blank} must not be emitted from a blank box`);
    }
  });
});
