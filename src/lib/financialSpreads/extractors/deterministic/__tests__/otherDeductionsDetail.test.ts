/**
 * SPEC-TAX-RETURN-OTHER-DEDUCTIONS-STATEMENT-SPREADING-2 — Extractor Tests
 *
 * Tests:
 * 1. Extracts line items from OCR text
 * 2. Normalizes labels into correct categories
 * 3. Computes summary totals correctly
 * 4. High-risk category detection (consulting, management fees, related-party)
 * 5. Handles missing statement gracefully
 * 6. Label alias normalization covers common patterns
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { extractOtherDeductionsDetail } from "../otherDeductionsDetailDeterministic";

function makeArgs(ocrText: string) {
  return {
    dealId: "deal-1",
    bankId: "bank-1",
    documentId: "doc-1",
    ocrText,
    structuredJson: undefined,
  } as any;
}

describe("extractOtherDeductionsDetail", () => {

  it("extracts line items from typical OCR statement", () => {
    const ocr = `
Other Deductions Statement

Consulting fees                   300,000
Management fees                   200,000
Insurance premiums                150,000
Legal and professional            100,000
Travel and auto                    50,000
Meals and entertainment            25,000
Charitable contributions           15,000
Miscellaneous expenses             10,000

Total other deductions            850,000
    `;
    const result = extractOtherDeductionsDetail(makeArgs(ocr));
    assert.ok(result.ok, "Should extract items");
    assert.ok(result.items.length > 5, `Should extract multiple items, got ${result.items.length}`);
  });

  it("normalizes labels into correct OD categories", () => {
    const ocr = `
Other Deductions

Consulting fees                   300,000
Management advisory fee           200,000
Insurance                         100,000
    `;
    const result = extractOtherDeductionsDetail(makeArgs(ocr));
    const keys = result.items.map((i) => i.key);

    assert.ok(keys.includes("OD_DETAIL_CONSULTING"), "consulting → OD_DETAIL_CONSULTING");
    assert.ok(keys.includes("OD_DETAIL_MANAGEMENT_FEES"), "management advisory → OD_DETAIL_MANAGEMENT_FEES");
    assert.ok(keys.includes("OD_DETAIL_INSURANCE"), "insurance → OD_DETAIL_INSURANCE");
  });

  it("computes summary totals correctly", () => {
    const ocr = `
Other Deductions

Consulting                        300,000
Insurance                         200,000
Travel                            100,000

Total                             600,000
    `;
    const result = extractOtherDeductionsDetail(makeArgs(ocr));
    const totalItem = result.items.find((i) => i.key === "OD_DETAIL_TOTAL");
    assert.ok(totalItem, "Must emit OD_DETAIL_TOTAL");
    assert.equal(totalItem.value, 600_000, "Total should be sum of extracted lines");
  });

  it("detects high-risk categories (related-party, management)", () => {
    const ocr = `
Other Deductions Statement

Related party payments            500,000
Management fees                   200,000
Insurance                          50,000

Total                             750,000
    `;
    const result = extractOtherDeductionsDetail(makeArgs(ocr));
    const relatedTotal = result.items.find((i) => i.key === "OD_DETAIL_RELATED_PARTY_TOTAL");
    assert.ok(relatedTotal, "Must emit related-party total");
    assert.equal(relatedTotal.value, 700_000, "Related party total = related_party + management_fees");
  });

  it("computes potential add-back total", () => {
    const ocr = `
Other Deductions

Officer compensation excess       100,000
Meals and entertainment            50,000
Charitable donations               25,000
Insurance                          75,000

Total                             250,000
    `;
    const result = extractOtherDeductionsDetail(makeArgs(ocr));
    const addback = result.items.find((i) => i.key === "OD_DETAIL_POTENTIAL_ADDBACK_TOTAL");
    assert.ok(addback, "Must emit add-back total");
    // Officer comp + meals + charitable = 175,000. Insurance is NOT an add-back.
    assert.equal(addback.value, 175_000, "Add-back = officer_comp + meals + charitable");
  });

  it("returns ok:false when no lines can be extracted", () => {
    const result = extractOtherDeductionsDetail(makeArgs("This is a random page with no line items."));
    assert.equal(result.ok, false, "Should return ok:false when no lines found");
    assert.equal(result.items.length, 0);
  });

  it("normalizes various label aliases", () => {
    const ocr = `
Other Deductions

Attorney fees                     10,000
CPA fees                          15,000
Janitorial services               5,000
Bad debt expense                  20,000
One-time settlement               30,000
Vehicle expense                   8,000
    `;
    const result = extractOtherDeductionsDetail(makeArgs(ocr));
    const keys = result.items.map((i) => i.key);

    assert.ok(keys.includes("OD_DETAIL_LEGAL_PROFESSIONAL"), "attorney → LEGAL_PROFESSIONAL");
    assert.ok(keys.includes("OD_DETAIL_ACCOUNTING"), "CPA → ACCOUNTING");
    assert.ok(keys.includes("OD_DETAIL_REPAIRS_MAINTENANCE"), "janitorial → REPAIRS_MAINTENANCE");
    assert.ok(keys.includes("OD_DETAIL_BAD_DEBT"), "bad debt → BAD_DEBT");
    assert.ok(keys.includes("OD_DETAIL_NON_RECURRING_OR_UNUSUAL"), "settlement → NON_RECURRING_OR_UNUSUAL");
    assert.ok(keys.includes("OD_DETAIL_TRAVEL_AUTO"), "vehicle → TRAVEL_AUTO");
  });
});
