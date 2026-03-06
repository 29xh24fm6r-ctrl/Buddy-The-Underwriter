import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { extractK1 } from "../k1Deterministic";
import { extractScheduleC } from "../scheduleCDeterministic";
import { extractScheduleE } from "../scheduleEDeterministic";
import type { DeterministicExtractorArgs } from "../types";

const baseArgs: Omit<DeterministicExtractorArgs, "ocrText"> = {
  dealId: "d1",
  bankId: "b1",
  documentId: "doc1",
};

// ---------------------------------------------------------------------------
// K-1 Extractor
// ---------------------------------------------------------------------------

describe("K-1 Deterministic Extractor", () => {
  const K1_OCR = `
Schedule K-1 (Form 1120-S)
Tax Year 2023

Partner's name: John A. Smith
Employer Identification Number: 12-3456789
Profit sharing percentage: 50%

Beginning capital account  $125,000
Ending capital account  $142,500

Box 1  Ordinary business income  $85,000
Box 2  Net rental real estate income  ($3,200)
Box 4  Guaranteed payments  $24,000
Box 5a  Interest income  $1,500
Box 9a  Net long-term capital gain  $12,000
Box 16d  Distributions  $40,000
  `;

  it("extracts ordinary income from Box 1", () => {
    const result = extractK1({ ...baseArgs, ocrText: K1_OCR });
    assert.ok(result.ok);
    const item = result.items.find((i) => i.key === "K1_ORDINARY_INCOME");
    assert.ok(item);
    assert.equal(item.value, 85000);
  });

  it("extracts rental income (negative)", () => {
    const result = extractK1({ ...baseArgs, ocrText: K1_OCR });
    const item = result.items.find((i) => i.key === "K1_RENTAL_RE_INCOME");
    assert.ok(item);
    assert.equal(item.value, -3200);
  });

  it("extracts guaranteed payments", () => {
    const result = extractK1({ ...baseArgs, ocrText: K1_OCR });
    const item = result.items.find((i) => i.key === "K1_GUARANTEED_PAYMENTS");
    assert.ok(item);
    assert.equal(item.value, 24000);
  });

  it("extracts owner name", () => {
    const result = extractK1({ ...baseArgs, ocrText: K1_OCR });
    const item = result.items.find((i) => i.key === "K1_OWNER_NAME");
    assert.ok(item);
    assert.ok(item.snippet?.includes("John A. Smith"));
  });

  it("extracts EIN", () => {
    const result = extractK1({ ...baseArgs, ocrText: K1_OCR });
    const item = result.items.find((i) => i.key === "K1_ENTITY_EIN");
    assert.ok(item);
    assert.ok(item.snippet?.includes("123456789") || item.snippet?.includes("12-3456789"));
  });

  it("extracts ownership percentage", () => {
    const result = extractK1({ ...baseArgs, ocrText: K1_OCR });
    const item = result.items.find((i) => i.key === "K1_OWNERSHIP_PCT");
    assert.ok(item);
    assert.equal(item.value, 50);
  });

  it("extracts capital account balances", () => {
    const result = extractK1({ ...baseArgs, ocrText: K1_OCR });
    const begin = result.items.find((i) => i.key === "K1_CAP_ACCT_BEGIN");
    const end = result.items.find((i) => i.key === "K1_CAP_ACCT_END");
    assert.ok(begin);
    assert.equal(begin.value, 125000);
    assert.ok(end);
    assert.equal(end.value, 142500);
  });

  it("extracts cash distributions", () => {
    const result = extractK1({ ...baseArgs, ocrText: K1_OCR });
    const item = result.items.find((i) => i.key === "K1_CASH_DISTRIBUTIONS");
    assert.ok(item);
    assert.equal(item.value, 40000);
  });

  it("resolves tax year from text", () => {
    const result = extractK1({ ...baseArgs, ocrText: K1_OCR });
    const item = result.items.find((i) => i.key === "K1_ORDINARY_INCOME");
    assert.equal(item?.period, "2023");
  });

  it("returns ok=false for empty text", () => {
    const result = extractK1({ ...baseArgs, ocrText: "no K-1 data here" });
    assert.equal(result.ok, false);
    assert.equal(result.items.length, 0);
  });
});

// ---------------------------------------------------------------------------
// Schedule C Extractor
// ---------------------------------------------------------------------------

describe("Schedule C Deterministic Extractor", () => {
  const SCH_C_OCR = `
SCHEDULE C (Form 1040)
Profit or Loss From Business
Tax Year 2023

Principal business: Consulting Services
NAICS code: 541611

Line 1  Gross receipts or sales  $320,000
Line 2  Returns and allowances  $5,000
Line 4  Cost of goods sold  $0
Line 5  Gross profit  $315,000
Line 7  Gross income  $315,000
Line 13  Depreciation  $8,500
Line 16b  Other interest  $2,400
Line 25  Utilities  $3,600
Line 26  Wages (less credits)  $45,000
Line 28  Total expenses  $142,000
Line 31  Net profit (loss)  $173,000
  `;

  it("extracts gross receipts", () => {
    const result = extractScheduleC({ ...baseArgs, ocrText: SCH_C_OCR });
    assert.ok(result.ok);
    const item = result.items.find((i) => i.key === "SCH_C_GROSS_RECEIPTS");
    assert.ok(item);
    assert.equal(item.value, 320000);
  });

  it("extracts depreciation (key add-back)", () => {
    const result = extractScheduleC({ ...baseArgs, ocrText: SCH_C_OCR });
    const item = result.items.find((i) => i.key === "SCH_C_DEPRECIATION");
    assert.ok(item);
    assert.equal(item.value, 8500);
  });

  it("extracts net profit", () => {
    const result = extractScheduleC({ ...baseArgs, ocrText: SCH_C_OCR });
    const item = result.items.find((i) => i.key === "SCH_C_NET_PROFIT");
    assert.ok(item);
    assert.equal(item.value, 173000);
  });

  it("extracts NAICS code", () => {
    const result = extractScheduleC({ ...baseArgs, ocrText: SCH_C_OCR });
    const item = result.items.find((i) => i.key === "SCH_C_NAICS");
    assert.ok(item);
    assert.equal(item.value, 541611);
  });

  it("extracts business name", () => {
    const result = extractScheduleC({ ...baseArgs, ocrText: SCH_C_OCR });
    const item = result.items.find((i) => i.key === "SCH_C_BUSINESS_NAME");
    assert.ok(item);
    assert.ok(item.snippet?.includes("Consulting Services"));
  });

  it("returns ok=false for empty text", () => {
    const result = extractScheduleC({ ...baseArgs, ocrText: "nothing here" });
    assert.equal(result.ok, false);
  });
});

// ---------------------------------------------------------------------------
// Schedule E Extractor
// ---------------------------------------------------------------------------

describe("Schedule E Deterministic Extractor", () => {
  const SCH_E_OCR = `
SCHEDULE E (Form 1040)
Supplemental Income and Loss
Tax Year 2023

Property address: 123 Main St, Springfield, IL 62701

Line 3  Rents received  $96,000
Line 12  Mortgage interest paid to banks  $42,000
Line 18  Depreciation expense (Form 4562)  $18,500
Line 22  Net income or loss per property  $14,200
Line 26  Total rental real estate income  $14,200

Name of entity: ABC Holdings LLC
Passive activity: nonpassive
Line 28d  Nonpassive income  $67,500
  `;

  it("extracts rents received", () => {
    const result = extractScheduleE({ ...baseArgs, ocrText: SCH_E_OCR });
    assert.ok(result.ok);
    const item = result.items.find((i) => i.key === "SCH_E_RENTS_RECEIVED");
    assert.ok(item);
    assert.equal(item.value, 96000);
  });

  it("extracts mortgage interest", () => {
    const result = extractScheduleE({ ...baseArgs, ocrText: SCH_E_OCR });
    const item = result.items.find((i) => i.key === "SCH_E_MORTGAGE_INTEREST");
    assert.ok(item);
    assert.equal(item.value, 42000);
  });

  it("extracts depreciation", () => {
    const result = extractScheduleE({ ...baseArgs, ocrText: SCH_E_OCR });
    const item = result.items.find((i) => i.key === "SCH_E_DEPRECIATION");
    assert.ok(item);
    assert.equal(item.value, 18500);
  });

  it("extracts rental total", () => {
    const result = extractScheduleE({ ...baseArgs, ocrText: SCH_E_OCR });
    const item = result.items.find((i) => i.key === "SCH_E_RENTAL_TOTAL");
    assert.ok(item);
    assert.equal(item.value, 14200);
  });

  it("extracts nonpassive income (Part II)", () => {
    const result = extractScheduleE({ ...baseArgs, ocrText: SCH_E_OCR });
    const item = result.items.find((i) => i.key === "SCH_E_NONPASSIVE_INCOME");
    assert.ok(item);
    assert.equal(item.value, 67500);
  });

  it("extracts property address", () => {
    const result = extractScheduleE({ ...baseArgs, ocrText: SCH_E_OCR });
    const item = result.items.find((i) => i.key === "SCH_E_PROPERTY_ADDRESS");
    assert.ok(item);
    assert.ok(item.snippet?.includes("123 Main St"));
  });

  it("extracts entity name", () => {
    const result = extractScheduleE({ ...baseArgs, ocrText: SCH_E_OCR });
    const item = result.items.find((i) => i.key === "SCH_E_ENTITY_NAME");
    assert.ok(item);
    assert.ok(item.snippet?.includes("ABC Holdings LLC"));
  });

  it("returns ok=false for empty text", () => {
    const result = extractScheduleE({ ...baseArgs, ocrText: "no schedule E" });
    assert.equal(result.ok, false);
  });
});
