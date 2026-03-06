import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { extractW2 } from "../w2Deterministic";
import { extractForm1099 } from "../form1099Deterministic";
import type { DeterministicExtractorArgs } from "../types";

const baseArgs: Omit<DeterministicExtractorArgs, "ocrText"> = {
  dealId: "d1",
  bankId: "b1",
  documentId: "doc1",
};

// ---------------------------------------------------------------------------
// W-2 Extractor
// ---------------------------------------------------------------------------

describe("W-2 Deterministic Extractor", () => {
  const W2_OCR = `
Form W-2 Wage and Tax Statement
Tax Year 2023

Employer's name: ACME Corp, Inc.
Employee's name: Jane B. Doe
SSN: ***-**-7890

Box 1  Wages, tips, other compensation  $125,000.00
Box 2  Federal income tax withheld  $28,500
Box 3  Social Security wages  $125,000
Box 4  Social Security tax withheld  $7,750
Box 5  Medicare wages  $125,000
Box 6  Medicare tax withheld  $1,812.50
Box 12a  Code D  $19,500
  `;

  it("extracts wages from Box 1", () => {
    const result = extractW2({ ...baseArgs, ocrText: W2_OCR });
    assert.ok(result.ok);
    const item = result.items.find((i) => i.key === "W2_WAGES");
    assert.ok(item);
    assert.equal(item.value, 125000);
  });

  it("extracts federal tax withheld", () => {
    const result = extractW2({ ...baseArgs, ocrText: W2_OCR });
    const item = result.items.find((i) => i.key === "W2_FED_TAX_WITHHELD");
    assert.ok(item);
    assert.equal(item.value, 28500);
  });

  it("extracts Social Security wages and tax", () => {
    const result = extractW2({ ...baseArgs, ocrText: W2_OCR });
    const ssWages = result.items.find((i) => i.key === "W2_SS_WAGES");
    const ssTax = result.items.find((i) => i.key === "W2_SS_TAX");
    assert.ok(ssWages);
    assert.equal(ssWages.value, 125000);
    assert.ok(ssTax);
    assert.equal(ssTax.value, 7750);
  });

  it("extracts employer name", () => {
    const result = extractW2({ ...baseArgs, ocrText: W2_OCR });
    const item = result.items.find((i) => i.key === "W2_EMPLOYER_NAME");
    assert.ok(item);
    assert.ok(item.snippet?.includes("ACME Corp"));
  });

  it("extracts employee name", () => {
    const result = extractW2({ ...baseArgs, ocrText: W2_OCR });
    const item = result.items.find((i) => i.key === "W2_EMPLOYEE_NAME");
    assert.ok(item);
    assert.ok(item.snippet?.includes("Jane B. Doe"));
  });

  it("extracts SSN last 4", () => {
    const result = extractW2({ ...baseArgs, ocrText: W2_OCR });
    const item = result.items.find((i) => i.key === "W2_SSN_LAST4");
    assert.ok(item);
    assert.equal(item.snippet, "7890");
  });

  it("resolves tax year", () => {
    const result = extractW2({ ...baseArgs, ocrText: W2_OCR });
    const item = result.items.find((i) => i.key === "W2_WAGES");
    assert.equal(item?.period, "2023");
  });

  it("returns ok=false for empty text", () => {
    const result = extractW2({ ...baseArgs, ocrText: "no W-2 data" });
    assert.equal(result.ok, false);
  });
});

// ---------------------------------------------------------------------------
// 1099-NEC Extractor
// ---------------------------------------------------------------------------

describe("1099-NEC Deterministic Extractor", () => {
  const NEC_OCR = `
Form 1099-NEC
Nonemployee Compensation
Tax Year 2023

Box 1  Nonemployee compensation  $87,500
  `;

  it("extracts nonemployee compensation", () => {
    const result = extractForm1099({ ...baseArgs, ocrText: NEC_OCR });
    assert.ok(result.ok);
    const item = result.items.find((i) => i.key === "F1099NEC_NONEMPLOYEE_COMP");
    assert.ok(item);
    assert.equal(item.value, 87500);
  });
});

// ---------------------------------------------------------------------------
// 1099-INT Extractor
// ---------------------------------------------------------------------------

describe("1099-INT Deterministic Extractor", () => {
  const INT_OCR = `
Form 1099-INT
Interest Income
Tax Year 2023

Box 1  Interest income  $3,450.22
Box 8  Tax-exempt interest  $1,200
  `;

  it("extracts interest income", () => {
    const result = extractForm1099({ ...baseArgs, ocrText: INT_OCR });
    assert.ok(result.ok);
    const item = result.items.find((i) => i.key === "F1099INT_INTEREST");
    assert.ok(item);
    assert.equal(item.value, 3450.22);
  });

  it("extracts tax-exempt interest", () => {
    const result = extractForm1099({ ...baseArgs, ocrText: INT_OCR });
    const item = result.items.find((i) => i.key === "F1099INT_TAX_EXEMPT");
    assert.ok(item);
    assert.equal(item.value, 1200);
  });
});

// ---------------------------------------------------------------------------
// 1099-DIV Extractor
// ---------------------------------------------------------------------------

describe("1099-DIV Deterministic Extractor", () => {
  const DIV_OCR = `
Form 1099-DIV
Dividends and Distributions
Tax Year 2023

Box 1a  Total ordinary dividends  $5,200
Box 1b  Qualified dividends  $4,800
Box 2a  Total capital gain distributions  $1,100
  `;

  it("extracts ordinary dividends", () => {
    const result = extractForm1099({ ...baseArgs, ocrText: DIV_OCR });
    assert.ok(result.ok);
    const item = result.items.find((i) => i.key === "F1099DIV_ORDINARY");
    assert.ok(item);
    assert.equal(item.value, 5200);
  });

  it("extracts qualified dividends", () => {
    const result = extractForm1099({ ...baseArgs, ocrText: DIV_OCR });
    const item = result.items.find((i) => i.key === "F1099DIV_QUALIFIED");
    assert.ok(item);
    assert.equal(item.value, 4800);
  });
});

// ---------------------------------------------------------------------------
// 1099-R Extractor
// ---------------------------------------------------------------------------

describe("1099-R Deterministic Extractor", () => {
  const R_OCR = `
Form 1099-R
Distributions From Pensions, Annuities, Retirement
Tax Year 2023

Box 1  Gross distribution  $45,000
Box 2a  Taxable amount  $45,000
Box 7  Distribution code  7
  `;

  it("extracts gross distribution", () => {
    const result = extractForm1099({ ...baseArgs, ocrText: R_OCR });
    assert.ok(result.ok);
    const item = result.items.find((i) => i.key === "F1099R_GROSS_DISTRIBUTION");
    assert.ok(item);
    assert.equal(item.value, 45000);
  });

  it("extracts distribution code", () => {
    const result = extractForm1099({ ...baseArgs, ocrText: R_OCR });
    const item = result.items.find((i) => i.key === "F1099R_DISTRIBUTION_CODE");
    assert.ok(item);
    assert.equal(item.snippet, "7");
  });
});

// ---------------------------------------------------------------------------
// SSA-1099 Extractor
// ---------------------------------------------------------------------------

describe("SSA-1099 Deterministic Extractor", () => {
  const SSA_OCR = `
SSA-1099 Social Security Benefit Statement
Tax Year 2023

Box 5  Net benefits paid  $22,800
  `;

  it("extracts net benefits", () => {
    const result = extractForm1099({ ...baseArgs, ocrText: SSA_OCR });
    assert.ok(result.ok);
    const item = result.items.find((i) => i.key === "SSA1099_NET_BENEFITS");
    assert.ok(item);
    assert.equal(item.value, 22800);
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe("1099 Suite Edge Cases", () => {
  it("returns ok=false for unrecognized text", () => {
    const result = extractForm1099({ ...baseArgs, ocrText: "no 1099 data here" });
    assert.equal(result.ok, false);
  });

  it("detects form type correctly", () => {
    const necResult = extractForm1099({ ...baseArgs, ocrText: "Form 1099-NEC\nBox 1  Nonemployee compensation  $50,000" });
    assert.ok(necResult.ok);
    assert.ok(necResult.items.some((i) => i.key === "F1099NEC_NONEMPLOYEE_COMP"));
  });
});
