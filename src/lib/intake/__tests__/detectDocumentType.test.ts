/**
 * detectDocumentType — Pure Function Tests
 *
 * Tests the deterministic document type detection from OCR page text.
 * Covers all canonical types, UNKNOWN fallback, segmentation detection,
 * tax year extraction, and confidence scoring behavior.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { detectDocumentType } from "@/lib/intake/detectDocumentType";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Wrap raw text into the pages array expected by detectDocumentType. */
function pages(text: string) {
  return [{ page_number: 1, full_text: text }];
}

function multiPages(...texts: string[]) {
  return texts.map((t, i) => ({ page_number: i + 1, full_text: t }));
}

// ---------------------------------------------------------------------------
// 1. BTR detection
// ---------------------------------------------------------------------------

describe("BTR detection", () => {
  test("Form 1120 triggers BUSINESS_TAX_RETURN", () => {
    const result = detectDocumentType(
      pages("Department of Treasury\nForm 1120\nU.S. Corporation Income Tax Return"),
    );
    assert.equal(result.canonical_type, "BUSINESS_TAX_RETURN");
    assert.ok(
      result.anchor_evidence.includes("BTR_FORM_MATCH"),
      "Should include BTR_FORM_MATCH evidence",
    );
  });

  test("Form 1120S triggers BUSINESS_TAX_RETURN", () => {
    const result = detectDocumentType(
      pages("Form 1120S U.S. Income Tax Return for an S Corporation"),
    );
    assert.equal(result.canonical_type, "BUSINESS_TAX_RETURN");
    assert.ok(result.anchor_evidence.includes("BTR_FORM_MATCH"));
  });

  test("Form 1065 triggers BUSINESS_TAX_RETURN", () => {
    const result = detectDocumentType(
      pages("Form 1065\nU.S. Return of Partnership Income"),
    );
    assert.equal(result.canonical_type, "BUSINESS_TAX_RETURN");
    assert.ok(result.anchor_evidence.includes("BTR_FORM_MATCH"));
  });

  test("Schedule L boosts BTR score", () => {
    const result = detectDocumentType(
      pages("Form 1120\nSchedule L\nBalance Sheets per Books"),
    );
    assert.ok(
      result.anchor_evidence.includes("SCHEDULE_L_PRESENT"),
      "Should detect Schedule L",
    );
    assert.ok(
      result.confidence_score > 0.4,
      "Score should exceed form-only score of 0.4",
    );
  });

  test("EIN boosts BTR score", () => {
    const result = detectDocumentType(
      pages("Form 1120\nEmployer ID: 12-3456789"),
    );
    assert.ok(
      result.anchor_evidence.includes("EIN_DETECTED"),
      "Should detect EIN",
    );
  });
});

// ---------------------------------------------------------------------------
// 2. PTR detection
// ---------------------------------------------------------------------------

describe("PTR detection", () => {
  test("Form 1040 triggers PERSONAL_TAX_RETURN", () => {
    const result = detectDocumentType(
      pages("Department of Treasury\nForm 1040\nU.S. Individual Income Tax Return"),
    );
    assert.equal(result.canonical_type, "PERSONAL_TAX_RETURN");
    assert.ok(result.anchor_evidence.includes("PTR_FORM_1040_MATCH"));
  });

  test("AGI keyword boosts PTR score", () => {
    const result = detectDocumentType(
      pages("Form 1040\nAdjusted Gross Income: $125,000"),
    );
    assert.ok(
      result.anchor_evidence.includes("AGI_KEYWORD"),
      "Should detect AGI keyword",
    );
    assert.ok(
      result.confidence_score > 0.4,
      "Score should exceed form-only score",
    );
  });

  test("SSN boosts PTR score", () => {
    const result = detectDocumentType(
      pages("Form 1040\nSSN: 123-45-6789"),
    );
    assert.ok(
      result.anchor_evidence.includes("SSN_DETECTED"),
      "Should detect SSN pattern",
    );
  });
});

// ---------------------------------------------------------------------------
// 3. BS detection
// ---------------------------------------------------------------------------

describe("BS detection", () => {
  test("Total Assets + Total Liabilities + Total Equity triggers BALANCE_SHEET", () => {
    const result = detectDocumentType(
      pages(
        "Balance Sheet as of December 31, 2023\n" +
          "Total Assets: $5,000,000\n" +
          "Total Liabilities: $3,200,000\n" +
          "Total Equity: $1,800,000",
      ),
    );
    assert.equal(result.canonical_type, "BALANCE_SHEET");
    assert.ok(result.anchor_evidence.includes("BS_TOTAL_ASSETS"));
    assert.ok(result.anchor_evidence.includes("BS_TOTAL_LIABILITIES"));
    assert.ok(result.anchor_evidence.includes("BS_TOTAL_EQUITY"));
  });

  test("Stockholders Equity variant is detected", () => {
    const result = detectDocumentType(
      pages(
        "Total Assets: $10M\nTotal Liabilities: $6M\nTotal Stockholders' Equity: $4M",
      ),
    );
    assert.equal(result.canonical_type, "BALANCE_SHEET");
    assert.ok(result.anchor_evidence.includes("BS_TOTAL_EQUITY"));
  });

  test("Two of three BS anchors still detect BALANCE_SHEET", () => {
    const result = detectDocumentType(
      pages("Total Assets: $5,000,000\nTotal Liabilities: $3,200,000"),
    );
    // 0.35 + 0.35 = 0.70 — well above 0.3 threshold
    assert.equal(result.canonical_type, "BALANCE_SHEET");
    assert.equal(result.confidence_score, 0.7);
  });
});

// ---------------------------------------------------------------------------
// 4. IS detection
// ---------------------------------------------------------------------------

describe("IS detection", () => {
  test("Total Revenue + Net Income triggers INCOME_STATEMENT", () => {
    const result = detectDocumentType(
      pages(
        "Income Statement for Year Ended 2023\n" +
          "Total Revenue: $2,500,000\n" +
          "Cost of Goods Sold: $1,200,000\n" +
          "Net Income: $350,000",
      ),
    );
    assert.equal(result.canonical_type, "INCOME_STATEMENT");
    assert.ok(result.anchor_evidence.includes("IS_REVENUE"));
    assert.ok(result.anchor_evidence.includes("IS_NET_INCOME"));
  });

  test("Revenue + COGS triggers INCOME_STATEMENT", () => {
    const result = detectDocumentType(
      pages("Revenue: $1,000,000\nCOGS: $400,000"),
    );
    assert.equal(result.canonical_type, "INCOME_STATEMENT");
    assert.ok(result.anchor_evidence.includes("IS_REVENUE"));
    assert.ok(result.anchor_evidence.includes("IS_COGS"));
  });

  test("Net Income alone is enough (score = 0.3, at threshold)", () => {
    const result = detectDocumentType(
      pages("Summary\nNet Income: $100,000"),
    );
    assert.equal(result.canonical_type, "INCOME_STATEMENT");
    assert.equal(result.confidence_score, 0.3);
  });
});

// ---------------------------------------------------------------------------
// 5. UNKNOWN fallback
// ---------------------------------------------------------------------------

describe("UNKNOWN fallback", () => {
  test("Random text with no anchors returns UNKNOWN", () => {
    const result = detectDocumentType(
      pages("Lorem ipsum dolor sit amet, consectetur adipiscing elit."),
    );
    assert.equal(result.canonical_type, "UNKNOWN");
    assert.equal(result.confidence_score, 0);
  });

  test("Empty pages return UNKNOWN", () => {
    const result = detectDocumentType(pages(""));
    assert.equal(result.canonical_type, "UNKNOWN");
    assert.equal(result.confidence_score, 0);
  });

  test("UNKNOWN result still has empty evidence array", () => {
    const result = detectDocumentType(
      pages("Just some random document text with no financial indicators."),
    );
    assert.equal(result.canonical_type, "UNKNOWN");
    assert.equal(result.anchor_evidence.length, 0);
  });
});

// ---------------------------------------------------------------------------
// 6. Segmentation trigger
// ---------------------------------------------------------------------------

describe("Segmentation trigger", () => {
  test("Mixed 1040 + 1120 patterns set requires_segmentation=true", () => {
    const result = detectDocumentType(
      pages(
        "Form 1040 Individual Income Tax Return\n" +
          "Page 15\n" +
          "Form 1120 U.S. Corporation Income Tax Return",
      ),
    );
    assert.equal(
      result.requires_segmentation,
      true,
      "Mixed BTR + PTR form anchors should trigger segmentation",
    );
  });

  test("Form 1120 + Form W-2 triggers segmentation", () => {
    const result = detectDocumentType(
      pages("Form 1120\nAttached: Form W-2 Wage and Tax Statement"),
    );
    assert.equal(
      result.requires_segmentation,
      true,
      "BTR anchor + W-2 should trigger segmentation",
    );
  });

  test("Single form type does not trigger segmentation", () => {
    const result = detectDocumentType(
      pages("Form 1120\nSchedule L\nBalance Sheets per Books"),
    );
    assert.equal(
      result.requires_segmentation,
      false,
      "Single BTR form should not trigger segmentation",
    );
  });

  test("PTR alone does not trigger segmentation", () => {
    const result = detectDocumentType(
      pages("Form 1040\nAdjusted Gross Income\n123-45-6789"),
    );
    assert.equal(
      result.requires_segmentation,
      false,
      "Single PTR form should not trigger segmentation",
    );
  });
});

// ---------------------------------------------------------------------------
// 7. Tax year detection
// ---------------------------------------------------------------------------

describe("Tax year detection", () => {
  test("Explicit 'Tax Year 2023' extracts detected_tax_year=2023", () => {
    const result = detectDocumentType(
      pages("Form 1120\nTax Year 2023\nU.S. Corporation Income Tax Return"),
    );
    assert.equal(result.detected_tax_year, 2023);
  });

  test("'Taxable Year 2024' extracts detected_tax_year=2024", () => {
    const result = detectDocumentType(
      pages("Form 1040\nTaxable Year 2024"),
    );
    assert.equal(result.detected_tax_year, 2024);
  });

  test("'For the Calendar Year Ending December 31, 2022' extracts 2022", () => {
    const result = detectDocumentType(
      pages("Form 1065\nFor the Calendar Year Ending December 31, 2022"),
    );
    assert.equal(result.detected_tax_year, 2022);
  });

  test("Header year fallback extracts year from first 500 chars", () => {
    const result = detectDocumentType(
      pages("Financial Statement 2023\nTotal Assets: $1,000,000\nTotal Liabilities: $500,000"),
    );
    assert.equal(result.detected_tax_year, 2023);
  });

  test("No year returns null", () => {
    const result = detectDocumentType(
      pages("Form 1120\nSome corporation return without a year"),
    );
    assert.equal(result.detected_tax_year, null);
  });

  test("Multiple years in header returns the most recent", () => {
    const result = detectDocumentType(
      pages("Balance Sheet\n2021 2022 2023\nTotal Assets: $5M\nTotal Liabilities: $3M"),
    );
    assert.equal(result.detected_tax_year, 2023);
  });
});

// ---------------------------------------------------------------------------
// 8. Confidence scoring
// ---------------------------------------------------------------------------

describe("Confidence scoring", () => {
  test("BTR with Form 1120 + EIN has higher confidence than Form 1120 alone", () => {
    const formOnly = detectDocumentType(
      pages("Form 1120\nU.S. Corporation Income Tax Return"),
    );
    const formPlusEin = detectDocumentType(
      pages("Form 1120\nEmployer ID: 12-3456789\nU.S. Corporation Income Tax Return"),
    );

    assert.ok(
      formPlusEin.confidence_score > formOnly.confidence_score,
      `Form+EIN score (${formPlusEin.confidence_score}) should exceed form-only score (${formOnly.confidence_score})`,
    );
  });

  test("BTR with all three anchors has highest BTR confidence", () => {
    const result = detectDocumentType(
      pages("Form 1120\nEmployer ID: 12-3456789\nSchedule L\nBalance Sheets"),
    );
    // 0.4 (form) + 0.3 (schedule L) + 0.2 (EIN) = 0.9
    assert.ok(
      Math.abs(result.confidence_score - 0.9) < 1e-10,
      `Expected ~0.9, got ${result.confidence_score}`,
    );
    assert.equal(result.canonical_type, "BUSINESS_TAX_RETURN");
  });

  test("PTR with all three anchors scores 0.9", () => {
    const result = detectDocumentType(
      pages("Form 1040\n123-45-6789\nAdjusted Gross Income: $80,000"),
    );
    // 0.4 (form) + 0.3 (AGI) + 0.2 (SSN) = 0.9
    assert.ok(
      Math.abs(result.confidence_score - 0.9) < 1e-10,
      `Expected ~0.9, got ${result.confidence_score}`,
    );
    assert.equal(result.canonical_type, "PERSONAL_TAX_RETURN");
  });

  test("BS with all three anchors scores 1.0 (capped)", () => {
    const result = detectDocumentType(
      pages("Total Assets: $5M\nTotal Liabilities: $3M\nTotal Equity: $2M"),
    );
    // 0.35 + 0.35 + 0.3 = 1.0
    assert.equal(result.confidence_score, 1.0);
    assert.equal(result.canonical_type, "BALANCE_SHEET");
  });

  test("IS with all three anchors scores 1.0 (capped)", () => {
    const result = detectDocumentType(
      pages("Revenue: $2M\nCost of Goods Sold: $1M\nNet Income: $500K"),
    );
    // 0.35 + 0.35 + 0.3 = 1.0
    assert.equal(result.confidence_score, 1.0);
    assert.equal(result.canonical_type, "INCOME_STATEMENT");
  });

  test("UNKNOWN always has confidence_score=0", () => {
    const result = detectDocumentType(
      pages("Nothing relevant here at all"),
    );
    assert.equal(result.confidence_score, 0);
    assert.equal(result.canonical_type, "UNKNOWN");
  });

  test("Confidence is capped at 1.0 even with overlapping evidence", () => {
    // BS anchors in a doc that also has IS anchors — winner score is capped
    const result = detectDocumentType(
      pages(
        "Total Assets: $5M\nTotal Liabilities: $3M\nTotal Equity: $2M\n" +
          "Revenue: $2M\nCost of Goods Sold: $1M\nNet Income: $500K",
      ),
    );
    assert.ok(result.confidence_score <= 1.0, "Score must not exceed 1.0");
  });
});

// ---------------------------------------------------------------------------
// Multi-page support
// ---------------------------------------------------------------------------

describe("Multi-page support", () => {
  test("Anchors across multiple pages are detected", () => {
    const result = detectDocumentType(
      multiPages(
        "Form 1120\nU.S. Corporation Income Tax Return",
        "Schedule L\nBalance Sheets per Books",
        "Additional schedules\nEIN: 12-3456789",
      ),
    );
    assert.equal(result.canonical_type, "BUSINESS_TAX_RETURN");
    assert.ok(result.anchor_evidence.includes("BTR_FORM_MATCH"));
    assert.ok(result.anchor_evidence.includes("SCHEDULE_L_PRESENT"));
    // EIN on page 3 may or may not be in headerText (first 5000 chars)
    // but Schedule L checks fullText so it should be found
  });
});
