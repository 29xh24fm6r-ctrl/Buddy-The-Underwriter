import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { extractForm8825 } from "../form8825Deterministic";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeArgs(ocrText: string, structuredJson?: unknown) {
  return {
    dealId: "deal-1",
    bankId: "bank-1",
    documentId: "doc-1",
    ocrText,
    structuredJson,
    docYear: 2024,
  };
}

// ---------------------------------------------------------------------------
// Property metadata extraction
// ---------------------------------------------------------------------------

describe("extractForm8825 — property metadata", () => {
  it("extracts property description", () => {
    const ocr = `Form 8825
Description of property: Office Building at 123 Main St
Gross rents received $120,000`;
    const result = extractForm8825(makeArgs(ocr));
    assert.equal(result.ok, true);
    const desc = result.items.find((i) => i.key === "F8825_PROPERTY_DESCRIPTION");
    assert.ok(desc);
    assert.equal(desc.value, "Office Building at 123 Main St");
  });

  it("extracts property kind", () => {
    const ocr = `Form 8825
Kind of property: Commercial
Gross rents received $50,000`;
    const result = extractForm8825(makeArgs(ocr));
    const kind = result.items.find((i) => i.key === "F8825_PROPERTY_KIND");
    assert.ok(kind);
    assert.equal(kind.value, "commercial");
  });

  it("extracts fair rental days and personal use days", () => {
    const ocr = `Form 8825
Fair rental days: 365
Personal use days: 0
Gross rents received $80,000`;
    const result = extractForm8825(makeArgs(ocr));
    const fairDays = result.items.find((i) => i.key === "F8825_FAIR_RENTAL_DAYS");
    assert.ok(fairDays);
    assert.equal(fairDays.value, 365);
    const personalDays = result.items.find((i) => i.key === "F8825_PERSONAL_USE_DAYS");
    assert.ok(personalDays);
    assert.equal(personalDays.value, 0);
  });
});

// ---------------------------------------------------------------------------
// Income and expense extraction
// ---------------------------------------------------------------------------

describe("extractForm8825 — income and expenses", () => {
  it("extracts gross rents", () => {
    const ocr = `Form 8825
Gross rents received $240,000`;
    const result = extractForm8825(makeArgs(ocr));
    const rents = result.items.find((i) => i.key === "F8825_GROSS_RENTS");
    assert.ok(rents);
    assert.equal(rents.value, 240_000);
  });

  it("extracts all expense lines from OCR", () => {
    const ocr = `Form 8825 — Rental Real Estate
Gross rents received $240,000
Insurance $12,000
Mortgage interest paid $85,000
Repairs $8,500
Taxes $22,000
Depreciation $35,000
Management fees $24,000
Total expenses $186,500
Net income per property $53,500`;

    const result = extractForm8825(makeArgs(ocr));
    assert.equal(result.ok, true);

    const insurance = result.items.find((i) => i.key === "F8825_INSURANCE");
    assert.ok(insurance);
    assert.equal(insurance.value, 12_000);

    const mortgage = result.items.find((i) => i.key === "F8825_MORTGAGE_INTEREST");
    assert.ok(mortgage);
    assert.equal(mortgage.value, 85_000);

    const repairs = result.items.find((i) => i.key === "F8825_REPAIRS");
    assert.ok(repairs);
    assert.equal(repairs.value, 8_500);

    const taxes = result.items.find((i) => i.key === "F8825_TAXES");
    assert.ok(taxes);
    assert.equal(taxes.value, 22_000);

    const depreciation = result.items.find((i) => i.key === "F8825_DEPRECIATION");
    assert.ok(depreciation);
    assert.equal(depreciation.value, 35_000);

    const mgmtFees = result.items.find((i) => i.key === "F8825_MANAGEMENT_FEES");
    assert.ok(mgmtFees);
    assert.equal(mgmtFees.value, 24_000);

    const totalExp = result.items.find((i) => i.key === "F8825_TOTAL_EXPENSES");
    assert.ok(totalExp);
    assert.equal(totalExp.value, 186_500);

    const netIncome = result.items.find((i) => i.key === "F8825_NET_INCOME");
    assert.ok(netIncome);
    assert.equal(netIncome.value, 53_500);
  });

  it("extracts utilities, commissions, other interest", () => {
    const ocr = `Form 8825
Gross rents received $100,000
Utilities $6,000
Commissions $5,000
Other interest $3,500`;

    const result = extractForm8825(makeArgs(ocr));
    assert.equal(result.ok, true);

    const utilities = result.items.find((i) => i.key === "F8825_UTILITIES");
    assert.ok(utilities);
    assert.equal(utilities.value, 6_000);

    const commissions = result.items.find((i) => i.key === "F8825_COMMISSIONS");
    assert.ok(commissions);
    assert.equal(commissions.value, 5_000);

    const otherInt = result.items.find((i) => i.key === "F8825_OTHER_INTEREST");
    assert.ok(otherInt);
    assert.equal(otherInt.value, 3_500);
  });
});

// ---------------------------------------------------------------------------
// Total summary lines
// ---------------------------------------------------------------------------

describe("extractForm8825 — totals", () => {
  it("extracts total gross rents and total net income", () => {
    const ocr = `Form 8825
Gross rents received $120,000
Total gross rents $360,000
Total depreciation $105,000
Total net income $120,500`;

    const result = extractForm8825(makeArgs(ocr));
    assert.equal(result.ok, true);

    const totalRents = result.items.find((i) => i.key === "F8825_TOTAL_GROSS_RENTS");
    assert.ok(totalRents);
    assert.equal(totalRents.value, 360_000);

    const totalDeprec = result.items.find((i) => i.key === "F8825_TOTAL_DEPRECIATION");
    assert.ok(totalDeprec);
    assert.equal(totalDeprec.value, 105_000);

    const totalNet = result.items.find((i) => i.key === "F8825_TOTAL_NET_INCOME");
    assert.ok(totalNet);
    assert.equal(totalNet.value, 120_500);
  });
});

// ---------------------------------------------------------------------------
// Structured JSON path
// ---------------------------------------------------------------------------

describe("extractForm8825 — structured JSON", () => {
  it("extracts from structured JSON fields", () => {
    const structuredJson = {
      pages: [{
        formFields: [
          {
            fieldName: { content: "Gross rents received" },
            fieldValue: { content: "$180,000" },
          },
          {
            fieldName: { content: "Depreciation" },
            fieldValue: { content: "$45,000" },
          },
          {
            fieldName: { content: "Description of property" },
            fieldValue: { content: "Warehouse at 456 Industrial Blvd" },
          },
        ],
      }],
    };
    const result = extractForm8825(makeArgs("Form 8825", structuredJson));
    assert.equal(result.ok, true);
    assert.equal(result.extractionPath, "gemini_structured");

    const rents = result.items.find((i) => i.key === "F8825_GROSS_RENTS");
    assert.ok(rents);
    assert.equal(rents.value, 180_000);

    const desc = result.items.find((i) => i.key === "F8825_PROPERTY_DESCRIPTION");
    assert.ok(desc);
    assert.equal(desc.value, "Warehouse at 456 Industrial Blvd");
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe("extractForm8825 — edge cases", () => {
  it("returns ok=false for empty OCR with no matches", () => {
    const result = extractForm8825(makeArgs("Some random text with no form data"));
    assert.equal(result.ok, false);
    assert.equal(result.items.length, 0);
  });

  it("handles parenthetical (negative) amounts", () => {
    const ocr = `Form 8825
Gross rents received $100,000
Net income per property ($15,000)`;
    const result = extractForm8825(makeArgs(ocr));
    const netIncome = result.items.find((i) => i.key === "F8825_NET_INCOME");
    assert.ok(netIncome);
    assert.equal(netIncome.value, -15_000);
  });

  it("only returns valid F8825_ keys", () => {
    const ocr = `Form 8825
Gross rents received $200,000
Depreciation $30,000`;
    const result = extractForm8825(makeArgs(ocr));
    for (const item of result.items) {
      assert.ok(item.key.startsWith("F8825_"), `Key ${item.key} should start with F8825_`);
    }
  });

  it("uses docYear for period", () => {
    const result = extractForm8825(makeArgs("Gross rents received $50,000"));
    for (const item of result.items) {
      assert.equal(item.period, "2024");
    }
  });
});
